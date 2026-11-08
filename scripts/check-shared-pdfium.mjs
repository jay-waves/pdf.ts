// Run against `pnpm dev`. Uses the existing global Playwright and system Chrome.
import assert from 'node:assert/strict';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';

const base = process.env.PDF_TEST_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext();
const errors = [];
context.on('weberror', event => errors.push(String(event.error())));
await context.route('**/__pdf-worker-test', route => route.fulfill({
  contentType: 'text/html', body: '<!doctype html><title>PDF worker integration</title>',
}));
async function page({ fallback = false, denied = false } = {}) {
  const p = await context.newPage();
  if (fallback) await p.addInitScript(() => { window.SharedWorker = undefined; });
  if (denied) await p.addInitScript(() => {
    window.SharedWorker = class { constructor() { throw new DOMException('Blocked', 'SecurityError'); } };
  });
  p.on('console', m => { if (process.env.DEBUG_PDF) console.log(m.type(), m.text()); });
  await p.goto(`${base}/__pdf-worker-test`);
  await p.evaluate(async () => {
    const { createPdfWorker } = await import('/apps/renderer/pdf-worker-transport.ts');
    const { RemoteExecutor } = await import('/node_modules/@embedpdf/engines/dist/lib/pdfium/web/worker-engine.js');
    const { PDFIUM_FONT_FALLBACK } = await import('/apps/fonts/catalog.ts');
    window.transport = createPdfWorker();
    window.executor = new RemoteExecutor(transport, {
      wasmUrl: '/node_modules/@embedpdf/pdfium/dist/pdfium.wasm', fontFallback: PDFIUM_FONT_FALLBACK,
    });
    window.rpc = (method, args = []) => executor.send(method, args).toPromise();
    await Promise.race([executor.readyTask.toPromise(), new Promise((_, reject) => setTimeout(() => reject(new Error('Worker initialization timed out')), 40000))]);
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>',
      '<< /Length 0 >>\nstream\n\nendstream',
      '<< /Title (base) >>',
    ];
    let pdf = '%PDF-1.4\n';const offsets = [0];
    objects.forEach((body, i) => { offsets.push(pdf.length);pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
    const start = pdf.length;
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R /Info 5 0 R >>\nstartxref\n${start}\n%%EOF\n`;
    window.fixture = new TextEncoder().encode(pdf);
    window.doc = await rpc('openDocumentBuffer', [{ id: 'same-document', content: fixture.slice().buffer }]);
    window.pixel = async () => {
      const image = await rpc('renderPageRaw', [doc, doc.pages[0], { scaleFactor: 1 }]);
      return Array.from(image.data.slice(0, 4));
    };
  });
  return p;
}
try {
  const [a, b, c] = await Promise.all([page(), page(), page()]);
  console.log('Concurrent startup passed');
  const cdp = await browser.newBrowserCDPSession();
  const targets = await cdp.send('Target.getTargets');
  assert.equal(targets.targetInfos.filter(t => t.type === 'shared_worker').length, 1);
  assert.equal(targets.targetInfos.filter(t => t.type === 'worker').length, 0);
  await Promise.all([a.evaluate(() => rpc('setMetadata', [doc, { title: 'tab A' }])),
    b.evaluate(() => rpc('setMetadata', [doc, { title: 'tab B' }]))]);
  assert.equal(await a.evaluate(async () => (await rpc('getMetadata', [doc])).title), 'tab A');
  assert.equal(await b.evaluate(async () => (await rpc('getMetadata', [doc])).title), 'tab B');
  await a.evaluate(() => rpc('setRenderTheme', [{ mode: 'background', background: 0xff112233 }]));
  await b.evaluate(() => rpc('setRenderTheme', [{ mode: 'background', background: 0xffaabbcc }]));
  for (let i = 0; i < 5; i++) {
    const pixels = await Promise.all([a.evaluate(() => pixel()), b.evaluate(() => pixel()), c.evaluate(() => pixel())]);
    assert.deepEqual(pixels, [[17, 34, 51, 255], [170, 187, 204, 255], [255, 255, 255, 255]]);
  }
  const invalid = await a.evaluate(async () => {
    try {
      await rpc('openDocumentBuffer', [{ id: 'invalid', content: new Uint8Array([1, 2, 3]).buffer }]);
      return null;
    } catch (error) { return error.reason; }
  });
  assert.equal(typeof invalid?.code, 'number');
  const saved = await a.evaluate(async () => {
    const content = new Uint8Array(await rpc('saveAsCopy', [doc]));
    const reopened = await rpc('openDocumentBuffer', [{ id: 'saved', content: content.buffer }]);
    return { title: (await rpc('getMetadata', [reopened])).title };
  });
  assert.equal(saved.title, 'tab A');
  await a.evaluate(() => rpc('closeAllDocuments'));
  assert.equal(await b.evaluate(async () => (await rpc('getMetadata', [doc])).title), 'tab B');
  await a.evaluate(() => executor.destroy());
  await a.close();
  // A crashed renderer cannot run pagehide. Its Web Lock must still be released.
  console.log('Isolation, save and close passed');
  const sessionC = await context.newCDPSession(c);
  void sessionC.send('Page.crash').catch(() => {});
  await c.waitForEvent('crash', { timeout: 10000 });
  console.log('Crash event received');
  await c.close();
  console.log('C closed');
  await b.waitForFunction(async () => {
    const locks = await navigator.locks.query();
    return locks.pending.filter(l => l.name.startsWith('pdf-ts-session:')).length === 1;
  });
  console.log('Lease cleanup passed');
  assert.deepEqual(await b.evaluate(() => pixel()), [170, 187, 204, 255]);
  const fresh = await page();
  assert.equal(await fresh.evaluate(async () => (await rpc('getMetadata', [doc])).title), 'base');
  const fallback = await page({ fallback: true });
  const denied = await page({ denied: true });
  assert.deepEqual(await fallback.evaluate(() => pixel()), [255, 255, 255, 255]);
  assert.deepEqual(await denied.evaluate(() => pixel()), [255, 255, 255, 255]);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS: one shared instance; concurrent startup; document and theme isolation; full save; session close; renderer crash cleanup; reconnect; unsupported/blocked fallback.');
} finally {
  await browser.close();
}
