import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformWithOxc } from 'vite';

const themeUrl = new URL('../apps/theme/theme.tsx', import.meta.url);
const transformed = await transformWithOxc(readFileSync(themeUrl, 'utf8'), themeUrl.pathname);
const preferences = new Map();
globalThis.themeTestPlatform = {
  getPreference: (key) => preferences.get(key) ?? null,
  setPreference: (key, value) => preferences.set(key, value),
};
const windowEvents = new Map();
const documentEvents = new Map();
const eventSurface = (events) => ({
  addEventListener(type, callback) {
    if (!events.has(type)) events.set(type, new Set());
    events.get(type).add(callback);
  },
  removeEventListener(type, callback) { events.get(type)?.delete(callback); },
});
globalThis.document = {
  documentElement: { dataset: {} }, visibilityState: 'visible', ...eventSurface(documentEvents),
};
const listeners = new Set();
const media = {
  matches: true,
  addEventListener: (_, listener) => listeners.add(listener),
  removeEventListener: (_, listener) => listeners.delete(listener),
};
globalThis.window = { matchMedia: () => media, ...eventSurface(windowEvents) };
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '#platform') return {
      url: 'data:text/javascript,export const platform = globalThis.themeTestPlatform;',
      shortCircuit: true,
    };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === themeUrl.href) return { format: 'module', source: transformed.code, shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { initializeViewerTheme, toggleViewerColorMode, setViewerThemeSettings, viewerThemeStore } = await import(themeUrl.href);
hooks.deregister();

function changeSystemMode(dark) {
  media.matches = dark;
  for (const listener of listeners) listener();
}

test('manual appearance survives reload until the system mode actually changes', () => {
  let dispose = initializeViewerTheme();
  assert.equal(viewerThemeStore.getState().theme, 'dark');
  toggleViewerColorMode();
  setViewerThemeSettings({ light: 'solar', dark: 'nord' });
  assert.equal(viewerThemeStore.getState().theme, 'solar');

  dispose();
  viewerThemeStore.setState({ manualColorMode: null });
  dispose = initializeViewerTheme();
  assert.equal(viewerThemeStore.getState().theme, 'solar');
  changeSystemMode(true); // A redundant notification must preserve the override.
  assert.equal(viewerThemeStore.getState().theme, 'solar');
  changeSystemMode(false);
  changeSystemMode(true);
  assert.equal(viewerThemeStore.getState().theme, 'nord');
  assert.equal(viewerThemeStore.getState().manualColorMode, null);

  toggleViewerColorMode();
  assert.equal(viewerThemeStore.getState().theme, 'solar');
  dispose();
  media.matches = false; // Also recognize system changes while the viewer is closed.
  dispose = initializeViewerTheme();
  assert.equal(viewerThemeStore.getState().manualColorMode, null);
  toggleViewerColorMode();
  assert.equal(viewerThemeStore.getState().theme, 'nord');
  dispose();
  dispose = initializeViewerTheme();
  assert.equal(viewerThemeStore.getState().theme, 'nord');
  dispose();
  assert.equal(listeners.size, 0);
});


test('open tabs receive theme preferences without publishing them back', () => {
  const dispose = initializeViewerTheme();
  preferences.set('pdf-viewer-light-theme-v2', 'solar');
  preferences.set('pdf-viewer-dark-theme-v2', 'gruvbox');
  preferences.set('pdf-viewer-system-color-mode-v1', media.matches ? 'dark' : 'light');
  preferences.set('pdf-viewer-color-mode-v1', 'dark');
  let writes = 0;
  const write = globalThis.themeTestPlatform.setPreference;
  globalThis.themeTestPlatform.setPreference = (...args) => { writes++; write(...args); };
  try {
    for (const listener of windowEvents.get('storage')) listener({ key: 'pdf-viewer-color-mode-v1' });
    assert.equal(viewerThemeStore.getState().theme, 'gruvbox');
    assert.equal(document.documentElement.dataset.viewerTheme, 'gruvbox');
    assert.equal(writes, 0);
    preferences.set('pdf-viewer-color-mode-v1', 'light');
    for (const listener of windowEvents.get('pageshow')) listener();
    assert.equal(viewerThemeStore.getState().theme, 'solar');
    preferences.set('pdf-viewer-color-mode-v1', 'dark');
    for (const listener of documentEvents.get('visibilitychange')) listener();
    assert.equal(viewerThemeStore.getState().theme, 'gruvbox');
    assert.equal(writes, 0);
  } finally {
    globalThis.themeTestPlatform.setPreference = write;
    dispose();
  }
  for (const group of [...windowEvents.values(), ...documentEvents.values()]) assert.equal(group.size, 0);
});
