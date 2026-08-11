import { useEffect, useState } from 'react';
import { platform } from '#platform';
import type { PdfRenderTheme } from './pdf-render-theme';

type ViewerColorMode = 'light' | 'dark';
type ViewerThemeMetadata = {
  id: string;
  label: string;
  colorMode: ViewerColorMode;
  renderTheme: PdfRenderTheme | null;
};

const VIEWER_THEME_METADATA = [
  { id: 'light', label: 'Light', colorMode: 'light', renderTheme: null },
  {
    id: 'solar',
    label: 'Solar',
    colorMode: 'light',
    renderTheme: { mode: 'background', background: 0xfffbfaf6 },
  },
  {
    id: 'catppuccin-latte',
    label: 'Latte',
    colorMode: 'light',
    renderTheme: { mode: 'background', background: 0xffeff1f5 },
  },
  {
    id: 'dark',
    label: 'Dark',
    colorMode: 'dark',
    renderTheme: {
      mode: 'forced-colors',
      background: 0xff242424,
      // Keep filled regions lighter than the page while retaining enough
      // contrast for the light text forced inside reverse-color labels.
      pathFill: 0xff626262,
      pathStroke: 0xff8d8d8d,
      textFill: 0xffe8e8e8,
      textStroke: 0xffe8e8e8,
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    colorMode: 'dark',
    renderTheme: {
      mode: 'forced-colors',
      // Compensate for the shared page filter so the displayed background
      // lands near Nord's darker #2e3440 blue-gray surface.
      background: 0xff505662,
      pathFill: 0xff5e6677,
      pathStroke: 0xff8f99a8,
      textFill: 0xfff4f4f4,
      textStroke: 0xfff4f4f4,
    },
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox',
    colorMode: 'dark',
    renderTheme: {
      mode: 'forced-colors',
      // Compensate for the shared dark-page filter so the rendered page lands
      // near the theme background, #2d2c2a.
      background: 0xff4f4e4c,
      pathFill: 0xff857b6d,
      // Keep vector outlines in a soft Gruvbox ochre while rendering text in a
      // brighter warm white, so fine diagrams do not visually merge with type.
      pathStroke: 0xffc3b276,
      textFill: 0xfff9f5d7,
      textStroke: 0xfff9f5d7,
    },
  },
  {
    id: 'catppuccin-mocha',
    label: 'Mocha',
    colorMode: 'dark',
    renderTheme: {
      mode: 'forced-colors',
      // Compensate for the shared dark-page filter so the rendered page lands
      // near the slightly deeper #383c4f blue-gray base.
      background: 0xff5a5f73,
      pathFill: 0xff6c7086,
      pathStroke: 0xff7fc8bd,
      textFill: 0xffc6d0f5,
      textStroke: 0xffc6d0f5,
    },
  },
] as const satisfies readonly ViewerThemeMetadata[];

type ViewerThemeDefinition = (typeof VIEWER_THEME_METADATA)[number];
type ViewerThemeForMode<Mode extends ViewerColorMode> = Extract<
  ViewerThemeDefinition,
  { colorMode: Mode }
>['id'];
export type ViewerTheme = ViewerThemeDefinition['id'];
type LightViewerTheme = ViewerThemeForMode<'light'>;
type DarkViewerTheme = ViewerThemeForMode<'dark'>;
type ViewerThemeSettings = {
  light: LightViewerTheme;
  dark: DarkViewerTheme;
};

const THEME_STORAGE_KEY = 'pdf-viewer-theme-v1';
const LIGHT_THEME_STORAGE_KEY = 'pdf-viewer-light-theme-v2';
const DARK_THEME_STORAGE_KEY = 'pdf-viewer-dark-theme-v2';
const TOOLBAR_PIN_STORAGE_KEY = 'pdf-toolbar-pinned-v1';
export const VIEWER_THEME_CHANGE_EVENT = 'pdf-ts-viewer-theme-change';
let viewerThemeSettings: ViewerThemeSettings | null = null;
let manualColorMode: ViewerColorMode | null = null;

function findViewerTheme(value: unknown) {
  return typeof value === 'string'
    ? VIEWER_THEME_METADATA.find((theme) => theme.id === value)
    : undefined;
}

function isLightViewerTheme(value: unknown): value is LightViewerTheme {
  return findViewerTheme(value)?.colorMode === 'light';
}

function isDarkViewerThemeValue(value: unknown): value is DarkViewerTheme {
  return findViewerTheme(value)?.colorMode === 'dark';
}

export function getViewerThemeOptions<Mode extends ViewerColorMode>(mode: Mode) {
  return VIEWER_THEME_METADATA
    .filter((theme) => theme.colorMode === mode)
    .map(({ id: value, label }) => ({ value, label })) as Array<{
      value: ViewerThemeForMode<Mode>;
      label: string;
    }>;
}

export function getStoredToolbarPinned() {
  return platform.getPreference(TOOLBAR_PIN_STORAGE_KEY) === 'true';
}

export function setStoredToolbarPinned(pinned: boolean) {
  platform.setPreference(TOOLBAR_PIN_STORAGE_KEY, pinned ? 'true' : 'false');
}

function loadViewerThemeSettings(): ViewerThemeSettings {
  if (platform.viewerThemePolicy === 'host') {
    return { light: 'light', dark: 'dark' };
  }

  const legacyTheme = findViewerTheme(platform.getPreference(THEME_STORAGE_KEY))?.id ?? 'light';
  const storedLight = platform.getPreference(LIGHT_THEME_STORAGE_KEY);
  const storedDark = platform.getPreference(DARK_THEME_STORAGE_KEY);
  const light = isLightViewerTheme(storedLight)
    ? storedLight
    : isLightViewerTheme(legacyTheme) ? legacyTheme : 'light';
  const dark = isDarkViewerThemeValue(storedDark)
    ? storedDark
    : isDarkViewerThemeValue(legacyTheme) ? legacyTheme : 'dark';
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
  return findViewerTheme(theme)?.renderTheme ?? null;
}

export function getCurrentViewerTheme(): ViewerTheme {
  return findViewerTheme(document.documentElement.dataset.viewerTheme)?.id ?? 'light';
}

export function isDarkViewerTheme(theme: ViewerTheme) {
  return findViewerTheme(theme)?.colorMode === 'dark';
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
  const metadata = findViewerTheme(theme);
  const changed = document.documentElement.dataset.viewerTheme !== theme;
  document.documentElement.dataset.viewerTheme = theme;
  document.documentElement.dataset.viewerColorMode = metadata?.colorMode ?? 'light';
  if (changed) {
    window.dispatchEvent(new CustomEvent(VIEWER_THEME_CHANGE_EVENT, { detail: { theme } }));
  }
}

function applyViewerColorMode(mode: ViewerColorMode) {
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
  manualColorMode = isDarkViewerTheme(getCurrentViewerTheme()) ? 'light' : 'dark';
  applyViewerColorMode(manualColorMode);
}

export function initializeViewerTheme() {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  applyViewerColorMode(getSystemColorMode(media));

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
