import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
const ZoomMode = { FitWidth: 'fit-width' };

const platform = { readReadingProgress() {}, writeReadingProgress() {} };
globalThis.__readingHistoryTestPlatform = platform;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '../viewer/viewer-stage') return { url: 'data:text/javascript,export const ScrollStrategy={Vertical:"vertical",Horizontal:"horizontal"};export const SpreadMode={None:"none",Odd:"odd",Even:"even"};', shortCircuit: true };
    if (specifier === '#platform') return { url: 'test:reading-platform', shortCircuit: true };
    return nextResolve(specifier === '../shared/reading-region' ? `${specifier}.ts` : specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'test:reading-platform') return { format: 'module', source: 'export const platform = globalThis.__readingHistoryTestPlatform;', shortCircuit: true };
    if (url.endsWith('/navigation/reading-history.ts')) {
      return { format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8')), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
const { installReadingHistory } = await import('../apps/navigation/reading-history.ts');
hooks.deregister();
delete globalThis.__readingHistoryTestPlatform;

const region = { left: 0.1, top: 0.2, right: 0.9, bottom: 0.8 };

function setup(t, saved, deferredRead, restore = true) {
  const timers = new Map();
  let nextId = 0;
  const events = new Map();
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    visibilityState: 'visible', addEventListener(name, callback) { events.set(name, callback); }, removeEventListener(name) { events.delete(name); },
  } });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setTimeout(callback, delay) { const run = () => callback(); run.delay = delay; timers.set(++nextId, run); return nextId; },
    clearTimeout(id) { timers.delete(id); }, addEventListener(name, callback) { events.set(name, callback); }, removeEventListener(name) { events.delete(name); },
  } });
  const writes = [];
  t.mock.method(platform, 'readReadingProgress', () => deferredRead ?? Promise.resolve(saved));
  t.mock.method(platform, 'writeReadingProgress', async (_, progress) => writes.push(progress));
  let viewpoint;
  let snapshot = { totalPages: 100, pageNumber: 1, mode: 'reading', strategy: 'vertical', spread: 'none', selectingRegion: false };
  const listeners = new Set();
  const emit = () => listeners.forEach((listener) => listener());
  let layoutReady;
  const cameraListeners = new Set();
  const stage = {
    getReadingViewpoint: () => viewpoint,
    onReadingPositionChange(listener) { cameraListeners.add(listener); return () => cameraListeners.delete(listener); },
    restoreReadingPosition(anchor) { viewpoint = anchor.viewpoint; this.goToPage(anchor.pageNumber); },
    getSnapshot: () => snapshot, getPosition: () => ({ scrollLeft: 0, scrollTop: 0 }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    onLayoutReady(listener) { layoutReady = listener; return () => {}; },
    applyLayout(strategy, spread) { snapshot = { ...snapshot, strategy, spread }; emit(); },
    goToPage(pageNumber) { snapshot = { ...snapshot, pageNumber }; emit(); },
  };
  const dispose = installReadingHistory(stage, 'test-document', restore);
  t.after(() => { dispose(); if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document; if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window; });
  layoutReady();
  return { stage, writes, timers, events, dispose,
    move(value) { viewpoint = value; cameraListeners.forEach(listener => listener()); },
    setSelection() { snapshot = { ...snapshot, selectingRegion: true }; emit(); } };
}

test('reading history restores page and layout and omits legacy reading-area fields when saving', async (t) => {
  const { stage, timers, writes } = setup(t, {
    pageNumber: 4, scrollStrategy: 'horizontal', spreadMode: 'none',
    readingRegion: region, regionFit: ZoomMode.FitWidth,
  });
  await Promise.resolve();
  assert.equal(stage.getSnapshot().pageNumber, 4);
  assert.equal(stage.getSnapshot().strategy, 'horizontal');
  assert.equal(stage.getSnapshot().spread, 'none');
  stage.goToPage(5);
  [...timers.values()].at(-1)();
  assert.deepEqual(writes.at(-1), {
    pageNumber: 5, scrollStrategy: 'horizontal', spreadMode: 'none',
  });
});

