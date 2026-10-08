import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformRect, transformPosition, transformSize } from '@embedpdf/models';
import { ZoomMode } from '@embedpdf/plugin-zoom';
import { readingRegionRect } from '../apps/shared/reading-region.ts';
import { ScrollStrategy } from '@embedpdf/plugin-scroll';

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(['../shared/utils', '../shared/reading-region', './smooth-scroll', './viewport-geometry'].includes(specifier) ? `${specifier}.ts` : specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('/renderer/viewport-geometry.ts')
      || url.endsWith('/renderer/stage-scroll-adapter.ts')
      || url.endsWith('/renderer/smooth-scroll.ts')) {
      return { format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
const { StageScrollAdapter } = await import('../apps/renderer/stage-scroll-adapter.ts');
hooks.deregister();

function setup(t, strategy = ScrollStrategy.Vertical) {
  const horizontal = strategy === ScrollStrategy.Horizontal;
  const frames = new Map();
  let nextFrame = 0;
  t.mock.method(globalThis, 'requestAnimationFrame', (callback) => { frames.set(++nextFrame, callback); return nextFrame; });
  t.mock.method(globalThis, 'cancelAnimationFrame', (id) => frames.delete(id));
  const metrics = { scrollLeft: 0, scrollTop: 0, clientWidth: 800, clientHeight: 600, scrollHeight: 10000, scrollWidth: 10000 };
  const jumps = [];
  const scrolls = [];
  const viewport = {
    getMetrics: () => metrics,
    scrollTo(position) { scrolls.push(position); metrics.scrollLeft = position.x; metrics.scrollTop = position.y; },
  };
  const scope = {
    getTotalPages: () => 10,
    getMetrics: () => ({ currentPage: 1 }),
    getPageChangeState: () => ({ isChanging: false }),
    getRectPositionForPage: (page, rect) => ({ ...rect, origin: { x: rect.origin.x + (horizontal ? page * 1000 : 0), y: rect.origin.y + (horizontal ? 0 : page * 1000) } }),
    getSpreadPagesWithRotatedSize: () => [[{ index: 9, size: { width: 800, height: 1000 } }]],
    scrollToPage(options) {
      jumps.push(options);
      if (horizontal) metrics.scrollLeft = (options.pageNumber - 1) * 1000 + (options.pageCoordinates?.x ?? 0) - 800 * (options.alignX ?? 0) / 100;
      else metrics.scrollTop = (options.pageNumber - 1) * 1000 + (options.pageCoordinates?.y ?? 0) - 600 * (options.alignY ?? 0) / 100;
    },
  };
  const capabilities = {
    scroll: { forDocument: () => scope, getPageGap: () => 0 },
    viewport: { forDocument: () => viewport, getViewportGap: () => 0 },
  };
  const scroll = new StageScrollAdapter({
    getPlugin: (id) => ({ provides: () => capabilities[id] }),
    getStore: () => ({ getState: () => ({ plugins: { scroll: { documents: { doc: { strategy } } } } }) }),
  }, 'doc');
  let time = performance.now();
  const frame = () => {
    time += 16;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(time));
  };
  return { scroll, jumps, scrolls, frame, frames, metrics, scope, capabilities };
}

// Node has no browser frame scheduler; each test replaces these placeholders.
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
const rects = [{ origin: { x: 10, y: 100 }, size: { width: 20, height: 20 } }];

test('small scrolling extends its destination, reverses immediately and respects bounds', (t) => {
  const { scroll, frame, frames, metrics } = setup(t);
  const finish = () => { for (let i = 0; i < 100 && frames.size; i++) frame(); };
  scroll.scrollVertically(40);
  frame();
  assert.ok(metrics.scrollTop > 0 && metrics.scrollTop < 40);
  scroll.scrollVertically(40);
  assert.equal(frames.size, 1);
  finish();
  assert.equal(metrics.scrollTop, 80);
  scroll.scrollVertically(80);
  frame();
  const turn = metrics.scrollTop;
  scroll.scrollVertically(-40);
  frame();
  assert.ok(metrics.scrollTop < turn);
  finish();
  assert.equal(metrics.scrollTop, Math.max(0, turn - 40));
  scroll.scrollVertically(-1000);
  finish();
  assert.equal(metrics.scrollTop, 0);
  metrics.scrollHeight = 700;
  scroll.scrollVertically(1000);
  finish();
  assert.equal(metrics.scrollTop, 100);
});

test('direct input cancels small scrolling without retaining its destination', (t) => {
  const { scroll, frame, frames, metrics } = setup(t);
  scroll.scrollVertically(40);
  frame();
  scroll.cancelPendingNavigation();
  const stopped = metrics.scrollTop;
  frame();
  assert.equal(metrics.scrollTop, stopped);
  assert.equal(frames.size, 0);
  metrics.scrollTop = 200;
  scroll.scrollVertically(40);
  for (let i = 0; i < 100 && frames.size; i++) frame();
  assert.equal(metrics.scrollTop, 240);
});

test('reading anchors round-trip PDF points across scale, rotation, gap and document replacement', () => {
  for (const pageRotation of [0, 1, 2, 3]) {
    for (const documentRotation of [0, 1]) {
      let scale = 2;
      let rotation = documentRotation;
      let gap = 10;
      let totalPages = 10;
      const page = { index: 5, size: { width: 600, height: 800 }, rotation: pageRotation };
      const point = { x: 125, y: 300 };
      const origin = { x: 50, y: 4000 };
      const metrics = { scrollLeft: 0, scrollTop: 0 };
      const jumps = [];
      const place = (coordinates) => {
        const transformed = transformPosition(page.size, coordinates, (pageRotation + rotation) % 4, scale);
        metrics.scrollLeft = origin.x + gap + transformed.x;
        metrics.scrollTop = origin.y + gap + transformed.y;
      };
      place(point);
      const scope = {
        getTotalPages: () => totalPages,
        getMetrics: () => ({ currentPage: 6 }),
        getSpreadPagesWithRotatedSize: () => [[{ ...page, rotatedSize: transformSize(page.size, (pageRotation + rotation) % 4, 1) }]],
        getRectPositionForPage: (_, rect) => {
          const transformed = transformRect(page.size, rect, (pageRotation + rotation) % 4, scale);
          return { origin: { x: origin.x + transformed.origin.x, y: origin.y + transformed.origin.y }, size: transformed.size };
        },
        scrollToPage(options) { jumps.push(options); place(options.pageCoordinates); },
      };
      const capabilities = {
        scroll: { forDocument: () => scope, getPageGap: () => 0 },
        rotate: { forDocument: () => ({ getRotation: () => rotation }) },
        viewport: { getViewportGap: () => gap, forDocument: () => ({ getMetrics: () => metrics }) },
      };
      const adapter = new StageScrollAdapter({ getPlugin: (id) => ({ provides: () => capabilities[id] }) }, 'doc');
      const anchor = adapter.getAnchor();
      assert.deepEqual(anchor, { pageNumber: 6, pageCoordinates: point });
      rotation = (rotation + 1) % 4;
      scale = 0.5;
      gap = 24;
      adapter.restoreAnchor(anchor);
      assert.deepEqual(adapter.getAnchor(), anchor);
      totalPages = 3;
      adapter.restoreAnchor(anchor);
      assert.equal(jumps.at(-1).pageNumber, 3);
    }
  }
});

test('distant target reveal jumps first and then smoothly settles within the destination', (t) => {
  const { scroll, jumps, scrolls, frame } = setup(t);
  assert.equal(scroll.reveal(9, rects), true);
  assert.equal(jumps[0].behavior, 'instant');
  assert.equal(jumps[0].alignY, 82);
  frame();
  assert.equal(scrolls.length, 0);
  frame();
  assert.deepEqual(scrolls, [{ x: 0, y: 8900, behavior: 'smooth' }]);
});

test('new navigation or direct input cancels the previous delayed settle', (t) => {
  for (const interrupt of [(scroll) => scroll.restoreAnchor({ pageNumber: 3 }), (scroll) => scroll.cancelPendingNavigation()]) {
    const { scroll, scrolls, frame, frames } = setup(t);
    scroll.reveal(9, rects);
    frame();
    interrupt(scroll);
    assert.equal(frames.size, 0);
    frame();
    assert.equal(scrolls.length, 0);
  }
});

test('a bookmark point at the page origin also receives the distant landing animation', (t) => {
  const { scroll, jumps, scrolls, frame } = setup(t);
  assert.equal(scroll.reveal(9, [{ origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } }]), true);
  assert.deepEqual(jumps[0].pageCoordinates, { x: 0, y: 0 });
  frame();
  frame();
  assert.deepEqual(scrolls, [{ x: 0, y: 8790, behavior: 'smooth' }]);
});

