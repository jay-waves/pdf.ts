import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { ScrollStrategy } from '@embedpdf/plugin-scroll';

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === '../shared/utils' ? `${specifier}.ts` : specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('/renderer/pdf-scroll.ts')) {
      return { format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
const { PdfScroll } = await import('../apps/renderer/pdf-scroll.ts');
hooks.deregister();

function setup(t) {
  const frames = new Map();
  let nextFrame = 0;
  t.mock.method(globalThis, 'requestAnimationFrame', (callback) => { frames.set(++nextFrame, callback); return nextFrame; });
  t.mock.method(globalThis, 'cancelAnimationFrame', (id) => frames.delete(id));
  const metrics = { scrollLeft: 0, scrollTop: 0, clientWidth: 800, clientHeight: 600 };
  const jumps = [];
  const scrolls = [];
  const viewport = {
    getMetrics: () => metrics,
    scrollTo(position) { scrolls.push(position); metrics.scrollLeft = position.x; metrics.scrollTop = position.y; },
  };
  const scope = {
    getRectPositionForPage: (page, rect) => ({ ...rect, origin: { x: rect.origin.x, y: page * 1000 + rect.origin.y } }),
    getSpreadPagesWithRotatedSize: () => [[{ index: 9, size: { width: 800, height: 1000 } }]],
    scrollToPage(options) {
      jumps.push(options);
      metrics.scrollTop = (options.pageNumber - 1) * 1000 + (options.pageCoordinates?.y ?? 0) - 600 * (options.alignY ?? 0) / 100;
    },
  };
  const capabilities = {
    scroll: { forDocument: () => scope },
    viewport: { forDocument: () => viewport, getViewportGap: () => 0 },
  };
  const scroll = new PdfScroll({
    getPlugin: (id) => ({ provides: () => capabilities[id] }),
    getStore: () => ({ getState: () => ({ plugins: { scroll: { documents: { doc: { strategy: ScrollStrategy.Vertical } } } } }) }),
  }, 'doc');
  const frame = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback());
  };
  return { scroll, jumps, scrolls, frame, frames };
}

// Node has no browser frame scheduler; each test replaces these placeholders.
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
const rects = [{ origin: { x: 10, y: 100 }, size: { width: 20, height: 20 } }];

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
  for (const interrupt of [(scroll) => scroll.goToPosition(2), (scroll) => scroll.cancelPendingNavigation()]) {
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
