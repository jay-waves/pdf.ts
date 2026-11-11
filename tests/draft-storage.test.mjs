import { SaveLane } from '../apps/engine/persistence/document-save.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';

// Reuse the real persistence code; only browser storage APIs are in-memory fakes.
const handles = [];
globalThis.__draftTestHandles = handles;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'idb-keyval') return { url: 'test:draft-handles', shortCircuit: true };
    if (context.parentURL?.includes('/engine/persistence/') && specifier.startsWith('./') && !specifier.endsWith('.ts')) specifier += '.ts';
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'test:draft-handles') return { format: 'module', shortCircuit: true, source: 'const entries = globalThis.__draftTestHandles; export async function get() { return entries; } export async function set() { throw Error("unexpected handle registration"); }' };
    if (url.endsWith('/draft-session.ts')) return { format: 'module', shortCircuit: true, source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }) };
    return nextLoad(url, context);
  },
});
const { openDraftStorage, DraftConflict } = await import('../apps/engine/persistence/draft-storage.ts');
const { DraftSession } = await import('../apps/engine/persistence/draft-session.ts');
const { encodeDraft } = await import('../apps/engine/persistence/document-draft.ts');
hooks.deregister();
delete globalThis.__draftTestHandles;

function storageEnvironment(t) {
  const files = new Map();
  let pdfReads = 0;
  const identity = { async isSameEntry(other) { return other === identity; }, async getFile() { pdfReads++; throw Error('draft writes must never read the PDF'); } };
  handles.splice(0, handles.length, { handle: identity, key: 'book' });
  const directory = {
    async getFileHandle(name, options) {
      if (!files.has(name) && !options?.create) throw new DOMException('missing', 'NotFoundError');
      return {
        async getFile() { return new Blob([files.get(name)]); },
        async createWritable() {
          let pending;
          return { async write(text) { pending = text; }, async close() { files.set(name, pending); }, async abort() {} };
        },
      };
    },
    async removeEntry(name) { files.delete(name); },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    locks: { async request(_key, operation) { return operation(); } },
    storage: { async getDirectory() { return { async getDirectoryHandle() { return directory; } }; } },
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'navigator', previous); else delete globalThis.navigator; handles.length = 0; });
  return { identity, pdfReads: () => pdfReads };
}
function draft(revision = 1) {
  return { format: 'pdf.ts/swp', version: 1, engine: 3, baseVersion: 'original-pdf', revision,
    updatedAt: '2026-01-01T00:00:00Z', targets: [], removed: [], bundle: null, formValues: { Name: { value: 'edited' } } };
}
function session() {
  return new DraftSession({ lane: new SaveLane(), revision: () => 2, savedRevision: () => 0,
    capture: async () => draft(2), notify() {} });
}

test('native-handle drafts retain their base without PDF reads and still reject stale writers', async t => {
  const env = storageEnvironment(t);
  const storage = await openDraftStorage(env.identity);
  const text = encodeDraft(draft());
  const token = await storage.write(text, 'missing', 'original-pdf');
  assert.deepEqual(await storage.read(), { text, version: token });
  const updated = encodeDraft(draft(2));
  const next = await storage.write(updated, token, 'original-pdf');
  await assert.rejects(storage.write(text, token, 'original-pdf'), DraftConflict);
  await assert.rejects(storage.remove(token), DraftConflict);
  assert.deepEqual(await storage.read(), { text: updated, version: next });
  assert.equal(env.pdfReads(), 0);
});

test('recovery rejects a different PDF base and preserves the downloadable draft', async t => {
  const env = storageEnvironment(t);
  const storage = await openDraftStorage(env.identity);
  const text = encodeDraft(draft());
  await storage.write(text, 'missing', 'original-pdf');
  const changed = session();
  assert.equal(await changed.initialize(Promise.resolve(storage), 'externally-changed-pdf'), null);
  assert.equal(changed.state.draftStatus, 'conflict');
  await changed.persist(); // A blocked session must not overwrite the original draft.
  assert.equal(await changed.download(), text);
  const matching = session();
  assert.deepEqual(await matching.initialize(Promise.resolve(storage), 'original-pdf'), draft());
});

test('reopening a confirmed merge output removes the already merged sidecar', async t => {
  const env = storageEnvironment(t);
  const storage = await openDraftStorage(env.identity);
  await storage.write(encodeDraft({ ...draft(), mergeOutputVersion: 'saved-pdf' }), 'missing', 'original-pdf');
  assert.equal(await session().initialize(Promise.resolve(storage), 'saved-pdf'), null);
  assert.deepEqual(await storage.read(), { text: null, version: 'missing' });
});
