import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { ScrollStrategy } from '@embedpdf/plugin-scroll';
import { SpreadMode } from '@embedpdf/plugin-spread';
import { ZoomMode } from '@embedpdf/plugin-zoom';

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === '../shared/utils' ? `${specifier}.ts` : specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('/viewer/page-controller.ts')) {
      return { format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
const { PageController } = await import('../apps/viewer/page-controller.ts');
hooks.deregister();

function setup(t) {
  let strategy = ScrollStrategy.Vertical;
  let spread = SpreadMode.None;
  let page = 2;
  const listeners = new Set();
  const emit = () => listeners.forEach((listener) => listener());
  const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  const jumps = [];
  const zooms = [];
  let anchors = 0;
  const scroll = {
    documentId: 'doc', getTotalPages: () => 10, getCurrentPage: () => page,
    getStrategy: () => strategy, onPageChange: subscribe, onLayoutReady: subscribe,
    onStrategyChange: subscribe, cancelPendingNavigation() {},
    goToPage(target) { jumps.push(target); page = target; emit(); },
    preserveView(update) { anchors++; update(); },
  };
  const capabilities = {
    scroll: {
      setScrollStrategy(value) { strategy = value; emit(); },
      forDocument: () => ({ getSpreadPagesWithRotatedSize: () => [[{ rotatedSize: { height: 1000 } }]] }),
    },
    spread: { forDocument: () => ({
      getSpreadMode: () => spread, setSpreadMode(value) { spread = value; emit(); }, onSpreadChange: subscribe,
    }) },
    viewport: { getViewportGap: () => 10, forDocument: () => ({ getMetrics: () => ({ clientHeight: 820 }) }) },
    zoom: { forDocument: () => ({ requestZoom(value) { zooms.push(value); } }) },
  };
  const controller = new PageController({ getPlugin: (name) => ({ provides: () => capabilities[name] }) }, scroll);
  t.after(controller.install());
  return { controller, jumps, zooms, emit, anchors: () => anchors };
}

test('layout changes publish only a valid combination and preserve one anchor', (t) => {
  const { controller, zooms, anchors } = setup(t);
  controller.toggleSpread();
  assert.equal(zooms.at(-1), ZoomMode.FitWidth);
  const snapshots = [];
  const unsubscribe = controller.subscribe(() => snapshots.push(controller.getSnapshot()));
  controller.setStrategy(ScrollStrategy.Horizontal);
  unsubscribe();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].spread, SpreadMode.None);
  assert.equal(snapshots[0].strategy, ScrollStrategy.Horizontal);
  assert.equal(zooms.at(-1), 0.8);
  assert.equal(anchors(), 2);
  controller.toggleSpread();
  assert.equal(controller.getSnapshot().strategy, ScrollStrategy.Vertical);
  assert.equal(controller.getSnapshot().spread, SpreadMode.Odd);
});

test('restored horizontal + double page is normalized through the same entry point', (t) => {
  const { controller, zooms } = setup(t);
  controller.applyLayout(ScrollStrategy.Horizontal, SpreadMode.Even);
  assert.equal(controller.getSnapshot().spread, SpreadMode.None);
  assert.equal(zooms.at(-1), 0.8);
});

test('presentation accumulates rapid navigation without scrolling the inactive viewport', (t) => {
  const { controller, jumps, emit } = setup(t);
  controller.setPresentation(true);
  controller.movePages(1);
  controller.movePages(1);
  emit(); // An inactive viewport notification must not overwrite the slide.
  assert.equal(controller.getSnapshot().pageNumber, 4);
  assert.deepEqual(jumps, []);
  controller.toggleSpread();
  assert.equal(controller.getSnapshot().spread, SpreadMode.None);
  controller.goToPage(100);
  controller.movePages(1);
  assert.equal(controller.getSnapshot().pageNumber, 11);
  controller.setPresentation(false);
  assert.deepEqual(jumps, [10]);
  assert.equal(controller.getSnapshot().mode, 'reading');
});
