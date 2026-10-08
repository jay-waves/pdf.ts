import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { ZoomMode } from '@embedpdf/plugin-zoom';

const platform = { readReadingProgress() {}, writeReadingProgress() {} };
globalThis.__readingHistoryTestPlatform = platform;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
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

function setup(t, saved, deferredRead) {
  const timers = new Map();
  let nextId = 0;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setTimeout(callback) { timers.set(++nextId, callback); return nextId; },
    clearTimeout(id) { timers.delete(id); }, addEventListener() {}, removeEventListener() {},
  } });
  const writes = [];
  t.mock.method(platform, 'readReadingProgress', () => deferredRead ?? Promise.resolve(saved));
  t.mock.method(platform, 'writeReadingProgress', async (_, progress) => writes.push(progress));
  let snapshot = { pageNumber: 1, mode: 'reading', strategy: 'vertical', spread: 'none', selectingRegion: false };
  const listeners = new Set();
  const emit = () => listeners.forEach((listener) => listener());
  let layoutReady;
  const stage = {
    getSnapshot: () => snapshot, getPosition: () => ({ scrollLeft: 0, scrollTop: 0 }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    onLayoutReady(listener) { layoutReady = listener; return () => {}; },
    applyLayout(strategy, spread) { snapshot = { ...snapshot, strategy, spread }; emit(); },
    goToPage(pageNumber) { snapshot = { ...snapshot, pageNumber }; emit(); },
  };
  const dispose = installReadingHistory(stage, 'test-document');
  t.after(() => { dispose(); if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window; });
  layoutReady();
  return { stage, writes, timers, setSelection() { snapshot = { ...snapshot, selectingRegion: true }; emit(); } };
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
