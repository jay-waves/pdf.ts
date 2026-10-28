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
globalThis.document = { documentElement: { dataset: {} } };
const listeners = new Set();
const media = {
  matches: true,
  addEventListener: (_, listener) => listeners.add(listener),
  removeEventListener: (_, listener) => listeners.delete(listener),
};
globalThis.window = { matchMedia: () => media };
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