test('invalid saved page numbers do not restore layout', async (t) => {
  const { stage } = setup(t, { pageNumber: 0, scrollStrategy: 'horizontal', spreadMode: 'odd' });
  await Promise.resolve();
  assert.equal(stage.getSnapshot().pageNumber, 1);
  assert.equal(stage.getSnapshot().strategy, 'vertical');
  assert.equal(stage.getSnapshot().spread, 'none');
});

test('delayed history cannot overwrite an active selection', async (t) => {
  let resolve;
  const deferred = new Promise((done) => { resolve = done; });
  const pending = setup(t, undefined, deferred);
  pending.setSelection();
  resolve({ pageNumber: 7, readingRegion: region });
  await Promise.resolve();
  assert.equal(pending.stage.getSnapshot().pageNumber, 1);
  assert.equal(pending.stage.getSnapshot().selectingRegion, true);
  [...pending.timers.values()].at(-1)();
  assert.equal(pending.writes.at(-1).pageNumber, 1);
});


test('replacement keeps its prepared position instead of restoring old persisted history', async (t) => {
  const { stage, timers, writes } = setup(t, { pageNumber: 9 }, undefined, false);
  stage.goToPage(3);
  await Promise.resolve();
  assert.equal(stage.getSnapshot().pageNumber, 3);
  assert.equal(platform.readReadingProgress.mock.callCount(), 0);
  [...timers.values()].at(-1)();
  assert.equal(writes.at(-1).pageNumber, 3);
});

const view = (y, zoom = { level: 1.75 }) => ({ anchor: { pageIndex: 3, fractionX: .2, fractionY: y }, zoom });
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('restores precise page-relative position and zoom intent, and checkpoints same-page camera changes', async t => {
  const saved = { pageNumber: 4, viewpoint: view(.35, { mode: 'fit-width' }) };
  const pending = setup(t, saved);
  await settle();
  assert.deepEqual(pending.stage.getReadingViewpoint(), saved.viewpoint);
  assert.equal(pending.stage.getSnapshot().pageNumber, 4);
  for (let i = 0; i < 100; i++) pending.move(view(.4 + i / 1000));
  assert.equal(pending.writes.length, 0);
  assert.equal(pending.timers.size, 2);
  assert.deepEqual([...pending.timers.values()].map(fn => fn.delay).sort((a, b) => a - b), [500, 5000]);
  [...pending.timers.values()].find(fn => fn.delay === 5000)();
  await settle();
  assert.equal(pending.writes.length, 1);
  assert.deepEqual(pending.writes[0].viewpoint, view(.499));
  assert.equal(pending.timers.size, 0);
  pending.move(view(.6));
  document.visibilityState = 'hidden';
  pending.events.get('visibilitychange')();
  await settle();
  assert.equal(pending.writes.at(-1).viewpoint.anchor.fractionY, .6);
  pending.events.get('pagehide')();
  await settle();
  assert.equal(pending.writes.length, 2, 'unchanged progress should not write again');
});

test('invalid viewpoints fall back to the legacy page and pending writes keep only the latest position', async t => {
  const pending = setup(t, { pageNumber: 4, viewpoint: view(NaN) });
  await settle();
  assert.equal(pending.stage.getSnapshot().pageNumber, 4);
  assert.equal(pending.stage.getReadingViewpoint(), undefined);
  let release;
  const recorded = [];
  t.mock.method(platform, 'writeReadingProgress', async (_, progress) => {
    recorded.push(progress);
    if (recorded.length === 1) await new Promise(resolve => { release = resolve; });
  });
  for (const y of [.1, .2, .3]) {
    pending.move(view(y));
    pending.events.get('pagehide')();
  }
  assert.equal(recorded.length, 1);
  release();
  await settle();
  assert.deepEqual(recorded.map(p => p.viewpoint.anchor.fractionY), [.1, .3]);
});
