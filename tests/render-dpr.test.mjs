import assert from 'node:assert/strict';
import test from 'node:test';

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
  viewerDiagnosticsStore,
} = await import('../apps/renderer/viewer-diagnostics.ts');

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
