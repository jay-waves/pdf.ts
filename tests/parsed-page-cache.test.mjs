import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createPdfRuntime } from '@embedpdf/engine-runtime';
import { LocalEngine } from '@embedpdf/engine';
import * as esm from '@embedpdf/engine-services';
import { AdaptivePageCache } from '../apps/engine/adaptive-page-cache.ts';
import { scrollingFixture } from './support/scrolling-fixture.mjs';
const cjs = createRequire(import.meta.url)('@embedpdf/engine-services');

for (const [format, { WorkerHost }] of [['ESM', esm], ['CJS', cjs]]) {
  test(`${format}: real WASM cache pressure promotes, stops reparsing, and safely demotes`, async () => {
    const runtime = await createPdfRuntime({ prefer: 'wasm' });
    const listeners = new Set();
    const host = new WorkerHost(runtime, pack => { for (const fn of listeners) fn(pack.payload); });
    const cache = host.parsedPageCache;
    let policy;
    const engine = LocalEngine.fromTransport({ transport: {
      send: pack => host.receive(pack.payload),
      onMessage(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      async terminate() { policy?.dispose(); cache.disarmTimer(); await runtime.destroy(); listeners.clear(); },
    } });
    try {
      const doc = await engine.open({ kind: 'bytes', bytes: scrollingFixture({ pageCount: 2, pathCount: 200 }) }, { scope: ['*'] });
      const refs = (await doc.pages.list()).pages.map(page => page.ref);
      const render = index => doc.page(refs[index]).render.raw({ viewport: { kind: 'width', width: 64 } });
      await render(0);
      const base = cache.bytes + 1024;
      cache.closeIdle();
      let time = 0;
      policy = new AdaptivePageCache(cache, () => time, base);
      for (let i = 0; i < 12 && cache.budgetBytes === base; i++) await render(i % 2);
      assert.equal(cache.budgetBytes, base * 2);
      assert.equal(policy.stats().promotions, 1);
      // Once both pages fit, another alternating pass should use cached parses.
      await render(0); await render(1);
      const before = policy.stats();
      for (let i = 0; i < 6; i++) await render(i % 2);
      assert.equal(policy.stats().rapidRebuilds, before.rapidRebuilds);
      assert.equal(policy.stats().budgetEvictions, before.budgetEvictions);
      assert.equal(cache.size, 2);

      policy.dispose();
      const events = [];
      cache.observe(event => events.push(event));
      await doc.page(refs[0]).annotations.create({ subtype: 'text', rect: { x: 10, y: 10, width: 20, height: 20 }, contents: 'invalidate' });
      assert.ok(events.some(event => event.type === 'reset'), 'writes reset old eviction attribution');
      events.length = 0;
      cache.closeIdle();
      assert.ok(events.some(event => event.type === 'forget'));
      assert.ok(!events.some(event => event.type === 'evict'), 'explicit clear is not budget pressure');

      policy = new AdaptivePageCache(cache, () => time, base);
      for (let i = 0; i < 12 && cache.budgetBytes === base; i++) await render(i % 2);
      assert.equal(cache.budgetBytes, base * 2);
      time = 60_000; policy.check();
      assert.equal(cache.budgetBytes, base * 2, 'quiet alone cannot discard the working set');
      await doc.close();
      assert.equal(cache.bytes, 0);
      policy.check();
      assert.equal(cache.budgetBytes, base);
      assert.equal(policy.stats().demotions, 1);
    } finally { await engine.destroy(); }
  });
}

// Small budgets reproduce pressure cheaply; production keeps its 64/128 MiB tiers.
async function replayDocuments(count, adaptive, oneWay = false, resumeAfterShrink = false) {
  const runtime = await createPdfRuntime({ prefer: 'wasm' });
  const listeners = new Set();
  const host = new esm.WorkerHost(runtime, pack => { for (const fn of listeners) fn(pack.payload); });
  const cache = host.parsedPageCache;
  let policy, loads = 0;
  const originalLoad = runtime.fn.EPDFDoc_StartLoadPageByObjectNumber;
  runtime.fn.EPDFDoc_StartLoadPageByObjectNumber = (...args) => { loads++; return originalLoad(...args); };
  const engine = LocalEngine.fromTransport({ transport: {
    send: pack => host.receive(pack.payload),
    onMessage(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async terminate() { policy?.dispose(); cache.disarmTimer(); await runtime.destroy(); listeners.clear(); },
  } });
  try {
    const docs = [], refs = [], hashes = [];
    for (let i = 0; i < count; i++) {
      const doc = await engine.open({ kind: 'bytes', bytes: scrollingFixture({ pageCount: 12, pathCount: [50, 200, 700][i] }) }, { scope: ['*'] });
      docs.push(doc); refs.push((await doc.pages.list()).pages.map(page => page.ref));
      await doc.page(refs[i][0]).render.raw({ viewport: { kind: 'width', width: 64 } });
    }
    const base = Math.ceil(cache.bytes * 1.1);
    cache.closeIdle(); cache.setBudget(base); loads = 0;
    let time = 0;
    if (adaptive) policy = new AdaptivePageCache(cache, () => time, base);
    const replay = async (rounds, start = 0) => {
      for (let round = start; round < start + rounds; round++) for (let selected = 0; selected < count; selected++) {
        const page = oneWay ? round : round % 2;
        docs.forEach((doc, i) => doc.setWorkingSet('reading', i === selected
          ? [{ page: refs[i][page], role: 'visible', pixels: 100_000 }] : []));
        const raster = await docs[selected].page(refs[selected][page]).render.raw({
          viewport: { kind: 'width', width: round % 3 === 0 ? 96 : 64 },
        });
        hashes.push(createHash('sha256').update(new Uint8Array(raster.data)).digest('hex'));
        assert.ok(cache.budgetBytes <= 2 * base);
      }
    };
    await replay(8);
    if (!oneWay) {
      const before = loads;
      await replay(4, 8);
      if (adaptive) assert.equal(loads, before, 'warm switching/scrolling/zooming reuses all page parses');
      const edit = await docs[0].page(refs[0][0]).annotations.create({
        subtype: 'text', rect: { x: 20, y: 20, width: 20, height: 20 }, contents: 'switching edit',
      });
      assert.ok((await docs[0].page(refs[0][0]).annotations.list()).annotations.some(a => a.contents === 'switching edit'));
      await docs[0].apply({ undoOf: edit.meta.opId });
      assert.ok(!(await docs[0].page(refs[0][0]).annotations.list()).annotations.some(a => a.contents === 'switching edit'));
      await replay(2);
    }
    let resumeLoads;
    if (resumeAfterShrink) {
      // Model background idle cleanup, budget shrink, then the reader returning
      // to the same two/three documents. Timings use the controller's clock;
      // eviction, loading and pixels still come from the real WASM runtime.
      cache.closeIdle();
      time = 60_000; policy?.check();
      assert.equal(cache.budgetBytes, base);
      const before = loads;
      await replay(4);
      resumeLoads = loads - before;
      if (adaptive) {
        assert.equal(policy.stats().rollbacks, 1);
        assert.equal(policy.stats().shrinkDelayMs, 120_000);
        const warm = loads;
        await replay(2);
        assert.equal(loads, warm, 'restored budget ends the new parsing churn');
      } else await replay(2);
      cache.closeIdle();
      time = 120_000; policy?.check();
      assert.equal(cache.budgetBytes, adaptive ? base * 2 : base, 'failed shrink extends the next wait');
      time = 180_000; policy?.check();
      assert.equal(cache.budgetBytes, base);
      time = 190_001; policy?.check();
      if (adaptive) assert.equal(policy.stats().shrinkDelayMs, 60_000, 'successful shrink clears old backoff');
    }
    return { loads, hashes, stats: policy?.stats(), base, resumeLoads };
  } finally { await engine.destroy(); }
}

for (const count of [2, 3]) test(`${count} PDFs: adaptive vs fixed budget during switching, scrolling back, zoom and editing`, async t => {
  const fixed = await replayDocuments(count, false);
  const adaptive = await replayDocuments(count, true);
  assert.deepEqual(adaptive.hashes, fixed.hashes, 'all rendered pixels must match the fixed-budget baseline');
  assert.equal(adaptive.stats.promotions, 1);
  assert.ok(adaptive.loads < fixed.loads, JSON.stringify({ fixed: fixed.loads, adaptive: adaptive.loads }));
  t.diagnostic(`Native page loads: fixed=${fixed.loads}, adaptive=${adaptive.loads}; pixels identical.`);
});

test('three PDFs: one-way reading does not increase the budget merely because pages are evicted', async () => {
  const result = await replayDocuments(3, true, true);
  assert.ok(result.stats.budgetEvictions > 0);
  assert.equal(result.stats.rapidRebuilds, 0);
  assert.equal(result.stats.promotions, 0);
  assert.equal(result.stats.budgetBytes, result.base);
});

for (const count of [2, 3]) test(`${count} PDFs: returning after an idle shrink restores the old budget and prevents another early shrink`, async t => {
  const fixed = await replayDocuments(count, false, false, true);
  const adaptive = await replayDocuments(count, true, false, true);
  assert.deepEqual(adaptive.hashes, fixed.hashes, 'rollback must preserve every rendered pixel');
  assert.ok(adaptive.resumeLoads < fixed.resumeLoads);
  assert.equal(adaptive.stats.promotions, 2, 'initial promotion plus one rollback');
  assert.equal(adaptive.stats.rollbacks, 1);
  assert.equal(adaptive.stats.budgetBytes, adaptive.base, 'a later successful shrink still reclaims budget');
  t.diagnostic(`Page loads after idle shrink: fixed=${fixed.resumeLoads}, adaptive=${adaptive.resumeLoads}; pixels identical.`);
});
