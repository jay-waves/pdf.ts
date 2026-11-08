import { createHash } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
import { fixture } from './pdf-editing-fixture.mjs';
const dev = process.env.PDF_TEST_URL ?? 'http://127.0.0.1:5173';
const digest = data => createHash('sha256').update(data).digest('hex');
const original = fixture();
let bytes = original; let writes = 0;
const methods = [];
let draft = null;
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const errors = [];
let acceptDraftDiscard = false;
context.on('page', page => {
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async dialog => {
    if (acceptDraftDiscard && dialog.message().startsWith('Discard the stored .swp draft?')) return dialog.accept();
    errors.push(dialog.message()); await dialog.dismiss();
  });
  if (process.env.DEBUG_PDF) page.on('console', m => console.log(m.type(), m.text()));
});
const handleApi = async route => {
  const request = route.request();
  if (new URL(request.url()).pathname.endsWith('/draft')) {
    const token = draft === null ? 'missing' : digest(draft);
    if (request.method() === 'GET') return route.fulfill({ status: draft === null ? 204 : 200, headers: { ETag: `"${token}"`, 'Content-Type': 'application/json' }, body: draft ?? undefined });
    if (request.headers()['if-match'] !== `"${token}"`) return route.fulfill({ status: 409 });
    if (request.method() === 'PUT') {
      if (request.headers()['x-pdf-ts-version'] !== digest(bytes)) return route.fulfill({ status: 409 });
      draft = request.postDataBuffer();
    } else draft = null;
    return route.fulfill({ status: 204, headers: { ETag: `"${draft === null ? 'missing' : digest(draft)}"` } });
  }
  if (request.method() === 'PUT') {
    assert.equal(request.headers()['if-match'], `"${digest(bytes)}"`);
    methods.push(request.method());
    bytes = request.postDataBuffer();
    writes++;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: digest(bytes) }) });
  }
  return route.fulfill({ headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(bytes.length), ETag: `"${digest(bytes)}"`, 'Content-Disposition': 'inline; filename="shared.pdf"' }, body: request.method() === 'HEAD' ? undefined : bytes });
};
// SharedWorker fetches bypass Playwright routing. Serve the API over real HTTP
// so both dedicated and shared workers exercise the same draft CAS protocol.
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/api/documents/shared-ui')) {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    try {
      await handleApi({ request: () => ({ url: () => new URL(req.url, 'http://localhost').href,
        method: () => req.method, headers: () => req.headers, postDataBuffer: () => body }),
        fulfill: async ({status = 200, headers = {}, contentType, body}) => {
          res.writeHead(status, { ...headers, ...(contentType ? {'Content-Type': contentType} : {}) }); res.end(body);
        } });
    } catch (error) { errors.push(String(error)); res.writeHead(500); res.end(); }
    return;
  }
  const upstream = httpRequest(new URL(req.url, dev), {method: req.method, headers: req.headers}, response => {
    res.writeHead(response.statusCode, response.headers); response.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
async function open(fallback = false) {
  const page = await context.newPage();
  if (fallback) await page.addInitScript(() => { window.SharedWorker = undefined; });
  await page.goto(`${base}/?launcherDocument=shared-ui`);
  await page.waitForFunction(() => [...document.querySelectorAll('.pdf-page-render-image')].some(i => i.complete && i.naturalWidth));
  await page.getByRole('button', { name: 'Pin toolbar', exact: true }).click();
  return page;
}
async function draw(page, offset = 0) {
  await page.bringToFront();
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.locator('[aria-label="Rectangle"]').click();
  const rect = await page.locator('.pdf-page-surface').first().boundingBox();
  await page.mouse.move(rect.x + 100 + offset, rect.y + 100 + offset); await page.mouse.down();
  await page.mouse.move(rect.x + 220 + offset, rect.y + 180 + offset, { steps: 8 }); await page.mouse.up();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
}
try {
  const a = await open(); const b = await open();
  const originalId = await b.locator('[data-pdf-document-layer]').getAttribute('data-pdf-document-layer');
  const initialAnnotations = await b.locator('.pdf-annotation-layer').first().innerHTML();
  await draw(a);
  if (process.env.DEBUG_PDF) { console.log('DRAW STATE', await a.title(), await b.title(), await b.locator('.pdf-annotation-layer').innerHTML()); }
  await b.waitForFunction(() => document.title.startsWith('*'));
  await b.waitForFunction(html => document.querySelector('.pdf-annotation-layer')?.innerHTML !== html && document.querySelector('.pdf-annotation-layer svg, .pdf-annotation-layer img'), initialAnnotations);
  await a.locator('main[data-draft-status="saved"]').waitFor({timeout:10000}).catch(async error => { console.error(await a.locator('main').getAttribute('data-draft-status')); throw error; });
  assert.equal(writes, 0, 'autosave must not write the PDF');
  assert.ok(draft);
  await a.getByRole('button', { name: 'Save to PDF', exact: true }).click();
  await a.waitForFunction(() => !document.title.startsWith('*'));
  await b.waitForFunction(() => !document.title.startsWith('*'));
  assert.equal(writes, 1);
  await b.bringToFront();
  await b.waitForTimeout(2500); // Two external-file polls must not reload an own shared save.
  assert.equal(await b.locator('[data-pdf-document-layer]').getAttribute('data-pdf-document-layer'), originalId);
  assert.equal(await b.getByRole('dialog', { name: 'Document Updated' }).count(), 0);
  await draw(b, 200);
  await b.getByRole('button', { name: 'Save to PDF', exact: true }).click();
  await a.waitForFunction(() => !document.title.startsWith('*'));
  await b.waitForFunction(() => !document.title.startsWith('*'));
  assert.equal(writes, 2);
  const beforeTheme = await b.locator('.pdf-page-render-image').first().getAttribute('src');
  await a.getByRole('button', { name: 'Dark theme', exact: true }).click();
  await b.waitForFunction(() => document.documentElement.dataset.viewerColorMode === 'dark');
  await b.waitForFunction(src => document.querySelector('.pdf-page-render-image')?.src !== src, beforeTheme);
  const c = await open(); // Reopen saved bytes should attach to the original session/history.
  await c.keyboard.press('Control+z');
  await a.waitForFunction(() => document.title.startsWith('*'));
  const fallback = await open(true);
  await draw(fallback, 130);
  await fallback.locator('main[data-draft-status="saved"]').waitFor();
  // An independent worker now owns the latest sidecar. The original session
  // must explicitly resolve that conflict before replacing the PDF.
  await draw(c, 270);
  await c.getByRole('button', { name: 'Discard stored draft', exact: true }).waitFor();
  assert.equal(writes, 2, 'draft conflict must not write the PDF');
  acceptDraftDiscard = true;
  await c.getByRole('button', { name: 'Discard stored draft', exact: true }).click();
  await c.locator('main[data-draft-status="saved"]').waitFor();
  acceptDraftDiscard = false;
  await c.getByRole('button', { name: 'Save to PDF', exact: true }).click();
  await a.waitForFunction(() => !document.title.startsWith('*'));
  await fallback.bringToFront();
  await fallback.getByRole('dialog', { name: 'Document Updated' }).waitFor({ timeout: 10000 });
  assert.deepEqual(methods, ['PUT', 'PUT', 'PUT']);
  assert.equal(bytes.toString('latin1').match(/%%EOF/g).length, 1, 'full saves must not accumulate PDF revisions');
  assert.deepEqual(errors, []);
  console.log('PASS: real viewer cross-tab paint, dirty/save state, successive full PUT saves from both tabs, no own-save reload, theme and PDF rerender, history retained after reopening saved bytes; independent fallback retains external-change conflict checks.');
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
