import assert from 'node:assert/strict';
import { withViewer } from '../support/browser-viewer.mjs';
import { scrollingFixture } from '../support/scrolling-fixture.mjs';

await withViewer(async (page, errors) => {
  const result = await page.evaluate(async bytes => {
    const { createSharedPdfEngine } = await import('/apps/engine/shared-document-client.ts');
    const session = createSharedPdfEngine({ defaultFallbackFonts: false });
    const doc = await session.engine.open({ kind: 'bytes', bytes: new Uint8Array(bytes), id: 'queue-test' });
    try {
      const { pages } = await doc.pages.list();
      const order = [];
      const render = (index, width) => doc.with({ view: 'test' }).page(pages[index].ref).render.raw({ viewport: { kind: 'width', width } });
      // Keep the native lane occupied while the port receives a burst of new work.
      const blocker = render(0, 3000);
      const stale = render(1, 800).then(() => order.push('stale'));
      const cancelled = render(2, 800);
      const rejected = cancelled.then(() => false, () => true);
      const latest = render(3, 800).then(() => order.push('latest'));
      doc.setWorkingSet('test', [{ page: pages[3].ref, role: 'visible', pixels: 800 * 1000 }]);
      await Promise.resolve(); // The requests have crossed the port before cancellation.
      cancelled.abort();
      await Promise.all([blocker, stale, latest]);
      return { order, cancelled: await rejected };
    } finally { await session.engine.destroy(); }
  }, [...scrollingFixture({ pageCount: 4, pathCount: 5000 })]);
  assert.deepEqual(result.order, ['latest', 'stale'], 'latest visible page must pass queued obsolete reads in the real worker');
  assert.equal(result.cancelled, true);
  assert.deepEqual(errors, []);
  console.log('PASS real worker prioritizes the latest viewport and propagates cancellation.');
});


await withViewer(async (page, errors) => {
  const result = await page.evaluate(async bytes => {
    const { createSharedPdfEngine } = await import('/apps/engine/shared-document-client.ts');
    const session = createSharedPdfEngine({ defaultFallbackFonts: false });
    const doc = await session.engine.open({ kind: 'bytes', bytes: new Uint8Array(bytes), id: 'bulk-test' });
    try {
      const { pages } = await doc.pages.list();
      const order = [];
      const snapshot = doc.annotations.list().then(value => { order.push('snapshot'); return value; });
      const render = doc.with({ view: 'test' }).page(pages[20].ref).render.raw({ viewport: { kind: 'width', width: 800 } })
        .then(() => order.push('visible'));
      doc.setWorkingSet('test', [{ page: pages[20].ref, role: 'visible', pixels: 800 * 1000 }]);
      const edit = doc.page(pages[20].ref).annotations.create({ subtype: 'text', rect: { x: 80, y: 80, width: 20, height: 20 }, contents: 'after snapshot' })
        .then(() => order.push('edit'));
      const before = await snapshot;
      await Promise.all([render, edit]);
      const after = await doc.annotations.list();
      return { order, pages: before.pages.length, before: before.annotations.length,
        hadEdit: before.annotations.some(a => a.contents === 'after snapshot'), after: after.annotations.length };
    } finally { await session.engine.destroy(); }
  }, [...scrollingFixture({ pageCount: 48, pathCount: 50, annotationsPerPage: 8 })]);
  assert.deepEqual(result, { order: ['visible', 'snapshot', 'edit'], pages: 48, before: 384, hadEdit: false, after: 385 });
  assert.deepEqual(errors, []);
  console.log('PASS bulk annotation snapshots yield to visible pixels without letting edits cross the snapshot.');
});
