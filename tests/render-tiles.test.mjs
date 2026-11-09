import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire, registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { createTestContext, manualClock } from '@embedpdf/core/testing';
import { AbortablePromise } from '@embedpdf/engine-core/runtime';
import { toPageRef } from '@embedpdf/core';
import { renderPlugin } from '@embedpdf/plugin-render';
import { PDF_TILE_SCALES } from '../apps/renderer/tile-levels.ts';

// Exercise the installed patched store, not a copied implementation. This test-only
// export is deliberately tied to our version-pinned patch and never shipped.
const entry = import.meta.resolve('@embedpdf/plugin-render');
const hooks = registerHooks({ load(url, context, next) {
  if (url === `${entry}?store-test`) return { format: 'module', shortCircuit: true,
    source: readFileSync(new URL(entry), 'utf8') + '\nexport { RasterStore as TestRasterStore };' };
  return next(url, context);
} });
const { TestRasterStore: RasterStore } = await import(`${entry}?store-test`);
hooks.deregister();
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const raster = bytes => ({ width: bytes / 4, height: 1, stride: bytes, data: new ArrayBuffer(bytes) });

test('raw cache accounts exact bytes, evicts after release, and reuses the same buffer', async () => {
  const store = new RasterStore(16);
  let calls = 0;
  const load = () => { calls++; return Promise.resolve(raster(12)); };
  const first = await store.acquire('a', load);
  assert.equal((await store.acquire('a', load)).data, first.data);
  assert.equal(calls, 1);
  await store.acquire('b', load);
  assert.equal(store.costUsed, 12);
  assert.equal(store.peek('a'), undefined);
  assert.ok(store.peek('b'));
  store.clear(); assert.equal(store.size, 0); assert.equal(store.costUsed, 0);
});

test('last consumer cancels in-flight work; a late result cannot pollute replacement accounting', async () => {
  const store = new RasterStore(16), held = deferred();
  let engineSignal;
  const a = new AbortController(), b = new AbortController();
  const first = store.acquire('key', signal => { engineSignal = signal; return held.promise; }, a.signal);
  const second = store.acquire('key', () => { throw Error('duplicate fetch'); }, b.signal);
  const firstRejected = assert.rejects(first, { name: 'AbortError' });
  const secondRejected = assert.rejects(second, { name: 'AbortError' });
  a.abort(); assert.equal(engineSignal.aborted, false);
  b.abort(); await Promise.all([firstRejected, secondRejected]);
  assert.equal(engineSignal.aborted, true); assert.equal(store.size, 0);
  const replacement = await store.acquire('key', async () => raster(8));
  held.resolve(raster(12)); await Promise.resolve(); await Promise.resolve();
  assert.equal(store.peek('key'), replacement); assert.equal(store.costUsed, 8);
  const late = deferred(); let closedSignal;
  const pending = store.acquire('close', signal => { closedSignal = signal; return late.promise; });
  store.clear(); assert.equal(closedSignal.aborted, true);
  late.resolve(raster(12)); await pending;
  assert.equal(store.size, 0); assert.equal(store.costUsed, 0);
});

