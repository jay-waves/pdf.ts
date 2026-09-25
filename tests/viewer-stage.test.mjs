import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { ScrollStrategy } from '@embedpdf/plugin-scroll';
import { SpreadMode } from '@embedpdf/plugin-spread';
import { ZoomMode } from '@embedpdf/plugin-zoom';

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const sourceModules = new Set(['../shared/utils', '../renderer/stage-scroll-adapter']);
    return nextResolve(sourceModules.has(specifier) ? `${specifier}.ts` : specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('/viewer/viewer-stage.ts') || url.endsWith('/renderer/stage-scroll-adapter.ts')) {
      return { format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
const { ViewerStage } = await import('../apps/viewer/viewer-stage.ts');
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
  const stage = new ViewerStage(
    { getPlugin: (name) => ({ provides: () => capabilities[name] }) },
    'doc',
    scroll,
  );
  t.after(stage.install());
  return { stage, jumps, zooms, emit, anchors: () => anchors };
}

test('layout changes publish only a valid combination and preserve one anchor', (t) => {
  const { stage, zooms, anchors } = setup(t);
  stage.toggleSpread();
  assert.equal(zooms.at(-1), ZoomMode.FitWidth);
  const snapshots = [];
  const unsubscribe = stage.subscribe(() => snapshots.push(stage.getSnapshot()));
  stage.setStrategy(ScrollStrategy.Horizontal);
  unsubscribe();
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].spread, SpreadMode.None);
  assert.equal(snapshots[0].strategy, ScrollStrategy.Horizontal);
  assert.equal(zooms.at(-1), 0.8);
  assert.equal(anchors(), 2);
  stage.toggleSpread();
  assert.equal(stage.getSnapshot().strategy, ScrollStrategy.Vertical);
  assert.equal(stage.getSnapshot().spread, SpreadMode.Odd);
});

test('restored horizontal + double page is normalized through the same entry point', (t) => {
  const { stage, zooms } = setup(t);
  stage.applyLayout(ScrollStrategy.Horizontal, SpreadMode.Even);
  assert.equal(stage.getSnapshot().spread, SpreadMode.None);
  assert.equal(zooms.at(-1), 0.8);
});

test('presentation accumulates rapid navigation without scrolling the inactive viewport', (t) => {
  const { stage, jumps, emit } = setup(t);
  stage.setPresentation(true);
  stage.movePages(1);
  stage.movePages(1);
  emit(); // An inactive viewport notification must not overwrite the slide.
  assert.equal(stage.getSnapshot().pageNumber, 4);
  assert.deepEqual(jumps, []);
  stage.toggleSpread();
  assert.equal(stage.getSnapshot().spread, SpreadMode.None);
  stage.goToPage(100);
  stage.movePages(1);
  assert.equal(stage.getSnapshot().pageNumber, 11);
  stage.setPresentation(false);
  assert.deepEqual(jumps, [10]);
  assert.equal(stage.getSnapshot().mode, 'reading');
});
