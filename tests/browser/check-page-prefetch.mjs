import assert from 'node:assert/strict';
import { withViewer, dropPdf } from '../support/browser-viewer.mjs';
import { scrollingFixture } from '../support/scrolling-fixture.mjs';

for (const mode of ['off', 'on']) await withViewer(async (page, errors) => {
  await page.evaluate(mode => localStorage.setItem('pdf-viewer-energy-saving-v1', mode), mode);
  await page.reload();
  await page.evaluate(() => {
    window.pageReads = [];
    const ports = new WeakSet();
    const post = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (message, ...args) {
      if (!ports.has(this)) {
        ports.add(this);
        this.addEventListener('message', ({ data }) => {
          const entry = window.pageReads.find(read => read.id === data.id);
          if (entry && data.type === 'result') { entry.done = true; entry.error = data.error; }
        });
      }
      if (message?.type === 'call') {
        const objectNumber = message.path.find(part => part.page)?.page.objectNumber;
        if (objectNumber) window.pageReads.push({ id: message.id, objectNumber, method: message.method,
          tile: !!message.args[0]?.target, speculative: !document.querySelector(`[data-pdf-page-index="${(objectNumber - 3) / 2}"]`), view: message.path.find(part => part.with?.view)?.with.view });
      }
      return post.call(this, message, ...args);
    };
  });
  await dropPdf(page, scrollingFixture({ pageCount: 6 }), 'prefetch.pdf');
  await page.waitForFunction(() => window.pageReads.some(read => read.speculative && read.method === 'raw' && !read.tile && read.done && !read.error));
  const warm = await page.evaluate(() => window.pageReads.find(read => read.speculative && read.method === 'raw' && !read.tile && read.done && !read.error));
  const targetIndex = (warm.objectNumber - 3) / 2;
  const visible = await page.locator('[data-pdf-page-index]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.pdfPageIndex)));
  assert.equal(targetIndex, Math.max(...visible) + 1);
  assert.equal(await page.locator(`[data-pdf-page-index="${targetIndex}"]`).count(), 0, 'prefetch must not mount an offscreen page');
  // Annotation metadata still follows the SDK's own stage subscriptions.
  const neighbourReads = await page.evaluate(number => window.pageReads.filter(read => read.objectNumber === number && read.method !== 'list'), warm.objectNumber);
  assert.deepEqual(neighbourReads.map(read => [read.method, read.tile]), [['raw', false]], 'only one base raster, no text or appearance reads');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.pageReads.filter(read => read.speculative && read.method === 'raw' && !read.tile).length), 1, 'no chain of speculative pages');
  await page.mouse.move(640, 875);
  await page.getByRole('textbox', { name: 'Current page', exact: true }).fill(String(targetIndex + 1));
  await page.getByRole('textbox', { name: 'Current page', exact: true }).press('Enter');
  await page.locator(`[data-pdf-page-index="${targetIndex}"] canvas[data-plane=base][data-painted=true]`).waitFor();
  assert.equal(await page.evaluate(number => window.pageReads.filter(read => read.objectNumber === number && read.method === 'raw' && !read.tile).length, warm.objectNumber), 1,
    'entering the prefetched page must reuse the original base cache entry');
  assert.deepEqual(errors, []);
  console.log(`PASS ${mode}: one adjacent base only, no offscreen layers, and cache reuse on navigation.`);
});
