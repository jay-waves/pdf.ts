import assert from 'node:assert/strict';
import test from 'node:test';
import { localEngine } from '@embedpdf/engine';
import { createKernel } from '@embedpdf/core';
import { searchPlugin, SearchToken } from '@embedpdf/react/search';
import { outlinePlugin, OutlineToken } from '@embedpdf/react/outline';
import { viewerFeaturesFixture } from './support/viewer-features-fixture.mjs';

async function setup(t) {
  const engine = localEngine({ runtime: { prefer: 'wasm' }, defaultFallbackFonts: false });
  const kernel = createKernel({ engine, plugins: [searchPlugin(), outlinePlugin()] });
  t.after(async () => { await kernel.destroy(); await engine.destroy(); });
  await kernel.start();
  const { document } = await kernel.documents.open({ kind: 'bytes', bytes: viewerFeaturesFixture() });
  return { kernel, document, search: kernel.capability(SearchToken, document.id) };
}

test('v3 search starts at the requested page, preserves active hits, replaces and clears results', async t => {
  const { search } = await setup(t);
  await search.search({ text: 'alpha' }, { from: 1 });
  assert.equal(search.getHitCount(), 3);
  assert.equal(search.getActiveHit().pageIndex, 1);
  search.nextHit();
  assert.equal(search.getActiveHitIndex(), 1);
  await search.search({ text: 'beta', wholeWord: true });
  assert.equal(search.getHitCount(), 1);
  assert.equal(search.getActiveHit().pageIndex, 1);
  await search.search({ text: 'ALPHA', matchCase: true });
  assert.equal(search.getHitCount(), 0);
  search.clear();
  assert.equal(search.getStatus(), 'idle');
  assert.equal(search.getActiveHit(), null);
});

test('v3 outline loads after document readiness, preserves hierarchy and PDF action destinations', async t => {
  const { kernel, document } = await setup(t);
  const outline = kernel.capability(OutlineToken, document.id);
  await outline.ensureLoaded();
  assert.equal(outline.getStatus(), 'ready');
  assert.equal(outline.list().length, 4);
  const [chapter, nested, second, website] = outline.list();
  assert.equal(nested.parent.objectNumber, chapter.ref.objectNumber);
  assert.equal(second.target.destination.page.objectNumber, 5);
  assert.equal(second.target.destination.zoom, 1.5);
  assert.equal(website.target.uri, 'https://example.com/reference');
  outline.collapse(chapter.ref);
  assert.equal(outline.listRows().length, 3);
  outline.expand(chapter.ref);
  assert.equal(outline.listRows().length, 4);
});
