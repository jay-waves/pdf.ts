import { platform } from '#platform';
import type { PdfRenderTheme } from './pdf-render-theme';

const VIEWER_THEMES = [
  'light',
  'dark',
  'nord',
  'solar',
] as const;

export type ViewerTheme = (typeof VIEWER_THEMES)[number];
type AutomaticViewerTheme = Extract<ViewerTheme, 'light' | 'dark'>;

const THEME_STORAGE_KEY = 'pdf-viewer-theme-v1';
const TOOLBAR_PIN_STORAGE_KEY = 'pdf-toolbar-pinned-v1';
export const VIEWER_THEME_CHANGE_EVENT = 'pdf-ts-viewer-theme-change';
let automaticThemeEnabled = true;
let automaticThemeListenerInstalled = false;

const PDF_RENDER_THEMES: Partial<Record<ViewerTheme, PdfRenderTheme>> = {
  dark: {
    mode: 'forced-colors',
    background: 0xff242424,
    // Filled vector regions act as dark surfaces; strokes and text remain
    // light so reverse-color labels retain their contrast.
    pathFill: 0xff303030,
    pathStroke: 0xffe8e8e8,
    textFill: 0xffe8e8e8,
    textStroke: 0xffe8e8e8,
  },
  nord: {
    mode: 'forced-colors',
    // Compensate for the shared page filter so the displayed background
    // lands near Nord's darker #2e3440 blue-gray surface.
    background: 0xff505662,
    pathFill: 0xff697287,
    pathStroke: 0xfff4f4f4,
    textFill: 0xfff4f4f4,
    textStroke: 0xfff4f4f4,
  },
  solar: {
    mode: 'background',
    background: 0xfffbfaf6,
  },
};

function isAutomaticTheme(theme: ViewerTheme): theme is AutomaticViewerTheme {
  return theme === 'light' || theme === 'dark';
}

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

export function getPdfRenderTheme(theme: ViewerTheme): PdfRenderTheme | null {
  return PDF_RENDER_THEMES[theme] ?? null;
}

export function getCurrentViewerTheme(): ViewerTheme {
  const theme = document.documentElement.dataset.viewerTheme;
  return VIEWER_THEMES.find((candidate) => candidate === theme) ?? 'light';
}

function getAutomaticTheme(media: MediaQueryList): AutomaticViewerTheme {
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

function applyViewerTheme(theme: ViewerTheme, persist = false) {
  const changed = document.documentElement.dataset.viewerTheme !== theme;
  document.documentElement.dataset.viewerTheme = theme;
  if (persist) platform.setPreference(THEME_STORAGE_KEY, theme);
  if (changed) {
    window.dispatchEvent(new CustomEvent(VIEWER_THEME_CHANGE_EVENT, { detail: { theme } }));
  }
}

export function initializeViewerTheme() {
  const storedTheme = getStoredTheme();
  automaticThemeEnabled = isAutomaticTheme(storedTheme);
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  applyViewerTheme(automaticThemeEnabled ? getAutomaticTheme(media) : storedTheme);

  if (automaticThemeListenerInstalled) return;
  automaticThemeListenerInstalled = true;
  const syncAutomaticTheme = () => {
    if (automaticThemeEnabled) applyViewerTheme(getAutomaticTheme(media));
  };
  media.addEventListener('change', syncAutomaticTheme);
  new MutationObserver(syncAutomaticTheme).observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
  });
}

export function cycleViewerTheme() {
  const currentTheme = document.documentElement.dataset.viewerTheme;
  const currentIndex = VIEWER_THEMES.findIndex((theme) => theme === currentTheme);
  const theme = VIEWER_THEMES[(currentIndex + 1) % VIEWER_THEMES.length];
  automaticThemeEnabled = isAutomaticTheme(theme);
  applyViewerTheme(theme, true);
}

export function setViewerScrollStrategyAttribute(strategy: 'vertical' | 'horizontal') {
  document.documentElement.dataset.pdfScrollStrategy = strategy;
}
