import assert from 'node:assert/strict';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
import { fixture } from '../support/pdf-editing-fixture.mjs';
const base = process.env.PDF_TEST_URL ?? 'http://127.0.0.1:5173';
const original = fixture({ notes: true }); let pdf = original;
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext(); const errors = [];
context.on('page', page => {
  page.on('pageerror', error => errors.push(error.message));
  if (process.env.DEBUG_PDF) page.on('console', message => console.log(message.type(), message.text()));
});
await context.route('**/draft-test', route => route.fulfill({ contentType: 'text/html', body: 'Draft test' }));
const page = await context.newPage(); page.setDefaultTimeout(15000);
async function open() {
  await page.evaluate(async bytes => {
    const { openBytes } = await import('/tests/support/shared-document-harness.ts');
    window.session = await openBytes(bytes, 'draft-fixture');
    window.doc = session.doc; window.pageRef = (await doc.pages.list()).pages[0].ref;
  }, [...pdf]);
}
async function saved() { await page.waitForFunction(() => { const s = session.client.getSnapshot('test'); return s.draftStatus === 'saved' && s.draftRevision === s.revision; }); }
async function close() { await page.evaluate(async () => { await session.kernel.destroy(); await session.engine.destroy(); }); }
async function edits() { return page.evaluate(async () => (await doc.annotations.list()).annotations.map(a => ({ nm: a.nm, subtype: a.subtype, contents: a.contents }))); }
async function drafts() {
  return page.evaluate(async () => { const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('pdf-ts-drafts'); const files = [];
    for await (const [name, handle] of dir.entries()) files.push({ name, text: await (await handle.getFile()).text() }); return files; });
}
try {
  await page.goto(`${base}/draft-test`); await open();
  await page.evaluate(async stamp => {
    const all = (await doc.annotations.list()).annotations;
    await session.annotations.update(all.find(a => a.contents === 'original note').ref, { contents: 'changed original' });
    await session.annotations.delete(all.find(a => a.contents === 'delete this note').ref);
    await session.annotations.create(0, { nm: 'new-shape', subtype: 'square', box: { x: 20, y: 30, width: 40, height: 50 }, contents: 'new shape' });
    await session.annotations.create(0, { nm: 'draft-stamp', subtype: 'stamp', box: { x: 200, y: 200, width: 32, height: 32 } }, { appearance: new Uint8Array(stamp) });
    const field = (await doc.forms.list()).fields[0];
    await session.form.setValue(field.ref, { value: 'draft field value' });
    await session.client.flush();
  }, [...fixture({ content: '1 0 0 rg 0 0 100 100 re f\n' })]);
  await saved();
  const stored = await drafts();
  assert.equal(stored.length, 1); assert.ok(stored[0].name.endsWith('.swp'));
  assert.ok(stored[0].text.length < 30000); assert.deepEqual(pdf, original);
  console.log('PASS auto-save writes compact .swp and leaves the original PDF untouched');
  await close(); await open();
  let restored = await edits();
  assert.ok(restored.some(a => a.contents === 'changed original'));
  assert.ok(!restored.some(a => a.contents === 'delete this note'));
  assert.equal(restored.filter(a => a.nm === 'new-shape').length, 1);
  assert.equal(restored.filter(a => a.nm === 'draft-stamp').length, 1);
  const appearance = await page.evaluate(async () => {
    const stamp = (await doc.annotations.list()).annotations.find(a => a.subtype === 'stamp');
    return (await doc.page(stamp.page).annotations.downloadResource(stamp.ref, 'appearance')).byteLength;
  }); assert.ok(appearance > 0);
  assert.equal(await page.evaluate(async () => (await doc.forms.list()).fields[0].value), 'draft field value');
  console.log('PASS native bundle recovery preserves edits, deletions, stamps and forms');

  await page.evaluate(() => { window.pendingMerge = session.client.save('test', {
    writeShared: plan => new Promise(resolve => { window.plan = plan; window.ack = () => resolve({ status: 'saved', version: plan.outputVersion }); }) }); });
  await page.waitForFunction(() => typeof ack === 'function');
  pdf = Buffer.from(await page.evaluate(() => Array.from(new Uint8Array(plan.data))));
  await page.evaluate(async () => {
    const shape = (await doc.annotations.list()).annotations.find(a => a.nm === 'new-shape');
    await session.annotations.update(shape.ref, { contents: 'edited during merge' });
    await session.client.flush(); ack(); await pendingMerge;
  });
  await saved(); await close(); await open();
  restored = await edits();
  assert.equal(restored.filter(a => a.nm === 'new-shape').length, 1);
  assert.ok(restored.some(a => a.contents === 'edited during merge'));
  console.log('PASS concurrent merge edits rebase and restore without duplicate annotations');
  pdf = Buffer.from(await page.evaluate(async () => {
    let output; await session.client.save('test', { writeShared: async plan => {
      output = Array.from(new Uint8Array(plan.data)); return { status: 'saved', version: plan.outputVersion }; } }); return output;
  }));
  assert.equal((await drafts()).length, 0);
  await close(); await open(); assert.equal((await edits()).filter(a => a.nm === 'new-shape').length, 1);
  await page.evaluate(async () => { const shape = (await doc.annotations.list()).annotations.find(a => a.nm === 'new-shape');
    await session.annotations.update(shape.ref, { contents: 'conflicting draft' }); await session.client.flush(); });
  await saved(); await close(); pdf = original; await open();
  assert.equal(await page.evaluate(() => session.client.getSnapshot('test').draftStatus), 'conflict');
  assert.ok(!(await edits()).some(a => a.contents === 'conflicting draft'));
  assert.ok((await drafts())[0].text.includes('conflicting draft'));
  await page.evaluate(() => session.client.request('test', 'sharedDiscardDraft')); assert.equal((await drafts()).length, 0);
  console.log('PASS external original conflict retains the draft until explicit discard');

  await page.evaluate(async () => { await session.annotations.create(0, { nm: 'crash-shape', subtype: 'square', box: { x: 20, y: 30, width: 40, height: 50 } }); await session.client.flush(); });
  await saved();
  pdf = Buffer.from(await page.evaluate(async () => { let output;
    try { await session.client.save('test', { writeShared: async plan => {
      output = Array.from(new Uint8Array(plan.data)); throw new Error('lost acknowledgement'); } }); } catch {} return output;
  }));
  assert.ok(JSON.parse((await drafts())[0].text).mergeOutputVersion);
  await close(); await open();
  assert.equal((await edits()).filter(a => a.nm === 'crash-shape').length, 1); assert.equal((await drafts()).length, 0);
  console.log('PASS interrupted save recognizes written output and never replays it twice');
  await close(); assert.deepEqual(errors, []);
} finally { await browser.close(); }
