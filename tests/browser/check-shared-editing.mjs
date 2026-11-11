import assert from 'node:assert/strict';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
import { fixture } from '../support/pdf-editing-fixture.mjs';
const base = process.env.PDF_TEST_URL ?? 'http://127.0.0.1:5173';
const bytes = fixture();
// Native file handles crossing a SharedWorker require a regular Chrome profile.
const context = await chromium.launchPersistentContext('', { channel: 'chrome' });
const errors = [];
context.on('page', page => { page.on('pageerror', error => errors.push(error.message));
  if (process.env.DEBUG_PDF) page.on('console', m => console.log(m.type(), m.text())); });
await context.route('**/shared-test', route => route.fulfill({ contentType: 'text/html', body: 'Shared editing test' }));
async function tab(identity = 'same-file', fallback = false) {
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  if (fallback) await page.addInitScript(() => { window.SharedWorker = undefined; });
  await page.goto(`${base}/shared-test`);
  await page.evaluate(async ({ identity, bytes }) => {
    const { openBytes } = await import('/tests/support/shared-document-harness.ts');
    const fileIdentity = identity.startsWith('handle:') ? await (await navigator.storage.getDirectory()).getFileHandle(identity.slice(7), { create: true }) : identity;
    if (typeof fileIdentity !== 'string' && !(await fileIdentity.getFile()).size) {
      const writable = await fileIdentity.createWritable(); await writable.write(new Uint8Array(bytes)); await writable.close();
    }
    window.session = await openBytes(bytes, fileIdentity);
  }, { identity, bytes: [...bytes] });
  return page;
}
const ids = page => page.evaluate(() => session.annotations.list().filter(a => a.subtype === 'square').map(a => a.nm));
async function create(page, id) {
  await page.evaluate(async id => { await session.annotations.create(0, { nm: id, subtype: 'square', box: { x: 50, y: 50, width: 100, height: 60 } }); await session.client.flush(); }, id);
}
const seen = (page, id, present = true) => page.waitForFunction(({ id, present }) => session.annotations.list().some(a => a.nm === id) === present, { id, present });
async function close(page) { await page.evaluate(async () => { await session.kernel.destroy(); await session.engine.destroy(); }); await page.close(); }
try {
  const a = await tab(), b = await tab();
  await create(a, 'a'); await seen(b, 'a');
  await create(b, 'b'); await seen(a, 'b');
  await a.evaluate(() => session.history.undo()); await seen(b, 'b', false);
  await b.evaluate(() => session.history.redo()); await seen(a, 'b');
  await b.evaluate(async () => { await session.form.setValue(session.form.list()[0].ref, { value: 'cross-tab form' }); await session.client.flush(); });
  await a.waitForFunction(() => session.form.list()[0].value === 'cross-tab form');
  await a.evaluate(() => session.history.undo()); await b.waitForFunction(() => session.form.list()[0].value === 'initial');
  await b.evaluate(() => session.history.redo()); await a.waitForFunction(() => session.form.list()[0].value === 'cross-tab form');
  console.log('PASS native plugin mirrors, global annotation/form undo and redo across tabs');
  const late = await tab(); assert.deepEqual((await ids(late)).sort(), ['a', 'b']);
  await close(a); await create(b, 'survivor'); await seen(late, 'survivor');
  await close(late); await close(b);
  const reopened = await tab(); await seen(reopened, 'survivor'); await close(reopened);
  console.log('PASS late join, owner closure, surviving edits and last-tab draft recovery');

  const ha = await tab('handle:same.pdf'), hb = await tab('handle:same.pdf');
  await create(ha, 'handle-shared'); await seen(hb, 'handle-shared');
  await close(ha); await close(hb);
  const fallback = await tab('fallback', true); await create(fallback, 'dedicated-worker'); await seen(fallback, 'dedicated-worker'); await close(fallback);
  console.log('PASS isSameEntry file-handle identity and dedicated-worker fallback');

  // Close immediately after committed edits, while the debounce/write can still be pending.
  const closing = await tab('close-pending-draft');
  await create(closing, 'close-pending'); await close(closing);
  const recovered = await tab('close-pending-draft'); await seen(recovered, 'close-pending'); await close(recovered);
  console.log('PASS last-tab close flushes pending draft without deadlocking the worker');

  const saving = await tab('close-pending-merge');
  await create(saving, 'merge-before-close');
  await saving.evaluate(() => {
    window.pendingSave = session.client.save('test', { writeShared: plan => new Promise(resolve => {
      window.output = Array.from(new Uint8Array(plan.data)); window.ack = () => resolve({ status: 'saved', version: plan.outputVersion });
    }) });
  });
  await saving.waitForFunction(() => typeof ack === 'function');
  await saving.evaluate(() => { window.pendingClose = session.kernel.destroy(); });
  await saving.evaluate(async () => { ack(); await pendingSave; await pendingClose; await session.engine.destroy(); });
  await saving.close();
  const independent = await tab('worker-still-alive'); await create(independent, 'after-merge-close'); await close(independent);
  console.log('PASS last-tab close during an acknowledged merge releases the save lane');
  assert.deepEqual(errors, []);
} finally { await context.close(); }