test('unavailable page geometry uses the shared jump and settle path', (t) => {
  const { scroll, scope, jumps, frame, frames } = setup(t);
  scope.getRectPositionForPage = () => null;
  assert.equal(scroll.reveal(9, rects), true);
  assert.equal(jumps.length, 1);
  assert.equal(jumps[0].behavior, 'instant');
  assert.equal(jumps[0].alignY, 43);
  frame();
  frame();
  assert.equal(frames.size, 0);
});

test('page navigation falls back once when source geometry is unavailable', (t) => {
  const { scroll, jumps, frames } = setup(t);
  scroll.scrollVertically(40);
  assert.equal(scroll.goToPage(3), true);
  assert.equal(frames.size, 0);
  assert.deepEqual(jumps, [{ pageNumber: 3, pageCoordinates: undefined, behavior: 'instant' }]);
});

test('horizontal reveal preserves the other axis for nearby and distant targets', (t) => {
  const { scroll, metrics, scrolls, jumps, frame } = setup(t, ScrollStrategy.Horizontal);
  metrics.scrollTop = 50;
  metrics.scrollLeft = 9000;
  assert.equal(scroll.reveal(9, [{ origin: { x: 100, y: 0 }, size: { width: 20, height: 20 } }]), false);
  assert.equal(scroll.reveal(9, [{ origin: { x: 790, y: 0 }, size: { width: 20, height: 20 } }]), true);
  assert.deepEqual(scrolls.at(-1), { x: 9086, y: 50, behavior: 'smooth' });
  metrics.scrollLeft = 0;
  scroll.reveal(9, rects);
  assert.equal(jumps.at(-1).alignX, 82);
  frame();
  frame();
  assert.deepEqual(scrolls.at(-1), { x: 8620, y: 50, behavior: 'smooth' });
});

