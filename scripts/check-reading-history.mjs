import assert from 'node:assert/strict';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
import { fixture } from './pdf-editing-fixture.mjs';

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage();
  const bytes = fixture({ secondPage: true });
  const key = `local:history.pdf:${bytes.length}:123`;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.PDF_TEST_URL ?? 'http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Choose or drop a PDF file' }).waitFor();
  // This development-server check seeds the same IndexedDB record as the app.
  await page.evaluate(async key => {
    const { browserPersistence } = await import('/apps/platform/browser-storage.ts');
    await browserPersistence.writeReadingProgress(key, { pageNumber: 2 });
  }, key);
  for (let attempt = 0; attempt < 3; attempt++) {
    const dataTransfer = await page.evaluateHandle(bytes => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], 'history.pdf', { type: 'application/pdf', lastModified: 123 }));
      return transfer;
    }, [...bytes]);
    await page.getByRole('button', { name: 'Choose or drop a PDF file' }).dispatchEvent('drop', { dataTransfer });
    await page.waitForFunction(() => document.querySelector('[aria-label="Current page"]')?.value === '2');
    await page.reload();
    await page.getByRole('button', { name: 'Choose or drop a PDF file' }).waitFor();
    assert.equal(await page.evaluate(async key => {
      const { browserPersistence } = await import('/apps/platform/browser-storage.ts');
      return (await browserPersistence.readReadingProgress(key))?.pageNumber;
    }, key), 2);
  }
  assert.deepEqual(errors, []);
  console.log('PASS saved page restores across three cold document opens and remains in browser storage');
} finally { await browser.close(); }
