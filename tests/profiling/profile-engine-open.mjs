// Manual SDK/PDFium boundary diagnostic, with an already initialized WASM runtime.
// Requires Vite. Does not modify the PDF or change the application's open path.
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
const { values, positionals } = parseArgs({ allowPositionals: true, options: { samples: { type: 'string', default: '5' } } });
if (!positionals[0]) throw Error('Provide a local PDF path. Start pnpm dev first.');
const samples = Number(values.samples);
if (!Number.isSafeInteger(samples) || samples < 1) throw Error('samples must be a positive integer');
const bytes = await readFile(positionals[0]);
const base = process.env.PDF_TEST_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'chrome' });
let report;
try {
  const context = await browser.newContext();
  await context.route('**/__engine_profile', route => route.fulfill({ contentType: 'text/html', body: '<title>Engine open diagnostic</title>' }));
  await context.route('**/__engine_profile.pdf', route => route.fulfill({ contentType: 'application/pdf', body: bytes }));
  const page = await context.newPage();
  await page.goto(`${base}/__engine_profile`);
  report = await page.evaluate(async samples => {
    const root = location.origin;
    const source = `import { profileEngineOpen } from ${JSON.stringify(root + '/tests/support/open-engine-profile.mjs')};
      try {
        const bytes = new Uint8Array(await (await fetch(${JSON.stringify(root + '/__engine_profile.pdf')})).arrayBuffer());
        postMessage({ report: await profileEngineOpen(bytes, ${samples}) });
      } catch (error) { postMessage({ error: String(error.stack ?? error) }); }`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url, { type: 'module' });
    try {
      return await new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => data.error ? reject(Error(data.error)) : resolve(data.report);
        worker.onerror = error => reject(Error(error.message));
      });
    } finally { worker.terminate(); URL.revokeObjectURL(url); }
  }, samples);
} finally { await browser.close(); }
const median = values => { const sorted = [...values].sort((a, b) => a - b); const i = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2; };
report.file = basename(positionals[0]);
report.summary = [...new Set(report.results.map(r => r.mode))].map(mode => {
  const runs = report.results.filter(r => r.mode === mode);
  const names = [...new Set(runs.flatMap(r => r.rows.map(row => row.name)))];
  return { mode, ...(mode.startsWith('sdk-deferred-') ? {
    medianDeferredCheckMs: median(runs.map(r => r.deferredCheckMs)),
    ...(mode === 'sdk-deferred-after-revisions' ? { medianRevisionsReadMs: median(runs.map(r => r.revisionsReadMs)), revisionCount: runs[0].revisionCount } : {}),
    ...(mode === 'sdk-deferred-after-forms' ? { medianFormsReadMs: median(runs.map(r => r.formsReadMs)) } : {}),
    annotateBefore: runs[0].annotateBefore, annotateAfter: runs[0].annotateAfter, signatureFields: runs[0].signatureFields,
  } : {}), medianMs: median(runs.map(r => r.elapsedMs)), samplesMs: runs.map(r => r.elapsedMs),
    functions: names.map(name => ({ name, medianSelfMs: median(runs.map(r => r.rows.find(row => row.name === name)?.selfMs ?? 0)),
      medianTotalMs: median(runs.map(r => r.rows.find(row => row.name === name)?.totalMs ?? 0)) })).sort((a, b) => b.medianSelfMs - a.medianSelfMs).slice(0, 10) };
});
console.log(JSON.stringify(report.summary, null, 2));
if (process.env.PDF_BENCH_OUTPUT) await writeFile(process.env.PDF_BENCH_OUTPUT, JSON.stringify(report, null, 2));