function setup(t, plugin = renderPlugin, transport = {}, tileSettings = {}) {
  const clock = manualClock();
  const calls = [];
  const definition = plugin({ fullPage: { maxWidth: 64 }, tiles: { size: 128, settleMs: 0, bleedPx: 2, prefetch: { margin: 0, velocityBias: false }, ...tileSettings } }, { rawPixels: true, ...transport });
  const render = kind => options => AbortablePromise.run(async () => {
    calls.push({ kind, options });
    const area = options.target?.rect ?? { width: 612, height: 792 };
    const scale = options.viewport.kind === 'width' ? options.viewport.width / area.width : options.viewport.scale ?? 1;
    const width = Math.ceil(area.width * scale), height = Math.ceil(area.height * scale);
    if (kind === 'raw') return { width, height, stride: width * 4, data: new ArrayBuffer(width * height * 4) };
    return { width, height, source: { kind: 'bytes', bytes: new Uint8Array(4) }, format: 'png', mimeType: 'image/png' };
  });
  const doc = { with() { return this; }, page: () => ({ render: { raw: render('raw'), image: render('image') } }) };
  const page = toPageRef(3);
  const ctx = createTestContext({ id: 'render', doc, pages: [{ ref: page }], state: definition.state(), settings: definition.settings, clock: clock.clock });
  const api = ctx.connect(definition.create(ctx));
  t.after(() => ctx.destroy());
  async function drain() { for (let i = 0; i < 160; i++) { await Promise.resolve(); clock.frame(); } }
  return { api, ctx, clock, calls, page, drain };
}
for (const [name, plugin] of [['ESM', renderPlugin], ['CJS', createRequire(import.meta.url)('@embedpdf/plugin-render').renderPlugin]]) {
  test(`${name}: raw base/tile singleflight, pan reuse, retention, invalidation and view release`, async t => {
    const f = setup(t, plugin), { api, page, calls, drain } = f;
    const [a, b] = await Promise.all([api.renderSource(page, { scale: 2 }), api.renderSource(page, { scale: 2 })]);
    assert.equal(a.data, b.data); assert.equal(calls.length, 1); assert.equal(calls[0].kind, 'raw');
    const view = api.createViewDemand('main');
    const demand = { desiredDeviceWidth: 1224, visibleRect: { x: 0, y: 0, width: 150, height: 150 } };
    view.setDemand(page, demand); await drain();
    const initial = view.getPlan(page).paint;
    assert.ok(initial.length > 1, JSON.stringify({ initial, calls, plan: view.getPlan(page) }));
    assert.ok(initial.every(tile => tile.handle.data instanceof ArrayBuffer));
    const oldBuffers = new Map(initial.map(tile => [tile.key, tile.handle.data]));
    initial.forEach(tile => view.markPainted(page, tile.key));
    await drain();
    const beforePan = calls.length;
    view.setDemand(page, { ...demand, visibleRect: { ...demand.visibleRect, x: 1 } }); await drain();
    assert.equal(calls.length, beforePan, 'small pan inside the same tile set must not render again');
    assert.ok(view.getPlan(page).paint.every(tile => oldBuffers.get(tile.key) === tile.handle.data));
    view.setDemand(page, { ...demand, desiredDeviceWidth: 2448 });
    assert.ok(view.getPlan(page).paint.some(tile => oldBuffers.has(tile.key)), 'old tiles remain until sharper replacements are painted');
    await drain();
    view.getPlan(page).paint.filter(tile => tile.scale === 4).forEach(tile => view.markPainted(page, tile.key));
    await drain();
    assert.ok(view.getPlan(page).paint.every(tile => tile.scale === 4), 'coarser generation is retired after replacement coverage');
    const beforeInvalidation = calls.length;
    api.invalidate({ pages: [page], scope: 'content' }); await drain();
    assert.ok(calls.length > beforeInvalidation);
    assert.ok(view.getPlan(page).paint.every(tile => !oldBuffers.has(tile.key)));
    const encoded = await api.renderPage(page, { width: 64 });
    assert.equal(encoded.mimeType, 'image/png', 'public export door remains encoded');
    const beforeClose = calls.length;
    view.destroy(); await drain();
    assert.equal(view.getPlan(page).paint.length, 0);
    const reopened = api.createViewDemand('main');
    assert.notEqual(reopened, view, 'closed views must not remain registered');
    reopened.setDemand(page, { ...demand, desiredDeviceWidth: 2448 }); await drain();
    assert.equal(calls.length, beforeClose, 'recreated views reuse the document raster cache');
    reopened.destroy();
    await f.ctx.destroy(); await drain();
    assert.equal(f.clock.pending.timers, 0);
  });
}

for (const [name, plugin] of [['ESM', renderPlugin], ['CJS', createRequire(import.meta.url)('@embedpdf/plugin-render').renderPlugin]]) {
  test(`${name}: camera bursts coalesce to latest demand within a bounded window`, async t => {
    const f = setup(t, plugin, { cacheBytes: 32 * 1024 * 1024, maxInFlight: 2, demandWindowMs: 80 });
    const view = f.api.createViewDemand('burst');
    for (let i = 0; i < 50; i++) view.setDemand(f.page, { desiredDeviceWidth: 1224 + i * 10, visibleRect: { x: 0, y: 0, width: 150, height: 150 } });
    await Promise.resolve(); assert.equal(f.calls.length, 0, 'no intermediate camera renders');
    f.clock.advance(79); await Promise.resolve(); assert.equal(f.calls.length, 0);
    f.clock.advance(1); await Promise.resolve();
    assert.equal(f.calls.length, 2, 'at most two tiles start before completions');
    await f.drain();
    assert.ok(f.calls.every(call => Math.abs(call.options.viewport.scale - 1714 / 612) < 1e-9), 'only final scale renders');
    const count = f.calls.length;
    view.setDemand(f.page, { desiredDeviceWidth: 2448, visibleRect: { x: 0, y: 0, width: 150, height: 150 } });
    view.destroy(); f.clock.advance(100); await f.drain();
    assert.equal(f.calls.length, count, 'destroy cancels deferred demand');
    assert.equal(f.clock.pending.timers, 0);
  });
}