test('small scrolling reads four DOM fields once per frame and ignores stale stored metrics', (t) => {
  const { scroll, frame } = setup(t);
  const reads = {};
  const values = { scrollLeft: 123, scrollTop: 100, scrollHeight: 1000, clientHeight: 600 };
  const element = {
    scrollTo({ left, top }) { values.scrollLeft = left; values.scrollTop = top; },
  };
  for (const key of Object.keys(values)) {
    Object.defineProperty(element, key, { get() { reads[key] = (reads[key] ?? 0) + 1; return values[key]; } });
  }
  scroll.attachViewport(element);
  scroll.scrollVertically(40);
  for (const key of Object.keys(reads)) reads[key] = 0;
  frame();
  assert.deepEqual(reads, { scrollLeft: 1, scrollTop: 1, scrollHeight: 1, clientHeight: 1 });
  assert.equal(values.scrollLeft, 123);
  assert.ok(values.scrollTop > 100 && values.scrollTop < 140);
  scroll.attachViewport(null);
});

test('page navigation preserves visual offset across differently rotated pages', (t) => {
  const { scroll, scope, metrics, jumps } = setup(t);
  const scale = 1.5;
  for (const rotation of [0, 1, 2, 3]) {
    const source = { index: 0, size: { width: 600, height: 800 }, rotation };
    const target = { index: 1, size: { width: 500, height: 900 }, rotation: (rotation + 1) % 4 };
    const origin = { x: 200, y: 1000 };
    scope.getSpreadPagesWithRotatedSize = () => [source, target].map((page) => [
      { ...page, rotatedSize: transformSize(page.size, page.rotation, 1) },
    ]);
    scope.getRectPositionForPage = (_, rect) => {
      const transformed = transformRect(source.size, rect, source.rotation, scale);
      return { origin: { x: origin.x + transformed.origin.x, y: origin.y + transformed.origin.y }, size: transformed.size };
    };
    metrics.scrollLeft = origin.x + 30;
    metrics.scrollTop = origin.y + 150;
    scroll.goToPage(2);
    const offset = transformPosition(target.size, jumps.at(-1).pageCoordinates, target.rotation, scale);
    assert.deepEqual(offset, { x: 30, y: 150 });
  }
});

test('fit scales follow live viewport and layout changes without stale geometry', (t) => {
  const { scroll, scope } = setup(t);
  let size = { width: 400, height: 800 };
  scope.getSpreadPagesWithRotatedSize = () => [[{ index: 0, rotatedSize: size }]];
  const element = { clientWidth: 800, clientHeight: 600 };
  scroll.attachViewport(element);
  assert.deepEqual(scroll.getFitScales(), { width: 2, height: 0.75, page: 0.75 });
  element.clientHeight = 400;
  size = { width: 800, height: 400 };
  assert.deepEqual(scroll.getFitScales(), { width: 1, height: 1, page: 1 });
  scroll.attachViewport(null);
});

