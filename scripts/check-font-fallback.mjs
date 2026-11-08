// Exercise synchronous, on-demand PDFium font fallback in the actual SharedWorker.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
import { fixture } from './pdf-editing-fixture.mjs';
const fontPath = process.env.PDF_TEST_FONT ?? '/usr/share/fonts/google-noto-vf/NotoSans[wght].ttf';
const font = await readFile(fontPath);
let requests = 0;
const server = createServer((_req, res) => { requests++; res.writeHead(200, { 'Content-Type': 'font/ttf', 'Access-Control-Allow-Origin': '*' }); res.end(font); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const fontUrl = `http://127.0.0.1:${server.address().port}/fallback.ttf`;
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const context = await browser.newContext();
  await context.route('**/font-test', route => route.fulfill({ contentType: 'text/html', body: '<title>Font fallback</title>' }));
  const page = await context.newPage();
  await page.goto(`${process.env.PDF_TEST_URL ?? 'http://127.0.0.1:5173'}/font-test`);
  await page.evaluate(async fontUrl => {
    const { createSharedPdfEngine } = await import('/apps/renderer/shared-document-client.ts');
    window.session = createSharedPdfEngine({ fontFallback: { fonts: {}, defaultFont: fontUrl }, defaultFallbackFonts: false });
    await session.client.ready;
  }, fontUrl);
  assert.equal(requests, 0, 'initialization does not eagerly load fonts');
  const diagnostics = await page.evaluate(async bytes => {
    const doc = await session.engine.open({ kind: 'bytes', bytes: new Uint8Array(bytes) });
    const p = (await doc.pages.list()).pages[0];
    await doc.page(p.ref).render.raw({ viewport: { kind: 'width', width: 612 } });
    await doc.page(p.ref).render.raw({ viewport: { kind: 'width', width: 306 } });
    return session.client.getFontDiagnostics();
  }, Array.from(fixture({ fontName: 'MissingTestFont', content: 'BT /Helv 20 Tf 100 300 Td (Font fallback test) Tj ET\n' })));
  assert.equal(requests, 1, 'font bytes fetched once and reused');
  assert.ok(diagnostics.some(d => d.url === fontUrl && ['loaded', 'cached'].includes(d.status) && d.bytes > 0));
  console.log('PASS actual worker font fallback: no eager requests, on-demand load, cached rerender and diagnostics');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