test('live energy policy changes scheduling without rebuilding the render controller', async t => {
  let limit = 1, windowMs = 120;
  const f = setup(t, renderPlugin, { maxInFlight: () => limit, demandWindowMs: () => windowMs });
  const view = f.api.createViewDemand('energy');
  const demand = { desiredDeviceWidth: 1224, visibleRect: { x: 0, y: 0, width: 150, height: 150 } };
  view.setDemand(f.page, demand); f.clock.advance(119); await Promise.resolve(); assert.equal(f.calls.length, 0);
  f.clock.advance(1); await Promise.resolve(); assert.equal(f.calls.length, 1);
  await f.drain(); const before = f.calls.length;
  limit = 2; windowMs = 80;
  view.setDemand(f.page, { ...demand, desiredDeviceWidth: 2448 });
  f.clock.advance(79); await Promise.resolve(); assert.equal(f.calls.length, before);
  f.clock.advance(1); await Promise.resolve(); assert.equal(f.calls.length, before + 2);
  await f.drain(); view.destroy();
});

for (const [name, plugin] of [['ESM', renderPlugin], ['CJS', createRequire(import.meta.url)('@embedpdf/plugin-render').renderPlugin]]) {
  test(`${name}: pause retains painted tiles and resumes latest demand without another timer`, async t => {
    const f = setup(t, plugin, { maxInFlight: 1, demandWindowMs: 0 });
    const view = f.api.createViewDemand('motion');
    const demand = { desiredDeviceWidth: 1224, visibleRect: { x: 0, y: 0, width: 150, height: 150 } };
    view.setDemand(f.page, demand); await f.drain();
    const old = view.getPlan(f.page).paint;
    old.forEach(tile => view.markPainted(f.page, tile.key));
    const count = f.calls.length;
    view.setPaused(f.page, true);
    for (const width of [1800, 2000, 2448]) view.setDemand(f.page, { ...demand, desiredDeviceWidth: width });
    await f.drain(); assert.equal(f.calls.length, count, 'paused plans must not start queued work');
    const retained = view.getPlan(f.page).paint;
    assert.ok(retained.length > 0);
    assert.ok(retained.every(tile => old.some(previous => previous.key === tile.key && previous.handle === tile.handle)));
    view.setPaused(f.page, false); view.setDemand(f.page, { ...demand, desiredDeviceWidth: 2448 });
    await Promise.resolve(); assert.equal(f.calls.length, count + 1, 'resume starts immediately with no timer advance');
    await f.drain();
    assert.ok(f.calls.slice(count).every(call => call.options.viewport.scale === 4));
    view.destroy(); assert.equal(f.clock.pending.timers, 0);
  });
}

test('normal fixed window starts latest demand during continuous camera updates', async t => {
  const f = setup(t, renderPlugin, { maxInFlight: 2, demandWindowMs: 60 });
  const view = f.api.createViewDemand('continuous');
  const demand = { desiredDeviceWidth: 1224, visibleRect: { x: 0, y: 0, width: 150, height: 150 } };
  view.setDemand(f.page, demand);
  f.clock.advance(20); view.setDemand(f.page, { ...demand, desiredDeviceWidth: 1800 });
  f.clock.advance(20); view.setDemand(f.page, { ...demand, desiredDeviceWidth: 2448 });
  f.clock.advance(19); await Promise.resolve(); assert.equal(f.calls.length, 0);
  f.clock.advance(1); await Promise.resolve();
  assert.equal(f.calls.length, 2, 'later events must not postpone the original 60 ms deadline');
  assert.ok(f.calls.every(call => call.options.viewport.scale === 4), 'only latest demand starts');
  await f.drain(); view.destroy();
});

