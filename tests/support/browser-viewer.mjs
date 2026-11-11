// Helpers for ad hoc local integration checks, never release CI/CD.
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';

export async function withViewer(check, options = {}) {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, ...options });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.PDF_TEST_URL ?? 'http://127.0.0.1:5173');
    await check(page, errors);
  } finally { await browser.close(); }
}

export async function dropPdf(page, bytes, name) {
  const dataTransfer = await page.evaluateHandle(({ bytes, name }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], name, { type: 'application/pdf' }));
    return transfer;
  }, { bytes: [...bytes], name });
  try {
    await page.getByRole('button', { name: 'Choose or drop a PDF file' }).dispatchEvent('drop', { dataTransfer });
  } finally { await dataTransfer.dispose(); }
}
