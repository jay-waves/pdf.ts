import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

const preferences = new Map();
globalThis.__dprTestPlatform = {
  getPreference: (key) => preferences.get(key) ?? null,
  setPreference: (key, value) => preferences.set(key, value),
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '#platform') {
      return { url: 'data:text/javascript,export const platform = globalThis.__dprTestPlatform;', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const queries = [];
globalThis.window = {
  devicePixelRatio: 2,
  matchMedia(media) {
    const query = new EventTarget();
    query.media = media;
    queries.push(query);
    return query;
  },
};
const {
  getEffectiveRenderDpr,
  getSystemDpr,
  installRenderDprMonitor,
  resetViewerDiagnostics,
  setRenderDprMode,
  viewerDiagnosticsStore,
} = await import('../apps/renderer/viewer-diagnostics.ts');

test('DPR preferences survive module reloads and diagnostics resets', async () => {
  for (const mode of ['1.25', '1.5', '1.75', 'system', 'auto']) {
    setRenderDprMode(mode);
    resetViewerDiagnostics();
    assert.equal(viewerDiagnosticsStore.getState().renderDprMode, mode);
    const restored = await import(`../apps/renderer/viewer-diagnostics.ts?mode=${mode}`);
    assert.equal(restored.viewerDiagnosticsStore.getState().renderDprMode, mode);
  }
});

test('missing or invalid DPR preferences fall back to auto', async () => {
  for (const value of [null, '', '3', 'invalid']) {
    preferences.clear();
    if (value !== null) preferences.set('pdf-viewer-render-dpr-v1', value);
    const restored = await import(`../apps/renderer/viewer-diagnostics.ts?fallback=${value}`);
    assert.equal(restored.viewerDiagnosticsStore.getState().renderDprMode, 'auto');
  }
});

test('DPR monitor follows display changes without overriding the browser property', () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  const dispose = installRenderDprMonitor();
  assert.equal(getEffectiveRenderDpr('auto'), 1.75);
  assert.deepEqual(Object.getOwnPropertyDescriptor(window, 'devicePixelRatio'), descriptor);
  const previousQuery = queries.at(-1);
  window.devicePixelRatio = 1.25;
  previousQuery.dispatchEvent(new Event('change'));
  assert.equal(viewerDiagnosticsStore.getState().systemDpr, 1.25);
  assert.equal(getSystemDpr(), 1.25);
  assert.equal(getEffectiveRenderDpr('system'), 1.25);
  assert.equal(getEffectiveRenderDpr('1.5'), 1.5);
  assert.equal(queries.at(-1).media, '(resolution: 1.25dppx)');
  resetViewerDiagnostics();
  assert.equal(viewerDiagnosticsStore.getState().systemDpr, 1.25);
  const count = queries.length;
  previousQuery.dispatchEvent(new Event('change'));
  assert.equal(queries.length, count);
  dispose();
  window.devicePixelRatio = 3;
  queries.at(-1).dispatchEvent(new Event('change'));
  assert.equal(viewerDiagnosticsStore.getState().systemDpr, 1.25);
});
