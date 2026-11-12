// Manual file-open measurement on a Vite server; never a release/test gate.
// node tests/profiling/profile-open.mjs file.pdf --page 200 --samples 5
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  page: { type: 'string', default: '1' }, samples: { type: 'string', default: '5' },
} });
if (!positionals[0]) throw Error('Provide a local PDF path. Start pnpm dev first.');
const target = Number(values.page), samples = Number(values.samples);
assert.ok(Number.isSafeInteger(target) && target > 0 && Number.isSafeInteger(samples) && samples > 0);
const file = resolve(positionals[0]);
const bytes = await readFile(file);
const base = process.env.PDF_TEST_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'chrome' });
const results = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/__open_profile.pdf', route => route.fulfill({ contentType: 'application/pdf', body: bytes }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (let sample = 0; sample < samples; sample++) {
    await page.goto(base);
    const choose = page.getByRole('button', { name: 'Choose or drop a PDF file' });
    await choose.waitFor();
    const transfer = await page.evaluateHandle(async ({ name, target }) => {
      const buffer = await (await fetch('/__open_profile.pdf')).arrayBuffer();
      const key = `local:${name}:${buffer.byteLength}:123`;
      const { browserPersistence } = await import('/apps/platform/browser-storage.ts');
      await browserPersistence.writeReadingProgress(key, { pageNumber: target });
      const data = new DataTransfer();
      data.items.add(new File([buffer], name, { type: 'application/pdf', lastModified: 123 }));
      window.openProfile = { key, target, firstPaint: null, targetPaint: null, start: 0 };
      return data;
    }, { name: basename(file), target });
    await page.evaluate(() => {
      const state = window.openProfile;
      const observer = new MutationObserver(() => {
        const now = performance.now() - state.start;
        if (state.firstPaint === null && document.querySelector('canvas[data-painted="true"]')) state.firstPaint = now;
        if (state.targetPaint === null && document.querySelector(`[data-pdf-page-index="${state.target - 1}"] canvas[data-plane="base"][data-painted="true"]`)) {
          state.targetPaint = now;
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-painted'] });
      state.start = performance.now();
    });
    await choose.dispatchEvent('drop', { dataTransfer: transfer });
    await page.waitForFunction(() => window.openProfile.targetPaint !== null, null, { timeout: 120_000 });
    await page.waitForFunction(async () => {
      const { browserPersistence } = await import('/apps/platform/browser-storage.ts');
      return (await browserPersistence.readReadingProgress(window.openProfile.key))?.pageNumber === window.openProfile.target
        && document.querySelector('[aria-label="Current page"]')?.value === String(window.openProfile.target);
    });
    const result = await page.evaluate(() => ({ firstPaintMs: window.openProfile.firstPaint, targetPaintMs: window.openProfile.targetPaint }));
    results.push(result);
    console.log(JSON.stringify({ sample: sample + 1, ...result }));
    await transfer.dispose();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
const times = results.map(r => r.targetPaintMs).sort((a, b) => a - b);
const middle = Math.floor(times.length / 2);
const report = { file: basename(file), bytes: bytes.length, page: target, samples,
  scope: 'Preloaded viewer shell; file drop to target base canvas paint, not OS launch or final tile refinement.',
  medianMs: times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2, minMs: times[0], maxMs: times.at(-1), results };
console.log(JSON.stringify(report, null, 2));
if (process.env.PDF_BENCH_OUTPUT) await writeFile(process.env.PDF_BENCH_OUTPUT, JSON.stringify(report, null, 2));
