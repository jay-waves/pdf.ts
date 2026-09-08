import { createStore } from 'zustand/vanilla';
import { platform } from '#platform';
import type { PdfRenderTheme } from '../renderer/pdf-render-theme';

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
    id: 'dark',
    label: 'Dark',
    colorMode: 'dark',
    renderTheme: {
      mode: 'forced-colors',
      background: 0xff1e1e1e,
      // Keep filled regions lighter than the page while retaining enough
      // contrast for the light text forced inside reverse-color labels.
      pathFill: 0xff3f3f3f,
      pathStroke: 0xff676767,
      textFill: 0xffbbbbbb,
      textStroke: 0xffbbbbbb,
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    colorMode: 'dark',
    renderTheme: {
      mode: 'forced-colors',
      background: 0xff2e3440,
      pathFill: 0xff3b4352,
      pathStroke: 0xff697280,
      textFill: 0xffc6c6c6,
      textStroke: 0xffc6c6c6,
    },
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox',
    colorMode: 'dark',
    renderTheme: {
      mode: 'forced-colors',
      background: 0xff2d2c2a,
      pathFill: 0xff5f5649,
      // Keep vector outlines in a soft Gruvbox ochre while rendering text in a
      // brighter warm white, so fine diagrams do not visually merge with type.
      pathStroke: 0xff998951,
      textFill: 0xffcbc7ab,
      textStroke: 0xffcbc7ab,
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

const LIGHT_THEME_STORAGE_KEY = 'pdf-viewer-light-theme-v2';
const DARK_THEME_STORAGE_KEY = 'pdf-viewer-dark-theme-v2';
const TOOLBAR_PIN_STORAGE_KEY = 'pdf-toolbar-pinned-v1';

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
  const storedLight = platform.getPreference(LIGHT_THEME_STORAGE_KEY);
  const storedDark = platform.getPreference(DARK_THEME_STORAGE_KEY);
  const light = isLightViewerTheme(storedLight) ? storedLight : 'light';
  const dark = isDarkViewerThemeValue(storedDark) ? storedDark : 'dark';

  if (storedLight !== null && storedLight !== light) {
    platform.setPreference(LIGHT_THEME_STORAGE_KEY, light);
  }
  if (storedDark !== null && storedDark !== dark) {
    platform.setPreference(DARK_THEME_STORAGE_KEY, dark);
  }
  return { light, dark };
}

function getInitialViewerTheme(): ViewerTheme {
  return findViewerTheme(document.documentElement.dataset.viewerTheme)?.id ?? 'light';
}

export const viewerThemeStore = createStore<{
  theme: ViewerTheme;
  settings: ViewerThemeSettings;
  manualColorMode: ViewerColorMode | null;
}>(() => ({
  theme: getInitialViewerTheme(),
  settings: loadViewerThemeSettings(),
  manualColorMode: null,
}));

export function getPdfRenderTheme(theme: ViewerTheme): PdfRenderTheme | null {
  return findViewerTheme(theme)?.renderTheme ?? null;
}

export function isDarkViewerTheme(theme: ViewerTheme) {
  return findViewerTheme(theme)?.colorMode === 'dark';
}

function getSystemColorMode(media: MediaQueryList): ViewerColorMode {
  return media.matches ? 'dark' : 'light';
}

function applyViewerTheme(theme: ViewerTheme) {
  const metadata = findViewerTheme(theme);
  document.documentElement.dataset.viewerTheme = theme;
  document.documentElement.dataset.viewerColorMode = metadata?.colorMode ?? 'light';
  viewerThemeStore.setState({ theme });
}

function applyViewerColorMode(mode: ViewerColorMode) {
  applyViewerTheme(viewerThemeStore.getState().settings[mode]);
}

export function setViewerThemeSettings(settings: ViewerThemeSettings) {
  viewerThemeStore.setState({ settings: { ...settings } });
  platform.setPreference(LIGHT_THEME_STORAGE_KEY, settings.light);
  platform.setPreference(DARK_THEME_STORAGE_KEY, settings.dark);

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  applyViewerColorMode(viewerThemeStore.getState().manualColorMode ?? getSystemColorMode(media));
}

export function toggleViewerColorMode() {
  const manualColorMode = isDarkViewerTheme(viewerThemeStore.getState().theme) ? 'light' : 'dark';
  viewerThemeStore.setState({ manualColorMode });
  applyViewerColorMode(manualColorMode);
}

export function initializeViewerTheme() {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  applyViewerColorMode(getSystemColorMode(media));

  const syncAutomaticTheme = () => {
    viewerThemeStore.setState({ manualColorMode: null });
    applyViewerColorMode(getSystemColorMode(media));
  };
  media.addEventListener('change', syncAutomaticTheme);
  const observer = new MutationObserver(syncAutomaticTheme);
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
  });
  return () => {
    media.removeEventListener('change', syncAutomaticTheme);
    observer.disconnect();
  };
}
