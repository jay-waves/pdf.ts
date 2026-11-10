import assert from 'node:assert/strict';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
import { fixture } from './pdf-editing-fixture.mjs';

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const bytes = fixture({ secondPage: true });
  const key = `local:history.pdf:${bytes.length}:123`;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.PDF_TEST_URL ?? 'http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Choose or drop a PDF file' }).waitFor();
  // This development-server check seeds the same IndexedDB record as the app.
  await page.evaluate(async key => {
    const { set } = await import('/node_modules/.vite/deps/idb-keyval.js');
    await set('embedpdf-reading-history-v1', { [key]: { pageNumber: 2 }, untouched: { pageNumber: 99 } });
  }, key);
  const open = async () => {
    const dataTransfer = await page.evaluateHandle(bytes => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], 'history.pdf', { type: 'application/pdf', lastModified: 123 }));
      return transfer;
    }, [...bytes]);
    await page.getByRole('button', { name: 'Choose or drop a PDF file' }).dispatchEvent('drop', { dataTransfer });
    await page.waitForFunction(() => document.querySelector('[aria-label="Current page"]')?.value === '2');
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    await open();
    await page.reload();
    await page.getByRole('button', { name: 'Choose or drop a PDF file' }).waitFor();
    assert.equal(await page.evaluate(async key => {
      const { browserPersistence } = await import('/apps/platform/browser-storage.ts');
      return (await browserPersistence.readReadingProgress(key))?.pageNumber;
    }, key), 2);
  }
  const read = () => page.evaluate(async key => {
    const { browserPersistence } = await import('/apps/platform/browser-storage.ts');
    return browserPersistence.readReadingProgress(key);
  }, key);
  await page.evaluate(async key => {
    const { get } = await import('/node_modules/.vite/deps/idb-keyval.js');
    const old = await get('embedpdf-reading-history-v1');
    if (old.untouched.pageNumber !== 99) throw new Error('Legacy records must remain intact');
    const { browserPersistence } = await import('/apps/platform/browser-storage.ts');
    await browserPersistence.writeReadingProgress(key, {
      pageNumber: 2, viewpoint: { anchor: { pageIndex: 1, fractionX: .4, fractionY: .35 }, zoom: { level: 2.25 } },
    });
  }, key);
  await open();
  await page.mouse.move(640, 25);
  await page.getByRole('button', { name: 'Pin toolbar', exact: true }).click();
  await page.getByRole('button', { name: 'Page', exact: true }).click();
  const zoom = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  assert.equal(await zoom.inputValue(), '225%');
  const paper = page.locator('[data-pdf-page-index="1"]').first();
  const initial = await paper.boundingBox();
  await page.mouse.move(640, 450);
  await page.mouse.wheel(0, 200);
  const waitForProgress = async predicate => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (predicate(await read())) return;
      await page.waitForTimeout(100);
    }
    throw new Error('Reading progress was not persisted');
  };
  await waitForProgress(value => value?.viewpoint?.anchor.fractionY > .4);
  const before = await paper.boundingBox();
  assert.ok(before.y < initial.y - 100, 'same-page scroll must move and persist');
  const saved = await read();
  assert.equal(saved.viewpoint.zoom.level, 2.25);
  await page.reload();
  await page.getByRole('button', { name: 'Choose or drop a PDF file' }).waitFor();
  await open();
  const after = await paper.boundingBox();
  assert.ok(Math.abs(after.y - before.y) < 2, 'precise vertical position restores');
  assert.ok(Math.abs(after.x - before.x) < 2, 'precise horizontal position restores');
  await page.getByRole('button', { name: 'Page', exact: true }).click();
  assert.equal(await zoom.inputValue(), '225%');
  await page.getByRole('button', { name: 'Zoom presets', exact: true }).click();
  await page.getByText('Fit width', { exact: true }).click();
  await waitForProgress(value => value?.viewpoint?.zoom.mode === 'fit-width');
  const wideZoom = await zoom.inputValue();
  await page.reload();
  await page.getByRole('button', { name: 'Choose or drop a PDF file' }).waitFor();
  await page.setViewportSize({ width: 1000, height: 900 });
  await open();
  await page.getByRole('button', { name: 'Page', exact: true }).click();
  assert.notEqual(await zoom.inputValue(), wideZoom, 'fit-width must recalculate after a window resize');
  assert.deepEqual(errors, []);
  console.log('PASS legacy migration, per-file records, zoom, same-page position and responsive fit-width restoration');
} finally { await browser.close(); }
