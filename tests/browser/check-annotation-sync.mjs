// Verify public native events stay incremental across shared clients.
import assert from 'node:assert/strict';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
import { fixture } from '../support/pdf-editing-fixture.mjs';
const base = process.env.PDF_TEST_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext();
const errors = [];
context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
await context.route('**/annotation-sync-test', r => r.fulfill({ contentType: 'text/html', body: '<title>Native events</title>' }));
async function open() {
  const page = await context.newPage();
  await page.goto(`${base}/annotation-sync-test`);
  await page.evaluate(async bytes => {
    const { openBytes } = await import('/tests/support/shared-document-harness.ts');
    window.session = await openBytes(bytes, 'native-event-test');
    window.events = [];
    session.doc.events.subscribe(e => events.push(e));
  }, Array.from(fixture()));
  return page;
}
try {
  const a = await open();
  await a.evaluate(async () => {
    window.pageRef = (await session.doc.pages.list()).pages[0].ref;
    for (let i = 0; i < 80; i++) await session.doc.page(pageRef).annotations.create({ subtype: 'square', box: { x: 40, y: 40+i, width: 30, height: 20 }, contents: `seed-${i}` });
  });
  const b = await open();
  const fullBytes = await b.evaluate(async () => JSON.stringify(await session.doc.annotations.list()).length);
  await a.evaluate(async () => {
    const target = (await session.doc.annotations.list()).annotations.find(a => a.contents === 'seed-0');
    window.target = target;
    await session.doc.page(target.page).annotations.update(target.ref, { contents: 'one changed annotation' });
  });
  await b.waitForFunction(() => events.some(e => e.type === 'annotations.updated'));
  const metrics = await b.evaluate(async () => ({ events, notes: (await session.doc.annotations.list()).annotations.map(a => a.contents) }));
  const changed = metrics.events.filter(e => e.type === 'annotations.updated');
  assert.equal(changed.length, 1);
  assert.ok(JSON.stringify(changed).length < fullBytes / 4, 'one edit does not resend the entire annotation collection');
  assert.equal(metrics.notes.filter(c => c === 'one changed annotation').length, 1);
  assert.ok(metrics.notes.includes('seed-79'));
  await b.evaluate(() => { events.length = 0; });
  const late = await open();
  assert.equal(await late.evaluate(async () => (await session.doc.annotations.list()).annotations.length), 80);
  assert.equal(await b.evaluate(() => events.length), 0, 'late join does not broadcast existing annotations');
  await a.evaluate(() => session.doc.page(target.page).annotations.delete(target.ref));
  await b.waitForFunction(() => events.some(e => e.type === 'annotations.deleted'));
  await b.evaluate(() => session.client.request(session.doc.id, 'undo'));
  assert.equal(await a.evaluate(async () => (await session.doc.annotations.list()).annotations.filter(a => a.contents === 'one changed annotation').length), 1);
  assert.deepEqual(errors, []);
  console.log('PASS native incremental annotation events, late join, deletion and cross-client undo');
} finally { await browser.close(); }