for (const [name, plugin] of [['ESM', renderPlugin], ['CJS', createRequire(import.meta.url)('@embedpdf/plugin-render').renderPlugin]]) {
  test(`${name}: active tiles survive cache pressure without rerendering at rest`, async t => {
    // Even a single tile exceeds this reuse budget. Active coverage must still converge.
    const f = setup(t, plugin, { cacheBytes: 16, maxInFlight: 2 });
    const view = f.api.createViewDemand('pressure');
    const demand = { desiredDeviceWidth: 1224, visibleRect: { x: 0, y: 0, width: 150, height: 150 } };
    view.setDemand(f.page, demand); await f.drain();
    const initial = view.getPlan(f.page).paint;
    assert.equal(initial.length, 9, 'all visible tiles survive eviction from the reuse cache');
    initial.forEach(tile => view.markPainted(f.page, tile.key));
    const count = f.calls.length;
    for (let i = 0; i < 5; i++) {
      view.setDemand(f.page, demand); await f.drain();
      assert.deepEqual(view.getPlan(f.page).paint.map(tile => tile.key), initial.map(tile => tile.key));
    view.getPlan(f.page).paint.forEach((tile, i) => assert.equal(tile.handle, initial[i].handle, 'reuse the same raster object, not a pixel copy'));
    }
    assert.equal(f.calls.length, count, 'stationary demand must not cycle evicted tiles');
    view.setDemand(f.page, { ...demand, desiredDeviceWidth: 2448 }); await f.drain();
    assert.ok(view.getPlan(f.page).paint.some(tile => tile.key === initial[0].key), 'retain previous coverage during zoom');
    view.getPlan(f.page).paint.filter(tile => tile.scale === 4).forEach(tile => view.markPainted(f.page, tile.key));
    await f.drain();
    assert.equal(view.getPlan(f.page).paint.length, 25);
    assert.ok(view.getPlan(f.page).paint.every(tile => tile.scale === 4));
    view.destroy();
  });
}

for (const [name, plugin] of [['ESM', renderPlugin], ['CJS', createRequire(import.meta.url)('@embedpdf/plugin-render').renderPlugin]]) {
  test(`${name}: scale ladder reuses within a rung and on return, retaining coverage across rungs`, async t => {
    const f = setup(t, plugin, { cacheBytes: 32 * 1024 * 1024, demandWindowMs: 60 }, { quantize: PDF_TILE_SCALES });
    const view = f.api.createViewDemand('ladder');
    const demand = { desiredDeviceWidth: 1224, visibleRect: { x: 0, y: 0, width: 150, height: 150 } };
    async function zoom(scale) {
      view.setDemand(f.page, { ...demand, desiredDeviceWidth: 612 * scale });
      f.clock.advance(60); await f.drain();
    }
    await zoom(1.5);
    const initial = view.getPlan(f.page).paint;
    assert.ok(initial.length > 0 && initial.every(tile => tile.scale === 2));
    initial.forEach(tile => view.markPainted(f.page, tile.key));
    const count = f.calls.length;
    for (const scale of [1.6, 1.8, 2, 1.5]) await zoom(scale);
    assert.equal(f.calls.length, count, 'same rung must reuse the existing pixels');
    assert.deepEqual(view.getPlan(f.page).paint.map(tile => tile.key), initial.map(tile => tile.key));
    view.getPlan(f.page).paint.forEach((tile, i) => assert.equal(tile.handle, initial[i].handle, 'reuse the same raster object, not a pixel copy'));
    await zoom(2.1);
    const next = view.getPlan(f.page).paint;
    assert.ok(next.some(tile => tile.scale === 2), 'old coverage stays until replacement paints');
    const higher = next.filter(tile => tile.scale > 2);
    assert.ok(higher.length > 0);
    assert.ok(higher.every(tile => tile.scale === 2 ** 1.5));
    higher.forEach(tile => view.markPainted(f.page, tile.key));
    await f.drain();
    assert.ok(view.getPlan(f.page).paint.every(tile => tile.scale > 2));
    const afterCrossing = f.calls.length;
    await zoom(1.8);
    assert.equal(f.calls.length, afterCrossing, 'returning to the previous rung hits cache');
    view.getPlan(f.page).paint.filter(tile => tile.scale === 2).forEach(tile => view.markPainted(f.page, tile.key));
    await f.drain();
    assert.deepEqual(view.getPlan(f.page).paint.map(tile => tile.key), initial.map(tile => tile.key));
    view.getPlan(f.page).paint.forEach((tile, i) => assert.equal(tile.handle, initial[i].handle, 'reuse the same raster object, not a pixel copy'));
    view.destroy();
  });
}
