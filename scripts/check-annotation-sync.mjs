// Run against pnpm dev. Verifies protocol payloads and SDK state reference reuse.
import assert from 'node:assert/strict';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
import { fixture } from './pdf-editing-fixture.mjs';
const base = process.env.PDF_TEST_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext();
const errors = [];
context.on('page', page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { errors.push(dialog.message()); await dialog.dismiss(); });
});
await context.route('**/annotation-sync-test', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Annotation sync</body></html>' }));
await context.route('**/two-pages.pdf', route => route.fulfill({ contentType: 'application/pdf', body: fixture({ secondPage: true }) }));
async function open() {
  const page = await context.newPage();
  await page.goto(`${base}/annotation-sync-test`);
  await page.evaluate(async () => {
    const { open } = await import('/scripts/shared-document-harness.ts');
    window.session = await open('annotation-sync-test', '/two-pages.pdf');
    window.received = []; window.sent = []; window.refreshes = [];
    session.worker.addEventListener('message', event => {
      if (event.data.type === 'sharedDocument' || event.data.type === 'result') received.push(event.data);
    });
    const send = session.worker.postMessage.bind(session.worker);
    session.worker.postMessage = (message, transfer) => { sent.push(message); send(message, transfer); };
    session.registry.getStore().subscribe(action => { if (action.type === 'REFRESH_PAGES') refreshes.push(action.payload); });
  });
  return page;
}
async function reset(page) { await page.evaluate(() => { received = []; sent = []; refreshes = []; }); }
try {
  const a = await open();
  await a.evaluate(async () => {
    for (let i = 0; i < 80; i++) session.annotations.createAnnotation(i % 2, {
      id: `seed-${i}`, type: 5, pageIndex: i % 2,
      rect: { origin: { x: 40, y: 40 + i }, size: { width: 30, height: 20 } },
      color: '#ff0000', opacity: 1, strokeWidth: 2, flags: [],
    });
    await session.client.flush();
  });
  const b = await open();
  const fullBytes = await b.evaluate(async () => {
    session.annotations.selectAnnotation(1, 'seed-79');
    window.untouched = session.annotations.getState().byUid['seed-79'];
    window.untouchedPage = session.annotations.getState().pages[1];
    const reply = await session.client.request('test', 'sharedSnapshot');
    // Capture references after this deliberate recovery snapshot.
    untouched = session.annotations.getState().byUid['seed-79']; untouchedPage = session.annotations.getState().pages[1];
    return new TextEncoder().encode(JSON.stringify(reply.snapshot)).byteLength;
  });
  await reset(a); await reset(b);
  await a.evaluate(async () => {
    session.annotations.updateAnnotation(0, 'seed-0', { contents: 'one changed annotation' });
    await session.client.flush();
  });
  await b.waitForFunction(() => session.annotations.getState().byUid['seed-0'].object.contents === 'one changed annotation');
  const metrics = await b.evaluate(() => {
    const messages = received.filter(m => m.type === 'sharedDocument');
    return {
      broadcasts: messages.length,
      fullSnapshots: messages.filter(m => m.snapshot.annotations !== undefined).length,
      changedAnnotations: messages.reduce((n, m) => n + m.snapshot.changes.upsert.length, 0),
      bytes: new TextEncoder().encode(JSON.stringify(messages[0].snapshot)).byteLength,
      refreshes, selected: session.annotations.getState().selectedUid,
      preservedObject: session.annotations.getState().byUid['seed-79'] === untouched,
      preservedPage: session.annotations.getState().pages[1] === untouchedPage,
      cachesAnnotations: 'annotations' in session.client.getSnapshot('test'),
    };
  });
  assert.equal(metrics.broadcasts, 1); assert.equal(metrics.fullSnapshots, 0);
  assert.equal(metrics.changedAnnotations, 1);
  assert.equal(metrics.preservedObject, true); assert.equal(metrics.preservedPage, true);
  assert.equal(metrics.selected, 'seed-79'); assert.equal(metrics.cachesAnnotations, false);
  assert.ok(metrics.refreshes.length > 0);
  assert.ok(metrics.refreshes.every(event => event.pageIndexes.every(index => index === 0)));
  const outbound = await a.evaluate(() => sent.filter(m => m.method === 'sharedEdit').flatMap(m => m.args[1]));
  assert.equal(outbound.length, 1); assert.equal(outbound[0].id, 'seed-0');
  assert.equal('annotation' in outbound[0], false, 'patch does not resend the old full annotation');
  const acknowledgements = await a.evaluate(() => received.filter(m => m.type === 'result' && m.data?.snapshot));
  assert.equal(acknowledgements.length, 1);
  assert.equal('annotations' in acknowledgements[0].data.snapshot, false);
  assert.equal('changes' in acknowledgements[0].data.snapshot, false);
  await reset(b);
  const late = await open();
  assert.equal(await late.evaluate(() => Object.keys(session.annotations.getState().byUid).length), 81);
  assert.equal(await b.evaluate(() => received.filter(m => m.type === 'sharedDocument').length), 0, 'join does not broadcast a full document to existing tabs');
  await a.evaluate(async () => { session.annotations.deleteAnnotation(0, 'seed-0'); await session.client.flush(); });
  await b.waitForFunction(() => !session.annotations.getState().byUid['seed-0']);
  await b.evaluate(async () => { session.history.undo(); await session.client.flush(); });
  await a.waitForFunction(() => session.annotations.getState().byUid['seed-0']?.object.contents === 'one changed annotation');
  await a.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 8, 8);
    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    session.annotations.createAnnotation(0, { id: 'image-stamp', type: 13, pageIndex: 0,
      rect: { origin: { x: 100, y: 100 }, size: { width: 40, height: 40 } }, flags: [], opacity: 1,
    }, { data: await png.arrayBuffer(), mimeType: 'image/png' });
    await session.client.flush();
  });
  await b.waitForFunction(() => !!session.annotations.getState().byUid['image-stamp']);
  await b.evaluate(async () => { session.history.undo(); await session.client.flush(); });
  await a.waitForFunction(() => !session.annotations.getState().byUid['image-stamp']);
  await b.evaluate(async () => { session.history.redo(); await session.client.flush(); });
  await a.waitForFunction(() => !!session.annotations.getState().byUid['image-stamp']);
  assert.ok(await b.evaluate(async () => {
    const doc = session.manager.getDocument('test');
    const stamp = session.annotations.getState().byUid['image-stamp'].object;
    return (await session.engine.exportAnnotationAppearanceAsPdf(doc, doc.pages[0], stamp).toPromise()).byteLength;
  }), 'stamp appearance survives delta synchronization and cross-tab undo/redo');
  assert.deepEqual(errors, []);
  console.log('PASS: delta-only sync, patch-only commands, metadata-only ACK, page-local refresh, local selection/reference preservation, late join, delete/undo, stamp appearance round-trip.', { fullBytes, deltaBytes: metrics.bytes, reductionPercent: +(100 * (1 - metrics.bytes / fullBytes)).toFixed(1) });
} finally { await browser.close(); }
