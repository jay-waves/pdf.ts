import assert from 'node:assert/strict';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
const base = process.env.PDF_TEST_URL ?? 'http://127.0.0.1:5173';
import { fixture } from './pdf-editing-fixture.mjs';
const bytes = fixture();
// Chrome's off-the-record context crashes when native file handles cross into
// a SharedWorker. A disposable regular profile exercises the supported path.
const context = await chromium.launchPersistentContext('', { channel: 'chrome' });
const browser = context.browser();
const errors = [];
context.on('page', page => {
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { errors.push(d.message()); await d.dismiss(); });
  if (process.env.DEBUG_PDF) page.on('console', m => console.log(m.type(), m.text()));
});
await context.route('**/editing-fixture.pdf', r => r.fulfill({ contentType: 'application/pdf', body: bytes }));
await context.route('**/shared-test', r => r.fulfill({ contentType: 'text/html', body: '<html><body>Shared PDF test</body></html>' }));
async function tab(identity = 'same-file', fileName = 'editing-fixture.pdf') {
  const page = await context.newPage();
  await page.goto(`${base}/shared-test`);
  await page.evaluate(async ({ identity, base, fileName }) => {
    const { open } = await import('/scripts/shared-document-harness.ts');
    const fileIdentity = identity.startsWith('handle:')
      ? await (await navigator.storage.getDirectory()).getFileHandle(identity.slice(7), { create: true }) : identity;
    if (typeof fileIdentity !== 'string' && !(await fileIdentity.getFile()).size) {
      const writable = await fileIdentity.createWritable();
      await writable.write(await (await fetch(`${base}/${fileName}`)).arrayBuffer());
      await writable.close();
    }
    window.session = await open(fileIdentity, `${base}/${fileName}`);
  }, { identity, base, fileName });
  return page;
}
const ids = page => page.evaluate(() => Object.values(session.annotations.getState().byUid).map(a => a.object).filter(a => a.type === 5).map(a => a.id));
async function create(page, id) {
  await page.evaluate(async id => {
    session.annotations.createAnnotation(0, { id, type: 5, pageIndex: 0, rect: { origin: { x: 50, y: 50 }, size: { width: 100, height: 60 } }, color: '#ff0000', strokeWidth: 2, opacity: 1, flags: [] });
    await session.client.flush();
  }, id);
}
async function expectIds(page, expected) {
  await page.waitForFunction(expected => JSON.stringify(Object.values(session.annotations.getState().byUid).map(a => a.object).filter(a => a.type === 5).map(a => a.id).sort()) === JSON.stringify(expected.sort()), expected);
}
try {
  const a = await tab(); const b = await tab(); const copy = await tab('independent-copy');
  const key = page => page.evaluate(() => session.client.getSnapshot('test').sessionKey);
  assert.equal(await key(a), await key(b), 'same native document');
  assert.notEqual(await key(a), await key(copy), 'copies have separate native documents');
  await create(a, 'a'); await expectIds(b, ['a']); await expectIds(copy, []);
  await create(b, 'b'); await expectIds(a, ['a', 'b']);
  await a.evaluate(async () => { session.history.undo(); await session.client.flush(); });
  await expectIds(b, ['a']);
  await b.evaluate(async () => { session.history.redo(); await session.client.flush(); });
  await expectIds(a, ['a', 'b']);
  await b.evaluate(async () => { await session.form.setFormValues({ SharedName: 'from B' }).toPromise(); });
  await a.waitForFunction(() => session.form.getFormValues().SharedName === 'from B');
  await a.evaluate(async () => { session.history.undo(); await session.client.flush(); });
  await b.waitForFunction(() => session.form.getFormValues().SharedName === 'initial');
  await b.evaluate(async () => { session.history.redo(); await session.client.flush(); });
  await a.waitForFunction(() => session.form.getFormValues().SharedName === 'from B');
  await a.evaluate(async () => { session.history.undo(); await session.client.flush(); });
  await a.close();
  await b.evaluate(async () => { session.history.undo(); await session.client.flush(); });
  await expectIds(b, ['a']);
  const late = await tab(); await expectIds(late, ['a']);
  await late.evaluate(async () => { session.history.redo(); await session.client.flush(); });
  await expectIds(b, ['a', 'b']);
  const serialized = await b.evaluate(async () => {
    let bytes = 0;
    await session.client.save('test', { save: async () => false,
      writeShared: async plan => { bytes = plan.data.byteLength; return { status: 'saved', version: plan.outputVersion }; },
    });
    return { bytes, revision: session.client.getSnapshot('test').savedRevision };
  });
  assert.ok(serialized.bytes > 0);
  await late.waitForFunction(() => { const s = session.client.getSnapshot('test'); return s.revision === s.savedRevision; });
  assert.deepEqual(await ids(copy), []);
  await Promise.all([create(b, 'concurrent-b'), create(late, 'concurrent-late')]);
  await expectIds(b, ['a', 'b', 'concurrent-b', 'concurrent-late']);
  await expectIds(late, ['a', 'b', 'concurrent-b', 'concurrent-late']);
  await b.evaluate(() => {
    window.pendingSave = session.client.save('test', { save: async () => false,
      writeShared: plan => new Promise(resolve => { window.writePlan = plan; window.finishWrite = () => resolve({ status: 'saved', version: plan.outputVersion }); }),
    });
  });
  await b.waitForFunction(() => typeof finishWrite === 'function');
  const savedBytes = await b.evaluate(() => Array.from(new Uint8Array(writePlan.data)));
  await context.route('**/pending-saved.pdf', r => r.fulfill({ contentType: 'application/pdf', body: Buffer.from(savedBytes) }));
  const joiningDuringWrite = await tab('same-file', 'pending-saved.pdf');
  assert.equal(await key(joiningDuringWrite), await key(b), 'newly written bytes join the session before the write acknowledgement');
  await create(late, 'during-save');
  await b.evaluate(async () => { finishWrite(); await pendingSave; });
  assert.equal(await b.evaluate(() => { const s = session.client.getSnapshot('test'); return s.revision > s.savedRevision; }), true);
  assert.equal(await late.evaluate(() => { const s = session.client.getSnapshot('test'); return s.revision > s.savedRevision; }), true);
  const handleA = await tab('handle:same.pdf'); const handleB = await tab('handle:same.pdf');
  const otherHandle = await tab('handle:copy.pdf');
  assert.equal(await key(handleA), await key(handleB), 'FileSystemHandle.isSameEntry joins the session');
  assert.notEqual(await key(handleA), await key(otherHandle));
  await create(handleA, 'handle-edit'); await expectIds(handleB, ['handle-edit']);
  await expectIds(otherHandle, []);
  await handleA.evaluate(async () => {
    const handle = await (await navigator.storage.getDirectory()).getFileHandle('same.pdf');
    const writable = await handle.createWritable();
    await writable.write(await (await fetch('/editing-fixture.pdf')).arrayBuffer()); await writable.close();
    const { createBrowserWriter } = await import('/apps/platform/browser-file-handle.ts');
    window.fileWriter = createBrowserWriter(handle);
    await session.client.save('test', fileWriter);
  });
  await handleB.waitForFunction(() => { const s = session.client.getSnapshot('test'); return s.revision === s.savedRevision; });
  await create(handleB, 'second-file-edit');
  await handleB.evaluate(async () => {
    const handle = await (await navigator.storage.getDirectory()).getFileHandle('same.pdf');
    const { createBrowserWriter } = await import('/apps/platform/browser-file-handle.ts');
    await session.client.save('test', createBrowserWriter(handle));
    const file = await handle.getFile();
    session.client.setIdentity('independent-saved-verification');
    const doc = await session.engine.openDocumentBuffer({ id: 'verify-saved', content: await file.arrayBuffer() }).toPromise();
    const ann = await session.engine.getAllAnnotations(doc).toPromise();
    if (!ann[0].some(a => a.id === 'second-file-edit')) throw Error('Saved PDF was not readable');
    await session.engine.closeDocument(doc).toPromise();
  });
  await b.evaluate(() => {
    window.writerEntered = false;
    void session.client.save('test', { save: async () => false,
      writeShared: () => { window.writerEntered = true; return new Promise(() => {}); },
    }).catch(() => {});
  });
  await b.waitForFunction(() => writerEntered);
  await late.evaluate(() => {
    window.queuedWriterEntered = false;
    window.queuedSave = session.client.save('test', { save: async () => false,
      writeShared: async plan => { window.queuedWriterEntered = true; return { status: 'saved', version: plan.outputVersion }; },
    });
  });
  assert.equal(await late.evaluate(() => queuedWriterEntered), false);
  await b.close();
  assert.equal(await late.evaluate(() => queuedSave), true);
  assert.equal(await late.evaluate(() => queuedWriterEntered), true);
  const protectedSave = await copy.evaluate(async () => {
    await session.engine.setDocumentEncryption(session.manager.getDocument('test'), 'secret', 'secret', 0xffffffff).toPromise();
    let savedBytes;
    await session.client.save('test', { save: async () => false,
      writeShared: async plan => { savedBytes = plan.data; return { status: 'saved', version: plan.outputVersion }; },
    });
    return new TextDecoder().decode(new Uint8Array(savedBytes).subarray(0, 5));
  });
  assert.equal(protectedSave, '%PDF-', 'encrypted saves contain a complete PDF');
  assert.deepEqual(errors, []);
  console.log('PASS: shared edits, global cross-tab annotation/form undo/redo, first-tab closure, late join, independent copy, shared saved revision, concurrent edits, browser file-handle identity and verified complete PDF bytes; writer disconnect unblocks queued saves; encryption uses full save.', serialized);
} finally { await browser.close(); }
