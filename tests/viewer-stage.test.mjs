import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { ScrollStrategy } from '@embedpdf/plugin-scroll';
import { SpreadMode } from '@embedpdf/plugin-spread';
import { ZoomMode } from '@embedpdf/plugin-zoom';

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const sourceModules = new Set(['../shared/utils', '../shared/reading-region', '../renderer/stage-scroll-adapter', './smooth-scroll', './viewport-geometry']);
    return nextResolve(sourceModules.has(specifier) ? `${specifier}.ts` : specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('/renderer/viewport-geometry.ts')
      || url.endsWith('/viewer/viewer-stage.ts')
      || url.endsWith('/renderer/stage-scroll-adapter.ts')
      || url.endsWith('/renderer/smooth-scroll.ts')) {
      return { format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
const { ViewerStage } = await import('../apps/viewer/viewer-stage.ts');
hooks.deregister();

test('control actions return focus after closing overlays and preserve active editors', (t) => {
  const frames = [];
  let overlay = false;
  let editing = false;
  let focused = 0;
  for (const [name, value] of Object.entries({
    requestAnimationFrame: (callback) => frames.push(callback),
    document: {
      querySelector: () => overlay ? {} : null,
      activeElement: { matches: () => editing },
    },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  const stage = new ViewerStage({}, 'doc', { focusViewport: () => focused++ });
  stage.focusViewportAfterAction();
  assert.equal(focused, 0);
  frames.shift()();
  assert.equal(focused, 1);

  // Guards must run after React has mounted the UI opened by the action.
  stage.focusViewportAfterAction();
  overlay = true;
  frames.shift()();
  assert.equal(focused, 1);
  overlay = false;
  stage.focusViewportAfterAction();
  editing = true;
  frames.shift()();
  assert.equal(focused, 1);

  editing = false;
  stage.focusViewportAfterAction();
  frames.shift()();
  assert.equal(focused, 2);
});

function setup(t) {
  let strategy = ScrollStrategy.Vertical;
  let spread = SpreadMode.None;
  let page = 2;
  const listeners = new Set();
  const emit = () => listeners.forEach((listener) => listener());
  const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  const jumps = [];
  const jumpBehaviors = [];
  const zooms = [];
  const regionFits = [];
  const zoomListeners = new Set();
  const subscribeZoom = (listener) => { zoomListeners.add(listener); return () => zoomListeners.delete(listener); };
  const resizeListeners = new Set();
  const modeListeners = new Set();
  let mode = 'pointerMode';
  const interaction = {
    getActiveMode: () => mode,
    activate(value) { mode = value; modeListeners.forEach((listener) => listener(value)); },
    activateDefaultMode() { this.activate('pointerMode'); },
    onModeChange(listener) { modeListeners.add(listener); return () => modeListeners.delete(listener); },
  };
  const zoomScope = {
    requestZoom(value) { zooms.push(value); zoomListeners.forEach((listener) => listener()); },
    getState: () => ({ zoomLevel: zooms.at(-1) ?? ZoomMode.FitPage }),
    onZoomChange: subscribeZoom,
  };
  let anchors = 0;
  const scroll = {
    documentId: 'doc', getTotalPages: () => 10, getCurrentPage: () => page,
    getStrategy: () => strategy, onPageChange: subscribe, onLayoutReady: subscribe,
    onStrategyChange: subscribe, cancelPendingNavigation() {},
    goToPage(target, behavior) { jumps.push(target); jumpBehaviors.push(behavior); page = target; emit(); },
    getFitScales: () => ({ height: 0.8 }),
    getViewportCenter: () => ({ vx: 400, vy: 300 }),
    focusViewport() {},
    fitReadingRegion(region, target) {
      regionFits.push({ region, page: target });
      zoomScope.requestZoom(2);
      page = target;
      emit();
      return true;
    },
    normalizeReadingRegion: () => ({ left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 }),
    preserveView(update) { anchors++; const savedPage = page; update(); page = savedPage; },
  };
  const capabilities = {
    scroll: {
      setScrollStrategy(value) { strategy = value; emit(); },
    },
    spread: { forDocument: () => ({
      getSpreadMode: () => spread, setSpreadMode(value) { spread = value; emit(); }, onSpreadChange: subscribe,
    }) },
    zoom: { forDocument: () => zoomScope },
    rotate: { forDocument: () => ({
      rotateForward() { page = 8; emit(); },
      onRotateChange: () => () => {},
    }) },
    'interaction-manager': { registerMode() {}, forDocument: () => interaction },
    viewport: { onViewportResize(listener) { resizeListeners.add(listener); return () => resizeListeners.delete(listener); } },
  };
  const stage = new ViewerStage(
    { getPlugin: (name) => ({ provides: () => capabilities[name] }) },
    'doc',
    scroll,
  );
  t.after(stage.install());
  return { stage, jumps, jumpBehaviors, zooms, emit, regionFits, interaction, resize: () => resizeListeners.forEach((listener) => listener({ documentId: 'doc' })), anchors: () => anchors };
}

test('page steps use smooth navigation and accumulate rapid input within document bounds', (t) => {
  const { stage, jumps, jumpBehaviors } = setup(t);
  stage.movePages(1);
  stage.movePages(1);
  stage.movePages(-1);
  assert.deepEqual(jumps, [3, 4, 3]);
  assert.deepEqual(jumpBehaviors, ['smooth', 'smooth', 'smooth']);
  stage.goToPage(10);
  stage.movePages(1);
  assert.equal(stage.getSnapshot().pageNumber, 10);
  stage.goToPage(1);
  stage.movePages(-1);
  assert.equal(stage.getSnapshot().pageNumber, 1);
});

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

test('rotation preserves the current page despite intermediate layout notifications', (t) => {
  const { stage, anchors, emit } = setup(t);
  const pages = [];
  stage.subscribe(() => pages.push(stage.getSnapshot().pageNumber));
  stage.rotate();
  emit();
  assert.equal(stage.getSnapshot().pageNumber, 2);
  assert.equal(anchors(), 1);
  assert.deepEqual(pages, []);
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

const region = { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 };

test('rectangle selection fits once and later zoom, navigation and resize use normal behavior', (t) => {
  const { stage, regionFits, zooms, jumps, resize, interaction } = setup(t);
  stage.beginRegionSelection();
  stage.completeRegionSelection(1, { origin: { x: 10, y: 10 }, size: { width: 100, height: 100 } });
  assert.deepEqual(regionFits, [{ region, page: 2 }]);
  assert.equal(stage.getSnapshot().selectingRegion, false);
  assert.equal(interaction.getActiveMode(), 'pointerMode');
  stage.setZoom(ZoomMode.FitWidth);
  assert.equal(zooms.at(-1), ZoomMode.FitWidth);
  stage.movePages(1);
  assert.deepEqual(jumps, [3]);
  resize();
  stage.setZoom(1.5);
  assert.equal(zooms.at(-1), 1.5);
  stage.setZoom(ZoomMode.FitPage);
  assert.equal(zooms.at(-1), ZoomMode.FitPage);
  assert.deepEqual(regionFits, [{ region, page: 2 }]);
});

test('rectangle selection cancels on toggle or mode change and ignores completion when inactive', (t) => {
  const { stage, interaction, regionFits, zooms } = setup(t);
  const rect = { origin: { x: 10, y: 10 }, size: { width: 100, height: 100 } };
  stage.completeRegionSelection(4, rect);
  assert.deepEqual(regionFits, []);
  stage.beginRegionSelection();
  assert.equal(stage.getSnapshot().selectingRegion, true);
  stage.beginRegionSelection();
  assert.equal(stage.getSnapshot().selectingRegion, false);
  assert.equal(interaction.getActiveMode(), 'pointerMode');
  stage.completeRegionSelection(4, rect);
  assert.deepEqual(regionFits, []);
  stage.beginRegionSelection();
  stage.completeRegionSelection(4, rect);
  assert.equal(stage.getSnapshot().selectingRegion, false);
  assert.equal(stage.getSnapshot().pageNumber, 5);
  assert.deepEqual(regionFits, [{ region, page: 5 }]);
  stage.beginRegionSelection();
  interaction.activate('square');
  assert.equal(stage.getSnapshot().selectingRegion, false);
  stage.completeRegionSelection(7, rect);
  assert.deepEqual(regionFits, [{ region, page: 5 }]);
  assert.equal(zooms.length, 1);
});

test('presentation cancels selection and leaves the inactive viewport untouched', (t) => {
  const { stage, regionFits, zooms, jumps, resize, interaction } = setup(t);
  stage.beginRegionSelection();
  stage.completeRegionSelection(1, { origin: { x: 10, y: 10 }, size: { width: 100, height: 100 } });
  stage.beginRegionSelection();
  stage.setPresentation(true);
  assert.equal(stage.getSnapshot().selectingRegion, false);
  assert.equal(interaction.getActiveMode(), 'pointerMode');
  stage.movePages(1);
  stage.beginRegionSelection();
  stage.completeRegionSelection(4, { origin: { x: 10, y: 10 }, size: { width: 100, height: 100 } });
  stage.setZoom(ZoomMode.FitWidth);
  resize();
  assert.deepEqual(regionFits, [{ region, page: 2 }]);
  assert.deepEqual(zooms, [2]);
  assert.deepEqual(jumps, []);
  assert.equal(stage.getSnapshot().selectingRegion, false);
  stage.setPresentation(false);
  assert.deepEqual(jumps, [3]);
  assert.deepEqual(regionFits, [{ region, page: 2 }]);
});
