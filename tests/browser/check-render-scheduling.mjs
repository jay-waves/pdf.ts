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

await withViewer(async (page, errors) => {
  const result = await page.evaluate(async bytes => {
    const { SharedDocumentClient } = await import('/apps/engine/shared-document-client.ts');
    const { createPdfWorker } = await import('/apps/engine/pdf-worker-transport.ts');
    const ports = [createPdfWorker(), createPdfWorker()];
    const clients = ports.map(port => new SharedDocumentClient(port, { defaultFallbackFonts: false }));
    clients.forEach(client => client.setIdentity('visibility-scheduling'));
    try {
      const docs = await Promise.all(clients.map((client, index) => client.engine.open({
        kind: 'bytes', bytes: new Uint8Array(bytes), id: `visibility-${index}`,
      })));
      const { pages } = await docs[0].pages.list();
      const documents = (await clients[0].getRuntimeDiagnostics()).documents;
      const render = (session, index, width) => docs[session].with({ view: 'test' }).page(pages[index].ref)
        .render.raw({ viewport: { kind: 'width', width } });
      // Explicit protocol hints make this deterministic in headless Chrome;
      // DOM visibility and BFCache delivery are covered by transport tests.
      ports[0].postMessage({ type: 'visibility', visible: false });
      ports[1].postMessage({ type: 'visibility', visible: true });
      docs[0].setWorkingSet('test', [{ page: pages[1].ref, role: 'visible', pixels: 800_000 }]);
      docs[1].setWorkingSet('test', [{ page: pages[2].ref, role: 'visible', pixels: 800_000 }]);
      await Promise.all(docs.map(doc => doc.pages.list()));
      const order = [];
      const blocker = render(1, 0, 3000);
      const hidden = render(0, 1, 800).then(() => order.push('hidden'));
      const visible = render(1, 2, 800).then(() => order.push('visible'));
      await Promise.all([blocker, hidden, visible]);

      // A new viewport received while hidden must become effective on return.
      docs[0].setWorkingSet('test', [{ page: pages[3].ref, role: 'visible', pixels: 800_000 }]);
      ports[0].postMessage({ type: 'visibility', visible: true });
      await docs[0].pages.list();
      const restoredOrder = [];
      const nextBlocker = render(0, 0, 3000);
      const stale = render(0, 1, 800).then(() => restoredOrder.push('stale'));
      const restored = render(0, 3, 800).then(() => restoredOrder.push('restored'));
      await Promise.all([nextBlocker, stale, restored]);
      return { documents, order, restoredOrder };
    } finally { await Promise.all(clients.map(client => client.engine.destroy())); }
  }, [...scrollingFixture({ pageCount: 4, pathCount: 5000 })]);
  assert.deepEqual(result, { documents: 1, order: ['visible', 'hidden'], restoredOrder: ['restored', 'stale'] });
  assert.deepEqual(errors, []);
  console.log('PASS shared-document sessions deprioritize hidden reads and restore their latest viewport.');
});
