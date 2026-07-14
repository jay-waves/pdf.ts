export const VIEWER_THEMES = [
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' },
  { id: 'nord', name: 'Nord' },
  { id: 'solar', name: 'Solar' },
] as const;

const THEME_STORAGE_KEY = 'shnctl-viewer-theme-v1';
const TOOLBAR_PIN_STORAGE_KEY = 'shnctl-toolbar-pinned-v1';

export function getStoredToolbarPinned() {
  return platform.getPreference(TOOLBAR_PIN_STORAGE_KEY) === 'true';
}

export function setStoredToolbarPinned(pinned: boolean) {
  platform.setPreference(TOOLBAR_PIN_STORAGE_KEY, pinned ? 'true' : 'false');
}

export function getStoredThemeIndex() {
  const storedThemeId = platform.getPreference(THEME_STORAGE_KEY);
  const index = VIEWER_THEMES.findIndex((theme) => theme.id === storedThemeId);
  return index >= 0 ? index : 0;
}

function applyViewerTheme(themeIndex: number) {
  const theme = VIEWER_THEMES[themeIndex] ?? VIEWER_THEMES[0];
  document.documentElement.dataset.viewerTheme = theme.id;

  platform.setPreference(THEME_STORAGE_KEY, theme.id);
}

export function applyViewerThemeByIndex(themeIndex: number) {
  applyViewerTheme(themeIndex);
}

export function setViewerScrollStrategyAttribute(strategy: 'vertical' | 'horizontal') {
  document.documentElement.dataset.shnctlScrollStrategy = strategy;
}
import { platform } from '#platform';
