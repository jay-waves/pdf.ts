import assert from 'node:assert/strict';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
import { fixture } from './pdf-editing-fixture.mjs';

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.PDF_TEST_URL ?? 'http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Choose or drop a PDF file' }).waitFor();
  const dataTransfer = await page.evaluateHandle(bytes => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'pan.pdf', { type: 'application/pdf' }));
    return transfer;
  }, [...fixture({ secondPage: true })]);
  await page.getByRole('button', { name: 'Choose or drop a PDF file' }).dispatchEvent('drop', { dataTransfer });
  const paper = page.locator('[data-pdf-page-index="0"]').first();
  await paper.waitFor();
  await page.mouse.move(640, 25);
  await page.getByRole('button', { name: 'Pin toolbar', exact: true }).click();
  const pan = page.getByRole('button', { name: 'Pan', exact: true });
  async function drag() {
    const before = await paper.boundingBox();
    const x = before.x + before.width / 2;
    await page.mouse.move(x, 550);
    await page.mouse.down();
    await page.mouse.move(x, 430, { steps: 12 });
    const after = await paper.boundingBox();
    await page.mouse.up();
    return before.y - after.y;
  }
  await pan.click();
  assert.equal(await pan.getAttribute('aria-pressed'), 'true');
  assert.ok(await drag() > 80, 'Pan must move the page with the left mouse button');
  await pan.click();
  assert.equal(await pan.getAttribute('aria-pressed'), 'false');
  assert.ok(Math.abs(await drag()) < 2, 'Disabling Pan must stop left-button panning on the page');
  await pan.click();
  assert.ok(await drag() > 80, 'Pan must work again after toggling');
  await page.getByRole('button', { name: 'Page', exact: true }).click();
  assert.equal(await page.locator('.viewer').evaluate(el => el.classList.contains('is-pan-mode')), false);
  assert.ok(Math.abs(await drag()) < 2, 'Clearing the tool must reset panning and its UI state');
  const selectArea = async () => {
    await page.getByRole('button', { name: 'Zoom presets', exact: true }).click();
    await page.getByText('Fit area', { exact: true }).click();
  };
  await selectArea();
  await page.getByRole('region', { name: 'Reading area', exact: true }).waitFor();
  await selectArea();
  await page.getByRole('region', { name: 'Reading area', exact: true }).waitFor({ state: 'hidden' });
  await selectArea();
  await page.getByRole('region', { name: 'Reading area', exact: true }).waitFor();
  await pan.click();
  await page.getByRole('region', { name: 'Reading area', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await pan.getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Presentation mode', exact: true }).click();
  await page.locator('section[data-viewer-presentation]').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('section[data-viewer-presentation]').waitFor({ state: 'hidden' });
  await page.mouse.move(640, 25);
  assert.equal(await pan.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(errors, []);
  console.log('PASS pan toggling, page-tool reset, reading-area toggle, and presentation reset');
} finally {
  await browser.close();
}
