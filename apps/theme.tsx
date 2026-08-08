import { useEffect, useState } from 'react';
import { platform } from '#platform';
import type { PdfRenderTheme } from './pdf-render-theme';

const VIEWER_THEMES = [
  'light',
  'dark',
  'nord',
  'gruvbox',
  'solar',
] as const;

export type ViewerTheme = (typeof VIEWER_THEMES)[number];
export type LightViewerTheme = Extract<ViewerTheme, 'light' | 'solar'>;
export type DarkViewerTheme = Extract<ViewerTheme, 'dark' | 'nord' | 'gruvbox'>;
export type ViewerColorMode = 'light' | 'dark';
export type ViewerThemeSettings = {
  light: LightViewerTheme;
  dark: DarkViewerTheme;
};

const THEME_STORAGE_KEY = 'pdf-viewer-theme-v1';
const LIGHT_THEME_STORAGE_KEY = 'pdf-viewer-light-theme-v2';
const DARK_THEME_STORAGE_KEY = 'pdf-viewer-dark-theme-v2';
const TOOLBAR_PIN_STORAGE_KEY = 'pdf-toolbar-pinned-v1';
export const VIEWER_THEME_CHANGE_EVENT = 'pdf-ts-viewer-theme-change';
let automaticThemeListenerInstalled = false;
let viewerThemeSettings: ViewerThemeSettings | null = null;
let viewerColorMode: ViewerColorMode = 'light';
let manualColorMode: ViewerColorMode | null = null;

const PDF_RENDER_THEMES: Partial<Record<ViewerTheme, PdfRenderTheme>> = {
  dark: {
    mode: 'forced-colors',
    background: 0xff242424,
    // Keep filled regions lighter than the page while retaining enough
    // contrast for the light text forced inside reverse-color labels.
    pathFill: 0xff8d8d8d,
    pathStroke: 0xffc6c6c6,
    textFill: 0xffe8e8e8,
    textStroke: 0xffe8e8e8,
  },
  nord: {
    mode: 'forced-colors',
    // Compensate for the shared page filter so the displayed background
    // lands near Nord's darker #2e3440 blue-gray surface.
    background: 0xff505662,
    pathFill: 0xff697287,
    pathStroke: 0xffd8e6ea,
    textFill: 0xfff4f4f4,
    textStroke: 0xfff4f4f4,
  },
  gruvbox: {
    mode: 'forced-colors',
    // Compensate for the shared dark-page filter so the rendered page lands
    // near the theme background, #2d2c2a.
    background: 0xff4f4e4c,
    pathFill: 0xff857b6d,
    // Keep vector outlines in a soft Gruvbox ochre while rendering text in a
    // brighter warm white, so fine diagrams do not visually merge with type.
    pathStroke: 0xffc9b77a,
    textFill: 0xfff9f5d7,
    textStroke: 0xfff9f5d7,
  },
  solar: {
    mode: 'background',
    background: 0xfffbfaf6,
  },
};

export function getStoredToolbarPinned() {
  return platform.getPreference(TOOLBAR_PIN_STORAGE_KEY) === 'true';
}

export function setStoredToolbarPinned(pinned: boolean) {
  platform.setPreference(TOOLBAR_PIN_STORAGE_KEY, pinned ? 'true' : 'false');
}

function getLegacyStoredTheme(): ViewerTheme {
  const storedThemeId = platform.getPreference(THEME_STORAGE_KEY);
  return VIEWER_THEMES.find((theme) => theme === storedThemeId) ?? VIEWER_THEMES[0];
}

function loadViewerThemeSettings(): ViewerThemeSettings {
  if (platform.viewerThemePolicy === 'host') {
    return { light: 'light', dark: 'dark' };
  }

  const legacyTheme = getLegacyStoredTheme();
  const storedLight = platform.getPreference(LIGHT_THEME_STORAGE_KEY);
  const storedDark = platform.getPreference(DARK_THEME_STORAGE_KEY);
  const light = storedLight === 'solar' || storedLight === 'light'
    ? storedLight
    : legacyTheme === 'solar' ? 'solar' : 'light';
  const dark = storedDark === 'nord' || storedDark === 'gruvbox' || storedDark === 'dark'
    ? storedDark
    : legacyTheme === 'nord' ? 'nord' : 'dark';
  return { light, dark };
}

