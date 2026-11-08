import assert from 'node:assert/strict';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
import { fixture } from './pdf-editing-fixture.mjs';
const base = process.env.PDF_TEST_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext();
const errors = [];
context.on('page', p => {
  p.on('pageerror', e => errors.push(e.message));
  if (process.env.DEBUG_PDF) p.on('console', m => console.log(m.type(), m.text()));
});
await context.route('**/v3-rpc-test', route => route.fulfill({ contentType: 'text/html', body: '<title>v3 RPC</title>' }));
const original = Array.from(fixture({ notes: true }));
async function open(bytes = original, identity = 'v3-rpc-test') {
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(`${base}/v3-rpc-test`);
  await page.evaluate(async ({bytes, identity}) => {
    const { createSharedPdfEngine } = await import('/apps/engine/shared-document-client.ts');
    window.session = createSharedPdfEngine({ defaultFallbackFonts: false });
    session.client.setIdentity(identity);
    await session.client.ready;
    window.doc = await session.engine.open({ kind: 'bytes', bytes: new Uint8Array(bytes), id: 'shared-fixture' });
    window.pageRef = (await doc.pages.list()).pages[0].ref;
  }, {bytes, identity});
  return page;
}
async function annotations(page) { return page.evaluate(async () => (await doc.annotations.list()).annotations.map(a => ({ subtype: a.subtype, contents: a.contents }))); }
try {
  const a = await open();
  const b = await open();
  assert.equal(await a.evaluate(() => doc.id), await b.evaluate(() => doc.id));
  const isolated = await open(original, 'different-file');
  await a.evaluate(async () => {
    window.created = await doc.page(pageRef).annotations.create({ subtype: 'square', box: { x: 20, y: 30, width: 40, height: 50 }, contents: 'shared native edit' });
  });
  assert.ok((await annotations(b)).some(a => a.contents === 'shared native edit'));
  assert.ok(!(await annotations(isolated)).some(a => a.contents === 'shared native edit'));
  await isolated.evaluate(() => session.engine.destroy()); await isolated.close();
  await b.evaluate(() => session.client.request(doc.id, 'undo'));
  assert.ok(!(await annotations(a)).some(a => a.contents === 'shared native edit'));
  await a.evaluate(() => session.client.request(doc.id, 'redo'));
  assert.equal((await annotations(b)).filter(a => a.contents === 'shared native edit').length, 1);
  console.log('PASS native v3 document sharing, different-file isolation and global undo/redo');
  await a.evaluate(() => session.client.setRenderTheme({mode:'background',background:0xff112233}));
  await b.evaluate(() => session.client.setRenderTheme({mode:'background',background:0xffaabbcc}));
  const pixel = p => p.evaluate(async () => Array.from(new Uint8Array((await doc.page(pageRef).render.raw({viewport:{kind:'width',width:100}})).data).slice(0,4)));
  assert.deepEqual(await pixel(a), [17,34,51,255]);
  assert.deepEqual(await pixel(b), [170,187,204,255]);
  assert.deepEqual(await pixel(a), [17,34,51,255]);
  assert.ok(Array.isArray(await a.evaluate(() => session.client.getFontDiagnostics())));
  console.log('PASS native render pixels and per-tab theme isolation');
  const painted = await open(Array.from(fixture({ content: '1 0 0 rg 100 100 200 200 re f\n' })), 'forced-colors-fixture');
  const center = p => p.evaluate(async () => { const r = await doc.page(pageRef).render.raw({ viewport: {kind:'width',width:612} }); return Array.from(new Uint8Array(r.data).slice(592*r.stride+200*4,592*r.stride+200*4+4)); });
  assert.deepEqual(await center(painted), [255,0,0,255]);
  await painted.evaluate(() => session.client.setRenderTheme({ mode:'forced-colors', background:0xff112233, pathFill:0xff00ff00, pathStroke:0xff00ff00, textFill:0xff00ff00, textStroke:0xff00ff00 }));
  // Existing forced-color behavior converts fills to outlines for readability.
  assert.deepEqual(await center(painted), [17,34,51,255]);
  const green = await painted.evaluate(async () => {
    const r = await doc.page(pageRef).render.raw({ viewport: {kind:'width',width:612} });
    const data = new Uint8Array(r.data); let count = 0;
    for (let y = 490; y <= 694; y++) for (let x = 98; x <= 302; x++) { const i = y*r.stride+x*4; if (data[i+1] > data[i]+30 && data[i+1] > data[i+2]+30) count++; }
    return count;
  });
  assert.ok(green > 300, 'forced colors retain the green rectangle outline in the original location');
  assert.deepEqual(await pixel(a), [17,34,51,255]);
  await painted.evaluate(() => session.engine.destroy()); await painted.close();
  console.log('PASS forced path color pixels and theme isolation');
  await a.waitForFunction(() => session.client.getSnapshot(doc.id)?.draftStatus === 'saved');
  const draft = await a.evaluate(() => session.client.request(doc.id, 'sharedDownloadDraft'));
  assert.ok(draft);
  console.log('PASS automatic draft after native annotation edit');
  const output = await a.evaluate(async () => {
    let bytes;
    await session.client.save(doc.id, { save: async () => false, writeShared: async plan => {
      bytes = Array.from(new Uint8Array(plan.data)); return { status: 'saved', version: plan.outputVersion };
    } });
    return bytes;
  });
  assert.ok(output.length > 0);
  assert.notDeepEqual(output, original);
  await a.evaluate(() => session.engine.destroy());
  await b.evaluate(() => session.engine.destroy());
  await a.close(); await b.close();
  const reopened = await open(output);
  assert.equal((await annotations(reopened)).filter(a => a.contents === 'shared native edit').length, 1);
  assert.equal(await reopened.evaluate(() => session.client.getSnapshot(doc.id).draftStatus), 'clean');
  await reopened.evaluate(() => session.engine.destroy());
  const secure = await open(original, 'security-test');
  const security = await secure.evaluate(async () => {
    await session.client.request(doc.id, 'setProtection', ['secret']);
    const encrypted = await doc.download({mode:'rewrite'});
    session.client.setIdentity('locked-test');
    const locked = await session.engine.open({kind:'bytes',bytes:encrypted.slice(),id:'locked'});
    const prompt = locked.security.passwordPrompt;
    await locked.security.unlock({password:'secret'});
    await session.client.request(locked.id, 'setProtection', [null]);
    const decrypted = await locked.download({mode:'rewrite'});
    session.client.setIdentity('decrypted-test');
    const clear = await session.engine.open({kind:'bytes',bytes:decrypted,id:'clear'});
    return {prompt, clear:clear.security.passwordPrompt, encryption:clear.security.state.encryption};
  });
  assert.equal(security.prompt.state,'required');
  assert.equal(security.clear.state,'none');
  assert.equal(security.encryption.state,'none');
  await secure.evaluate(() => session.engine.destroy()); await secure.close();
  console.log('PASS add password, locked reopen, unlock, remove password and clear reopen');
  assert.deepEqual(errors, []);
  console.log('PASS explicit rewrite, draft cleanup and merged PDF reopen');
} finally { await browser.close(); }
