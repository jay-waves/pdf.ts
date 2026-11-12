// Manual diagnostics only: instrument the installed SDK's runtime boundary.
// Revalidate private WorkerHost method names when upgrading EmbedPDF.
import { LocalEngine } from '@embedpdf/engine';
import { createPdfRuntime } from '@embedpdf/engine-runtime';
import { WorkerHost, ensureInitialized, openFatMemoryDocument } from '@embedpdf/engine-services';

export async function profileEngineOpen(bytes, samples = 5) {
  const runtime = await createPdfRuntime({ prefer: 'wasm' });
  ensureInitialized(runtime);
  let rows = new Map(), enabled = false;
  const stack = [];
  const originals = [];
  function instrument(object, key, label) {
    const original = object[key];
    if (typeof original !== 'function') throw Error(`SDK profiling hook missing: ${label}`);
    object[key] = function (...args) {
      if (!enabled) return original.apply(this, args);
      const frame = { start: performance.now(), children: 0 }; stack.push(frame);
      try { return original.apply(this, args); }
      finally {
        const ms = performance.now() - frame.start; stack.pop();
        if (stack.length) stack.at(-1).children += ms;
        const row = rows.get(label) ?? { name: label, calls: 0, totalMs: 0, selfMs: 0 };
        row.calls++; row.totalMs += ms; row.selfMs += ms - frame.children; rows.set(label, row);
      }
    };
    originals.push(() => { object[key] = original; });
  }
  for (const name of Object.keys(runtime.fn)) if (typeof runtime.fn[name] === 'function') instrument(runtime.fn, name, name);
  for (const name of ['alloc', 'writeBytes']) instrument(runtime.mem, name, `memory.${name}`);
  const listeners = new Set();
  const host = new WorkerHost(runtime, pack => { for (const listener of listeners) listener(pack.payload); }, {
    parsedPageBudgetBytes: 64 * 1024 * 1024, decodedImageBudgetBytes: 32 * 1024 * 1024,
  });
  for (const name of ['handleOpen', 'openBytesAsLayer', 'probeProtection']) instrument(host, name, `SDK.${name}`);
  const engine = LocalEngine.fromTransport({ transport: {
    send: pack => host.receive(pack.payload),
    onMessage: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    terminate: async () => { host.residency.disarmTimer(); listeners.clear(); },
  } });
  const results = [];
  try {
    const protectionProbe = host.probeProtection;
    for (let sample = 0; sample < samples; sample++) {
      for (const mode of [
        'sdk', 'sdk-without-protection-probe', 'sdk-deferred-protection',
        'sdk-deferred-after-forms', 'sdk-deferred-after-revisions', 'plain-pdfium',
      ]) {
        // Counterfactual only: do not bypass signed-document protection in production.
        host.probeProtection = mode === 'sdk-without-protection-probe' || mode.startsWith('sdk-deferred-') ? () => null : protectionProbe;
        rows = new Map(); enabled = true;
        const start = performance.now();
        let close, document;
        try {
          if (mode !== 'plain-pdfium') {
            const doc = document = await engine.open({ kind: 'bytes', bytes });
            close = () => doc.close();
          } else {
            const doc = openFatMemoryDocument(runtime, bytes);
            close = () => doc.close();
          }
        } finally { enabled = false; }
        const elapsedMs = performance.now() - start;
        const result = { mode, sample: sample + 1, elapsedMs, rows: [...rows.values()].sort((a, b) => b.selfMs - a.selfMs) };
        if (mode.startsWith('sdk-deferred-')) {
          if (mode === 'sdk-deferred-after-revisions') {
            const revisionStart = performance.now();
            const session = [...host.sessions.values()][0];
            result.revisionCount = runtime.fn.EPDFDoc_GetRevisionCount(session.requireDocPtr());
            result.revisionsReadMs = performance.now() - revisionStart;
          }
          if (mode === 'sdk-deferred-after-forms') {
            const formsStart = performance.now();
            result.formFields = (await document.forms.list()).fields.length;
            result.formsReadMs = performance.now() - formsStart;
          }
          host.probeProtection = protectionProbe;
          // Isolated feasibility experiment: unlock refreshes the SDK guard on
          // this unencrypted test file. A production API should explicitly
          // represent pending protection and await it before mutations.
          result.annotateBefore = document.security.allows('doc.annotate.modify');
          const checkStart = performance.now();
          await document.security.unlock({ password: '' });
          result.deferredCheckMs = performance.now() - checkStart;
          result.annotateAfter = document.security.allows('doc.annotate.modify');
          result.signatureFields = (await document.signatures.list()).signatures.length;
        }
        results.push(result);
        await close();
      }
    }
    return { bytes: bytes.byteLength, samples, results };
  } finally {
    enabled = false;
    await engine.destroy();
    originals.reverse().forEach(restore => restore());
    await runtime.destroy();
  }
}
