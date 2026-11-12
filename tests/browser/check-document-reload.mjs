import { createHash } from 'node:crypto';
// Targeted browser integration: run against pnpm dev, with a simulated launcher.
import assert from 'node:assert/strict';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
const base = process.env.PDF_TEST_URL ?? 'http://127.0.0.1:5173';
function fixture(version) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R 9 0 R] /Count 4 >>'];
  for (let i = 0; i < 4; i++) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 11 0 R >> >> /Contents ${4 + i * 2} 0 R >>`);
    const content = `BT /F1 28 Tf 50 700 Td (Version ${version}, page ${i + 1}) Tj ET`;
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf = '%PDF-1.4\n';const offsets = [0];
  objects.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const start = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf);
}
let version = 1;
let invalid = false;
let protectedUpdate = false;
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.route('**/api/documents/reload-test*', async route => {
  const body = invalid ? Buffer.from('invalid-pdf') : protectedUpdate ? Buffer.concat([encrypted, Buffer.from(`\n% revision ${version}\n`)]) : fixture(version);
  const headers = { 'Content-Type': 'application/pdf', 'Content-Length': String(body.length), ETag: `"${createHash('sha256').update(body).digest('hex')}"`, 'Content-Disposition': 'inline; filename="reload.pdf"' };
  if (route.request().method() !== 'HEAD' && version > 1) await new Promise(r => setTimeout(r, 800));
  await route.fulfill({ status: 200, headers, body: route.request().method() === 'HEAD' ? undefined : body });
});
const page = await context.newPage();
await page.goto(base);
const encrypted = Buffer.from(await page.evaluate(async source => {
  const { createSharedPdfEngine } = await import('/apps/engine/shared-document-client.ts');
  const { engine, client } = createSharedPdfEngine();
  try {
    const doc = await engine.open({ kind: 'bytes', bytes: new Uint8Array(source), id: 'encrypted-fixture' });
    await client.request(doc.id, 'setProtection', ['secret']);
    return Array.from(await doc.download({ mode: 'rewrite' }));
  } finally { await engine.destroy(); }
}, [...fixture('protected')]));
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (process.env.DEBUG_PDF) console.log(m.type(), m.text()); });
const activeId = () => page.locator('[data-pdf-document-layer][aria-hidden="false"]').getAttribute('data-pdf-document-layer');
try {
  await page.goto(`${base}/?launcherDocument=reload-test`);
  await page.waitForFunction(() => [...document.querySelectorAll('.pdf-render img, .pdf-render canvas[data-plane=base]')].some(i => (i.tagName === 'CANVAS' ? i.dataset.painted === 'true' : i.complete && i.naturalWidth)));
  await page.getByRole('button', { name: 'Pin toolbar', exact: true }).click();
  await page.getByRole('button', { name: 'Page', exact: true }).click();
  await page.getByRole('textbox', { name: 'Zoom percentage' }).fill('150');
  await page.getByRole('textbox', { name: 'Zoom percentage' }).press('Enter');
  await page.getByRole('button', { name: 'Rotate', exact: true }).click();
  await page.waitForTimeout(300);
  const originalPageSize = await page.locator('.pdf-page').first().boundingBox();
  await page.locator('.viewer').hover(); await page.mouse.wheel(0, 950);
  await page.evaluate(async () => {
    let previous = NaN, stable = 0;
    for (let frames = 0; frames < 120 && stable < 6; frames++) {
      await new Promise(requestAnimationFrame);
      const y = document.querySelector('.pdf-page').getBoundingClientRect().y;
      stable = y === previous ? stable + 1 : 0; previous = y;
    }
  });
  const before = await activeId();
  const position = (await page.locator('.pdf-page').first().boundingBox()).y;
  await page.evaluate(() => {
    window.framesChecked = 0; window.blankFrames = 0; window.watchFrames = true;
    const check = () => {
      if (!window.watchFrames) return;
      window.framesChecked++;
      const layer = document.querySelector('[data-pdf-document-layer][aria-hidden="false"]');
      const images = layer ? [...layer.querySelectorAll('.pdf-render img, .pdf-render canvas[data-plane=base]')] : [];
      if (!images.some(i => {
        const r = i.getBoundingClientRect();
        return (i.tagName === 'CANVAS' ? i.dataset.painted === 'true' : i.complete && i.naturalWidth) && r.bottom > 0 && r.top < innerHeight;
      })) window.blankFrames++;
      requestAnimationFrame(check);
    };requestAnimationFrame(check);
  });
  version = 2;
  await page.waitForFunction(old => document.querySelector('[data-pdf-document-layer][aria-hidden="false"]')?.dataset.pdfDocumentLayer !== old, before, { timeout: 25000 });
  await page.waitForTimeout(300);
  const after = await activeId();
  const nextPosition = (await page.locator('.pdf-page').first().boundingBox()).y;
  assert.ok(Math.abs(position - nextPosition) < 3, `Scroll moved: ${position} -> ${nextPosition}`);
  assert.equal(await page.locator('[data-pdf-document-layer]').count(), 1);
  const nextPageSize = await page.locator('.pdf-page').first().boundingBox();
  assert.equal(nextPageSize.width, originalPageSize.width);
  assert.equal(nextPageSize.height, originalPageSize.height);
  assert.equal(await page.getByRole('textbox', { name: 'Zoom percentage' }).inputValue(), '150%');
  console.log('Replacement preserved zoom, rotation and scroll:', position, nextPosition);
  invalid = true; version = 3;
  await page.getByRole('alert').filter({ hasText: 'current version is still open' }).waitFor({ timeout: 20000 });
  assert.equal(await activeId(), after);
  assert.equal(await page.locator('[data-pdf-document-layer]').count(), 1);
  invalid = false; version = 4;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.waitForFunction(old => document.querySelector('[data-pdf-document-layer][aria-hidden="false"]')?.dataset.pdfDocumentLayer !== old, after, { timeout: 25000 });
  await page.waitForTimeout(300);
  const samples = await page.evaluate(() => { window.watchFrames = false; return { framesChecked: window.framesChecked, blankFrames: window.blankFrames }; });
  assert.equal(samples.blankFrames, 0, JSON.stringify(samples));
  assert.equal(errors.length, 0, errors.join('\n'));
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.locator('[aria-label="Rectangle"]').click();
  await page.locator('.viewer').hover(); await page.mouse.wheel(0, -10000); await page.waitForTimeout(300);
  const rect = await page.locator('.pdf-page').first().boundingBox();
  await page.mouse.move(Math.max(50, rect.x + 150), Math.max(100, rect.y + 150));
  await page.mouse.down();
  await page.mouse.move(Math.max(50, rect.x + 150) + 120, Math.max(100, rect.y + 150) + 80, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => document.title.startsWith('*'));
  const dirtyId = await activeId();
  version = 5;
  await page.getByRole('dialog', { name: 'Document Updated' }).waitFor({ timeout: 20000 });
  assert.equal(await activeId(), dirtyId);
  await page.getByRole('button', { name: 'Discard Changes', exact: true }).click();
  await page.waitForFunction(old => document.querySelector('[data-pdf-document-layer][aria-hidden="false"]')?.dataset.pdfDocumentLayer !== old, dirtyId, { timeout: 25000 });
  assert.equal(await page.title(), 'reload.pdf');
  console.log('PASS: unsaved edits prompt before replacement.');
  const unencryptedId = await activeId();
  protectedUpdate = true; version = 6;
  await page.getByRole('dialog', { name: 'Password required' }).waitFor({ timeout: 20000 });
  assert.equal(await activeId(), unencryptedId);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('dialog', { name: 'Password required' }).waitFor({ state: 'hidden' });
  assert.equal(await activeId(), unencryptedId);
  version = 7;
  await page.getByRole('dialog', { name: 'Password required' }).waitFor({ timeout: 20000 });
  await page.locator('input[type="password"]').fill('secret');
  await page.getByRole('button', { name: 'Open PDF', exact: true }).click();
  await page.waitForFunction(old => document.querySelector('[data-pdf-document-layer][aria-hidden="false"]')?.dataset.pdfDocumentLayer !== old, unencryptedId, { timeout: 25000 });
  console.log('PASS: protected replacement can be cancelled or unlocked while retaining the old view.');
  console.log('PASS: background replacement, scroll retained, invalid update preserves old document, retry succeeds, no blank frames:', samples);
} finally { await browser.close(); }