test('reading-area fit handles every rotation, aligns both axes and cancels stale alignment', (t) => {
  const { scroll, scope, metrics, scrolls, capabilities, frame, frames } = setup(t);
  const region = { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 };
  const page = { index: 0, size: { width: 600, height: 800 }, rotation: 0 };
  let rotation = 0;
  let scale = 1;
  const gap = 10;
  capabilities.viewport.getViewportGap = () => gap;
  capabilities.zoom = { forDocument: () => ({ requestZoom(value) { scale = value; } }) };
  scope.getSpreadPagesWithRotatedSize = () => [[{ ...page, rotatedSize: transformSize(page.size, rotation, 1) }]];
  scope.getRectPositionForPage = (_, rect, requestedScale = scale) => {
    const transformed = transformRect(page.size, rect, rotation, requestedScale);
    return { origin: { x: 100 * requestedScale + transformed.origin.x, y: 200 * requestedScale + transformed.origin.y }, size: transformed.size };
  };
  for (rotation = 0; rotation < 4; rotation++) {
    for (const mode of [ZoomMode.FitPage, ZoomMode.FitWidth]) {
      const size = transformSize(readingRegionRect(region, page.size).size, rotation, 1);
      const expectedScale = mode === ZoomMode.FitWidth ? 780 / size.width : Math.min(780 / size.width, 580 / size.height);
      assert.equal(scroll.fitReadingRegion(region, 1, mode), true);
      frame();
      frame();
      assert.ok(Math.abs(scale - expectedScale) < 1e-8);
      const positioned = scope.getRectPositionForPage(0, readingRegionRect(region, page.size));
      const expectedX = Math.max(0, positioned.origin.x + gap + positioned.size.width / 2 - metrics.clientWidth / 2);
      const expectedY = mode === ZoomMode.FitWidth ? positioned.origin.y
        : Math.max(0, positioned.origin.y + gap + positioned.size.height / 2 - metrics.clientHeight / 2);
      assert.ok(Math.abs(scrolls.at(-1).x - expectedX) < 1e-8);
      assert.ok(Math.abs(scrolls.at(-1).y - expectedY) < 1e-8);
    }
  }
  rotation = 0;
  scroll.fitReadingRegion(region, 1, ZoomMode.FitPage);
  scroll.cancelPendingNavigation();
  assert.equal(frames.size, 0);
});

test('double-page reading areas fit their actual combined bounds including inner margins', (t) => {
  const { scroll, scope, capabilities } = setup(t);
  const region = { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 };
  const pages = [0, 1].map((index) => ({ index, size: { width: 600, height: 800 }, rotatedSize: { width: 600, height: 800 } }));
  scope.getSpreadPagesWithRotatedSize = () => [pages];
  scope.getRectPositionForPage = (index, rect, scale = 1) => ({
    origin: { x: (index * 610 + rect.origin.x) * scale, y: rect.origin.y * scale },
    size: { width: rect.size.width * scale, height: rect.size.height * scale },
  });
  capabilities.viewport.getViewportGap = () => 10;
  const fit = scroll.getFitScales(region, 1);
  assert.ok(Math.abs(fit.width - 780 / 1090) < 1e-9);
  assert.ok(Math.abs(fit.height - 580 / 640) < 1e-9);
});

test('zoom and rotation retain a page point through centering and delayed SDK scroll writes', (t) => {
  const { scroll, scope, capabilities, metrics, frame } = setup(t);
  const page = { index: 5, rotation: 0, size: { width: 600, height: 800 } };
  let scale = 1;
  let rotation = 0;
  const gap = 10;
  const focus = { vx: 400, vy: 300 };
  const point = { x: 300, y: 400 };
  const size = () => transformSize(page.size, rotation, 1);
  capabilities.viewport.getViewportGap = () => gap;
  capabilities.rotate = { forDocument: () => ({ getRotation: () => rotation }) };
  capabilities.zoom = { forDocument: () => ({ getState: () => ({ currentZoomLevel: scale }) }) };
  scope.getMetrics = () => ({ currentPage: 6 });
  scope.getLayout = () => ({ totalContentSize: { width: size().width, height: 10 * (size().height + 10) } });
  scope.getSpreadPagesWithRotatedSize = () => [[{ ...page, rotatedSize: size() }]];
  scope.getRectPositionForPage = (_, rect) => {
    const transformed = transformRect(page.size, rect, rotation, scale);
    return { ...transformed, origin: { x: transformed.origin.x,
      y: 5 * (size().height + 10) * scale + transformed.origin.y } };
  };
  const expected = () => {
    const transformed = transformPosition(page.size, point, rotation, scale);
    return { x: Math.max(0, (800 - 2 * gap - size().width * scale) / 2) + gap + transformed.x - focus.vx,
      y: 5 * (size().height + 10) * scale + gap + transformed.y - focus.vy };
  };
  metrics.scrollLeft = expected().x;
  metrics.scrollTop = expected().y;
  for (const next of [{ scale: 2, rotation: 0 }, { scale: 1, rotation: 1 }, { scale: 1, rotation: 2 },
    { scale: 1, rotation: 3 }, { scale: 1, rotation: 0 }]) {
    scroll.preserveView(() => { scale = next.scale; rotation = next.rotation; }, focus);
    assert.equal(metrics.scrollLeft, Math.max(0, expected().x));
    assert.equal(metrics.scrollTop, expected().y);
    // A queued SDK write must not win over the saved PDF anchor.
    metrics.scrollTop = 123;
    frame();
    frame();
    assert.equal(metrics.scrollTop, expected().y);
    assert.deepEqual(scroll.getAnchor(focus).pageCoordinates, point);
  }
});