function getThemeSettings() {
  if (!viewerThemeSettings) {
    viewerThemeSettings = loadViewerThemeSettings();
  }
  return viewerThemeSettings;
}

export function getViewerThemeSettings(): ViewerThemeSettings {
  return { ...getThemeSettings() };
}

export function supportsViewerThemeSettings() {
  return platform.viewerThemePolicy !== 'host';
}

export function getPdfRenderTheme(theme: ViewerTheme): PdfRenderTheme | null {
  return PDF_RENDER_THEMES[theme] ?? null;
}

export function getCurrentViewerTheme(): ViewerTheme {
  const theme = document.documentElement.dataset.viewerTheme;
  return VIEWER_THEMES.find((candidate) => candidate === theme) ?? 'light';
}

export function isDarkViewerTheme(theme: ViewerTheme) {
  return theme === 'dark' || theme === 'nord' || theme === 'gruvbox';
}

export function useViewerTheme() {
  const [theme, setTheme] = useState(getCurrentViewerTheme);

  useEffect(() => {
    const sync = (event: Event) => {
      setTheme((event as CustomEvent<{ theme: ViewerTheme }>).detail.theme);
    };
    window.addEventListener(VIEWER_THEME_CHANGE_EVENT, sync);
    return () => window.removeEventListener(VIEWER_THEME_CHANGE_EVENT, sync);
  }, []);

  return theme;
}

function getSystemColorMode(media: MediaQueryList): ViewerColorMode {
  if (document.body.classList.contains('vscode-dark')
    || document.body.classList.contains('vscode-high-contrast')) {
    return 'dark';
  }
  if (document.body.classList.contains('vscode-light')
    || document.body.classList.contains('vscode-high-contrast-light')) {
    return 'light';
  }
  return media.matches ? 'dark' : 'light';
}

function applyViewerTheme(theme: ViewerTheme) {
  const changed = document.documentElement.dataset.viewerTheme !== theme;
  document.documentElement.dataset.viewerTheme = theme;
  if (changed) {
    window.dispatchEvent(new CustomEvent(VIEWER_THEME_CHANGE_EVENT, { detail: { theme } }));
  }
}

function applyViewerColorMode(mode: ViewerColorMode) {
  viewerColorMode = mode;
  applyViewerTheme(getThemeSettings()[mode]);
}

export function setViewerThemeSettings(settings: ViewerThemeSettings) {
  if (!supportsViewerThemeSettings()) return;
  viewerThemeSettings = { ...settings };
  platform.setPreference(LIGHT_THEME_STORAGE_KEY, settings.light);
  platform.setPreference(DARK_THEME_STORAGE_KEY, settings.dark);

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  applyViewerColorMode(manualColorMode ?? getSystemColorMode(media));
}

export function toggleViewerColorMode() {
  if (!supportsViewerThemeSettings()) return;
  manualColorMode = viewerColorMode === 'dark' ? 'light' : 'dark';
  applyViewerColorMode(manualColorMode);
}

export function initializeViewerTheme() {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  applyViewerColorMode(getSystemColorMode(media));

  if (automaticThemeListenerInstalled) return;
  automaticThemeListenerInstalled = true;
  const syncAutomaticTheme = () => {
    manualColorMode = null;
    applyViewerColorMode(getSystemColorMode(media));
  };
  media.addEventListener('change', syncAutomaticTheme);
  new MutationObserver(syncAutomaticTheme).observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
  });
}

export function setViewerScrollStrategyAttribute(strategy: 'vertical' | 'horizontal') {
  document.documentElement.dataset.pdfScrollStrategy = strategy;
}
