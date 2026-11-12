import assert from 'node:assert/strict';
import { withViewer, dropPdf } from '../support/browser-viewer.mjs';
import { scrollingFixture } from '../support/scrolling-fixture.mjs';

for (const mode of ['off', 'on']) await withViewer(async (page, errors) => {
  await page.evaluate(mode => localStorage.setItem('pdf-viewer-energy-saving-v1', mode), mode);
  await page.reload();
  await page.evaluate(() => {
    window.renderRequests = [];
    const post = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (message, ...args) {
      if (message?.type === 'call' && message.method === 'raw') {
        window.renderRequests.push(message.path.find(segment => segment.page)?.page.objectNumber);
      }
      return post.call(this, message, ...args);
    };
  });
  await dropPdf(page, scrollingFixture(), 'scrollbar.pdf');
  await page.locator('canvas[data-plane=base][data-painted=true]').first().waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-canvas-tiles]')].every(e => e.dataset.fetching === '0'));
  const bar = await page.locator('.pdf-scrollbar-y').boundingBox();
  const thumb = await page.locator('.pdf-scrollbar-y .pdf-scroll-thumb').boundingBox();
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  await page.evaluate(() => { window.renderRequests = []; });
  await page.mouse.move(thumb.x + thumb.width / 2, bar.y + bar.height * 0.85, { steps: 45 });
  const released = Date.now();
  await page.mouse.up();
  if (mode === 'on') assert.ok(await page.locator('[data-canvas-tiles]').evaluateAll(nodes =>
    nodes.length > 0 && nodes.every(node => node.dataset.paused === 'false')),
  'scrollbar release resumes tiles immediately instead of waiting for the settle timer');
  await page.waitForFunction(() => {
    const pages = [...document.querySelectorAll('[data-pdf-page-index]')];
    return pages.length > 0 && pages.every(p => Number(p.dataset.pdfPageIndex) > 70 &&
      p.querySelector('canvas[data-plane=base][data-painted=true]'));
  });
  const rendered = await page.evaluate(() => new Set(window.renderRequests).size);
  const latency = Date.now() - released;
  assert.ok(latency < 1000, `destination remained blank for ${latency} ms`);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-canvas-tiles]')].every(e => e.dataset.fetching === '0' && e.dataset.paused === 'false'));
  const before = await page.evaluate(() => window.renderRequests.length);
  await page.waitForTimeout(250);
  const extra = await page.evaluate(before => {
    const last = Math.max(...[...document.querySelectorAll('[data-pdf-page-index]')].map(node => Number(node.dataset.pdfPageIndex)));
    return { requests: window.renderRequests.slice(before), neighbour: 3 + (last + 1) * 2 };
  }, before);
  assert.ok(extra.requests.length <= 1 && extra.requests.every(number => number === extra.neighbour),
    'settled view may warm one neighbour, but must not restart visible renders');
  assert.deepEqual(errors, []);
  console.log(`PASS ${mode}: scrollbar jump reaches painted destination; ${latency} ms to destination; ${rendered} pages requested pixels.`);
});
