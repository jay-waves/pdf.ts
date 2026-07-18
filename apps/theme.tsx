import { platform } from '#platform';

const VIEWER_THEMES = [
  'light',
  'dark',
  'nord',
  'solar',
] as const;

type ViewerTheme = (typeof VIEWER_THEMES)[number];

const THEME_STORAGE_KEY = 'shnctl-viewer-theme-v1';
const TOOLBAR_PIN_STORAGE_KEY = 'shnctl-toolbar-pinned-v1';

export function getStoredToolbarPinned() {
  return platform.getPreference(TOOLBAR_PIN_STORAGE_KEY) === 'true';
}

export function setStoredToolbarPinned(pinned: boolean) {
  platform.setPreference(TOOLBAR_PIN_STORAGE_KEY, pinned ? 'true' : 'false');
}

function getStoredTheme(): ViewerTheme {
  const storedThemeId = platform.getPreference(THEME_STORAGE_KEY);
  return VIEWER_THEMES.find((theme) => theme === storedThemeId) ?? VIEWER_THEMES[0];
}

export function initializeViewerTheme() {
  document.documentElement.dataset.viewerTheme = getStoredTheme();
}

export function cycleViewerTheme() {
  const currentTheme = document.documentElement.dataset.viewerTheme;
  const currentIndex = VIEWER_THEMES.findIndex((theme) => theme === currentTheme);
  const theme = VIEWER_THEMES[(currentIndex + 1) % VIEWER_THEMES.length];
  document.documentElement.dataset.viewerTheme = theme;
  platform.setPreference(THEME_STORAGE_KEY, theme);
}

export function setViewerScrollStrategyAttribute(strategy: 'vertical' | 'horizontal') {
  document.documentElement.dataset.shnctlScrollStrategy = strategy;
}
