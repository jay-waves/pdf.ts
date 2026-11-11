import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/document/pdf-save.ts')) {
      if (specifier.endsWith('shared-document-client')) return { url: 'data:text/javascript,export const getSharedDocumentClient = engine => engine.shared;', shortCircuit: true };
      if (specifier.endsWith('browser-download')) return { url: 'data:text/javascript,export const downloadPdf = () => {};', shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const { createDocumentOutput } = await import('../apps/document/pdf-save.ts');
hooks.deregister();

function fixture(shared) {
  const calls = [];
  const bytes = new Uint8Array([9, 1, 2, 9]).subarray(1, 3);
  const output = createDocumentOutput({
    engine: { shared }, documentId: 'doc',
    registry: { documents: {
      get: () => ({ status: 'ready' }),
      download: async (id, options) => { calls.push(['serialize', id, options]); return bytes; },
    } },
    fileHandle: {
      prepareWrite: async () => { calls.push('permission'); return { save: async data => { calls.push([...new Uint8Array(data)]); return true; } }; },
      saveCopy: async data => { calls.push([...new Uint8Array(data)]); return 'copy.pdf'; },
    },
  });
  return { output, calls };
}

test('document output prepares permission before serialization and isolates the PDF view', async () => {
  const { output, calls } = fixture();
  assert.equal(await output.save(), true);
  assert.deepEqual(calls, ['permission', ['serialize', 'doc', { mode: 'rewrite' }], [1, 2]]);
});
test('shared save delegates the transaction without serializing on the UI side', async () => {
  const saved = [];
  const { output, calls } = fixture({ save: async (id, target) => { saved.push(id); assert.equal(typeof target.save, 'function'); return true; } });
  assert.equal(await output.save(), true);
  assert.deepEqual(saved, ['doc']);
  assert.deepEqual(calls, ['permission']);
});
test('copy serializes without acquiring original-file permission', async () => {
  const { output, calls } = fixture();
  assert.equal(await output.saveCopy(), 'copy.pdf');
  assert.deepEqual(calls, [['serialize', 'doc', { mode: 'rewrite' }], [1, 2]]);
});
test('cancelled permission and absent documents do not write', async () => {
  const output = createDocumentOutput({ engine: {}, documentId: 'doc', registry: { documents: {} }, fileHandle: { prepareWrite: async () => null } });
  assert.equal(await output.save(), false);
  const missing = createDocumentOutput({ engine: {} });
  assert.equal(await missing.save(), false);
  assert.equal(await missing.export('test.pdf'), false);
  assert.equal(await missing.saveCopy(), null);
});
