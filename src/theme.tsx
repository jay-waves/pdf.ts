import type { MutableRefObject } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import {
  type PDFViewerRef,
  type ThemeConfig,
} from '@embedpdf/react-pdf-viewer';
import { EMPTY_CLEANUP } from './utils';

type ViewerTheme = {
  id: string;
  name: string;
  config: ThemeConfig;
};

export const VIEWER_THEMES: ViewerTheme[] = [
  {
    id: 'light',
    name: 'Light',
    config: {
      preference: 'light',
      light: {
        accent: {
          primary: '#2563eb',
          primaryHover: '#1d4ed8',
          primaryActive: '#1e40af',
          primaryLight: '#dbeafe',
          primaryForeground: '#ffffff',
        },
      },
    },
  },
  {
    id: 'dark',
    name: 'Dark',
    config: {
      preference: 'dark',
      dark: {
        background: {
          app: '#161616',
          surface: '#333333',
          surfaceAlt: '#262626',
          elevated: '#333333',
          overlay: 'rgba(22, 22, 22, 0.72)',
          input: '#161616',
        },
        foreground: {
          primary: '#f4f4f4',
          secondary: '#e0e0e0',
          muted: '#a8a8a8',
          disabled: '#6f6f6f',
          onAccent: '#161616',
        },
        border: {
          default: '#333333',
          subtle: '#262626',
          strong: '#525252',
        },
        accent: {
          primary: '#f4f4f4',
          primaryHover: '#e0e0e0',
          primaryActive: '#c6c6c6',
          primaryLight: '#333333',
          primaryForeground: '#161616',
        },
        interactive: {
          hover: '#333333',
          active: '#525252',
          selected: '#333333',
          focus: '#f4f4f4',
          focusRing: '#8d8d8d',
        },
      },
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    config: {
      preference: 'dark',
      dark: {
        background: {
          app: '#2e3440',
          surface: '#3b4252',
          surfaceAlt: '#434c5e',
          elevated: '#434c5e',
          overlay: 'rgba(46, 52, 64, 0.68)',
          input: '#434c5e',
        },
        foreground: {
          primary: '#eceff4',
          secondary: '#e5e9f0',
          muted: '#d8dee9',
          disabled: '#4c566a',
          onAccent: '#2e3440',
        },
        border: {
          default: '#4c566a',
          subtle: '#434c5e',
          strong: '#88c0d0',
        },
        accent: {
          primary: '#88c0d0',
          primaryHover: '#8fbcbb',
          primaryActive: '#81a1c1',
          primaryLight: '#4c566a',
          primaryForeground: '#2e3440',
        },
        interactive: {
          hover: '#434c5e',
          active: '#4c566a',
          selected: '#4c566a',
          focus: '#88c0d0',
          focusRing: '#5e81ac',
        },
      },
    },
  },
  {
    id: 'solar',
    name: 'Solar',
    config: {
      preference: 'light',
      light: {
        background: {
          app: '#fbfaf6',
          surface: '#f7f4ee',
          surfaceAlt: '#faf8f3',
          elevated: '#fffefa',
          overlay: 'rgba(101, 92, 75, 0.12)',
          input: '#fffefa',
        },
        foreground: {
          primary: '#2d332f',
          secondary: '#646b63',
          muted: '#969c92',
          disabled: '#aeb4aa',
          onAccent: '#fffefa',
        },
        border: {
          default: '#ddd6c9',
          subtle: '#eee9df',
          strong: '#5f8f86',
        },
        accent: {
          primary: '#5f8f86',
          primaryHover: '#527d75',
          primaryActive: '#466c65',
          primaryLight: '#e4eee9',
          primaryForeground: '#fffefa',
        },
        interactive: {
          hover: '#f0ebe2',
          active: '#e5ded1',
          selected: '#e4eee9',
          focus: '#5f8f86',
          focusRing: '#9eb8b1',
        },
      },
    },
  },
];

const THEME_STORAGE_KEY = 'shnctl-viewer-theme-v1';
const TOOLBAR_PIN_STORAGE_KEY = 'shnctl-toolbar-pinned-v1';
const TOOLBAR_FONT_SIZE = '10.5px';
const COMMENT_PANEL_WIDTH = '24vw';
const TOOLBAR_AUTO_HIDE_STYLE_ATTRIBUTE = 'data-shnctl-toolbar-auto-hide-style';
const VIEWER_THEME_ATTRIBUTE = 'data-viewer-theme';
const VIEWER_SCROLL_STRATEGY_ATTRIBUTE = 'data-shnctl-scroll-strategy';
const VIEWER_SCROLL_LOCK_ATTRIBUTE = 'data-shnctl-scroll-lock';
const TOOLBAR_AUTO_HIDE_CSS = `
[data-epdf] {
  --shnctl-native-ui-scale: 0.8;
  --shnctl-scrollbar-track: #f8fafc;
  --shnctl-scrollbar-thumb: #cbd5e1;
  --shnctl-scrollbar-thumb-hover: #94a3b8;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
  font-size: ${TOOLBAR_FONT_SIZE} !important;
  font-weight: 400 !important;
  scrollbar-color: var(--shnctl-scrollbar-thumb) var(--shnctl-scrollbar-track);
  scrollbar-width: thin;
}

[data-epdf][data-viewer-theme="dark"] {
  --shnctl-scrollbar-track: #161616;
  --shnctl-scrollbar-thumb: #525252;
  --shnctl-scrollbar-thumb-hover: #6f6f6f;
}

[data-epdf][data-viewer-theme="nord"] {
  --shnctl-scrollbar-track: #2e3440;
  --shnctl-scrollbar-thumb: #4c566a;
  --shnctl-scrollbar-thumb-hover: #5e81ac;
}

[data-epdf][data-viewer-theme="solar"] {
  --shnctl-scrollbar-track: #fbfaf6;
  --shnctl-scrollbar-thumb: #d1c8b8;
  --shnctl-scrollbar-thumb-hover: #a9a091;
}

[data-epdf] * {
  scrollbar-color: var(--shnctl-scrollbar-thumb) var(--shnctl-scrollbar-track);
  scrollbar-width: thin;
}

[data-epdf] :is(
  [data-epdf-i="main-toolbar"],
  [data-epdf-i="shnctl-page-toolbar"],
  [data-epdf-i="annotation-toolbar"],
  [data-epdf-i="shapes-toolbar"],
  [data-epdf-i="insert-toolbar"],
  [data-epdf-i="form-toolbar"],
  [data-epdf-i="redaction-toolbar"]
) {
  display: none !important;
}

[role="tooltip"] {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
  font-size: 10px !important;
  font-weight: 400 !important;
  line-height: 14px !important;
}

[data-sidebar-id="comment-panel"] {
  width: calc(${COMMENT_PANEL_WIDTH} / var(--shnctl-native-ui-scale)) !important;
  max-width: calc(100vw / var(--shnctl-native-ui-scale)) !important;
  height: calc(100% / var(--shnctl-native-ui-scale)) !important;
  transform: scale(var(--shnctl-native-ui-scale)) !important;
  transform-origin: top right !important;
}

.fixed.inset-0.z-50 > .bg-bg-surface {
  scale: var(--shnctl-native-ui-scale) !important;
  transform-origin: center !important;
}

[class*="bg-bg-elevated"][class*="shadow-lg"],
[class*="bg-bg-surface"][class*="shadow-2xl"],
[data-overlay-id],
[data-epdf-i="annotation"],
[data-epdf-i="groupAnnotation"],
[data-epdf-i="selection"],
[data-epdf-i="redaction"] {
  scale: var(--shnctl-native-ui-scale) !important;
  transform-origin: top left !important;
}

[data-epdf]::-webkit-scrollbar,
[data-epdf] ::-webkit-scrollbar {
  width: 8px !important;
  height: 8px !important;
}

[data-epdf]::-webkit-scrollbar-track,
[data-epdf] ::-webkit-scrollbar-track {
  background: var(--shnctl-scrollbar-track) !important;
}

[data-epdf]::-webkit-scrollbar-thumb,
[data-epdf] ::-webkit-scrollbar-thumb {
  border: 2px solid var(--shnctl-scrollbar-track) !important;
  border-radius: 999px !important;
  background-color: var(--shnctl-scrollbar-thumb) !important;
}

[data-epdf]::-webkit-scrollbar-thumb:hover,
[data-epdf] ::-webkit-scrollbar-thumb:hover {
  background-color: var(--shnctl-scrollbar-thumb-hover) !important;
}

[data-epdf][data-shnctl-scroll-strategy="vertical"]::-webkit-scrollbar:horizontal,
[data-epdf][data-shnctl-scroll-strategy="vertical"] ::-webkit-scrollbar:horizontal {
  height: 0 !important;
  display: none !important;
}

[data-epdf][data-shnctl-scroll-strategy="vertical"] #document-content [class~="overflow-auto"],
[data-epdf][data-shnctl-scroll-strategy="vertical"] #document-content [class~="overflow-x-auto"] {
  overflow-x: hidden !important;
}

[data-epdf][data-shnctl-scroll-strategy="horizontal"]::-webkit-scrollbar:vertical,
[data-epdf][data-shnctl-scroll-strategy="horizontal"] ::-webkit-scrollbar:vertical {
  width: 0 !important;
  display: none !important;
}

[data-epdf][data-shnctl-scroll-strategy="horizontal"] #document-content [class~="overflow-auto"],
[data-epdf][data-shnctl-scroll-strategy="horizontal"] #document-content [class~="overflow-y-auto"] {
  overflow-y: hidden !important;
}

[data-epdf][data-viewer-theme="dark"] :is(canvas, img) {
  filter: brightness(0.76) contrast(1.22) saturate(1);
}

[data-epdf][data-viewer-theme="nord"] :is(canvas, img) {
  filter: brightness(0.9);
}
`;

function getDomRoots(root: ParentNode = document) {
  const roots: ParentNode[] = [root];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

  while (walker.nextNode()) {
    const element = walker.currentNode as Element;
    if (element.shadowRoot) {
      roots.push(...getDomRoots(element.shadowRoot));
    }
  }

  return roots;
}

export function getStoredToolbarPinned() {
  try {
    return window.localStorage.getItem(TOOLBAR_PIN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setStoredToolbarPinned(pinned: boolean) {
  try {
    window.localStorage.setItem(TOOLBAR_PIN_STORAGE_KEY, pinned ? 'true' : 'false');
  } catch {
    // Pinning should still work for this session if storage is unavailable.
  }
}

function applyViewerThemeAttribute(root: ParentNode, themeId = document.documentElement.dataset.viewerTheme) {
  if (!themeId) {
    return;
  }

  for (const uiRoot of getEpUiRoots(root)) {
    uiRoot.setAttribute(VIEWER_THEME_ATTRIBUTE, themeId);
  }
}

function applyViewerScrollStrategyAttribute(root: ParentNode, strategy = document.documentElement.dataset.shnctlScrollStrategy) {
  if (strategy !== 'vertical' && strategy !== 'horizontal') {
    return;
  }

  for (const uiRoot of getEpUiRoots(root)) {
    uiRoot.setAttribute(VIEWER_SCROLL_STRATEGY_ATTRIBUTE, strategy);
  }

  applyViewerScrollStrategyStyles(root, strategy);
}

function getViewerScrollCandidates(root: ParentNode) {
  const candidates = new Set<HTMLElement>();
  for (const domRoot of getDomRoots(root)) {
    for (const lockedElement of Array.from(domRoot.querySelectorAll<HTMLElement>(`[${VIEWER_SCROLL_LOCK_ATTRIBUTE}]`))) {
      candidates.add(lockedElement);
    }

    for (const selector of [
      '[data-epdf] #document-content .bg-bg-app',
      '[data-epdf] #document-content [class~="overflow-auto"]',
      '[data-epdf] #document-content [class~="overflow-x-auto"]',
      '[data-epdf] #document-content [class~="overflow-y-auto"]',
    ]) {
      for (const element of Array.from(domRoot.querySelectorAll<HTMLElement>(selector))) {
        candidates.add(element);
      }
    }
  }

  return Array.from(candidates);
}

function applyViewerScrollStrategyStyles(root: ParentNode, strategy: 'vertical' | 'horizontal') {
  for (const element of getViewerScrollCandidates(root)) {
    element.style.removeProperty('overflow-x');
    element.style.removeProperty('overflow-y');
    element.removeAttribute(VIEWER_SCROLL_LOCK_ATTRIBUTE);

    const isScrollableX = element.scrollWidth > element.clientWidth + 1;
    const isScrollableY = element.scrollHeight > element.clientHeight + 1;
    const className = typeof element.className === 'string' ? element.className : '';
    const looksScrollable = /\boverflow-(auto|x-auto|y-auto)\b/.test(className) || className.includes('bg-bg-app');

    if (!looksScrollable && !isScrollableX && !isScrollableY) {
      continue;
    }

    element.setAttribute(VIEWER_SCROLL_LOCK_ATTRIBUTE, strategy);
    if (strategy === 'horizontal') {
      element.style.setProperty('overflow-y', 'hidden', 'important');
    } else {
      element.style.setProperty('overflow-x', 'hidden', 'important');
    }
  }
}

function ensureToolbarAutoHideStyle(root: ParentNode) {
  const styleRoot = root instanceof ShadowRoot ? root : document.head;
  if (!styleRoot || styleRoot.querySelector(`style[${TOOLBAR_AUTO_HIDE_STYLE_ATTRIBUTE}]`)) {
    return;
  }

  const style = document.createElement('style');
  style.setAttribute(TOOLBAR_AUTO_HIDE_STYLE_ATTRIBUTE, '');
  style.textContent = TOOLBAR_AUTO_HIDE_CSS;
  styleRoot.appendChild(style);
}

function getEpUiRoots(root: ParentNode = document) {
  const uiRoots = new Set<Element>();
  for (const domRoot of getDomRoots(root)) {
    for (const uiRoot of Array.from(domRoot.querySelectorAll('[data-epdf]'))) {
      uiRoots.add(uiRoot);
    }

    if (domRoot instanceof Element && domRoot.matches('[data-epdf]')) {
      uiRoots.add(domRoot);
    }
  }

  return uiRoots;
}

function installToolbarDomOverrides() {
  let scheduled = false;
  const scheduleApply = () => {
    if (scheduled) {
      return;
    }

    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      for (const root of getDomRoots()) {
        ensureToolbarAutoHideStyle(root);
        applyViewerThemeAttribute(root);
        applyViewerScrollStrategyAttribute(root);
      }
    });
  };

  const observer = new MutationObserver(scheduleApply);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  scheduleApply();
  return () => {
    observer.disconnect();
  };
}

export function getStoredThemeIndex() {
  let storedThemeId: string | null = null;

  try {
    storedThemeId = window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return 0;
  }

  const index = VIEWER_THEMES.findIndex((theme) => theme.id === storedThemeId);

  return index >= 0 ? index : 0;
}

function applyViewerTheme(container: PDFViewerRef['container'], themeIndex: number) {
  const theme = VIEWER_THEMES[themeIndex] ?? VIEWER_THEMES[0];

  container?.setTheme(theme.config);
  document.documentElement.dataset.viewerTheme = theme.id;
  applyViewerThemeAttribute(document, theme.id);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme.id);
  } catch {
    // Theme switching should still work if storage is unavailable.
  }
}

export function applyViewerThemeByIndex(container: PDFViewerRef['container'], themeIndex: number) {
  applyViewerTheme(container, themeIndex);
}

export function setViewerScrollStrategyAttribute(strategy: 'vertical' | 'horizontal') {
  document.documentElement.dataset.shnctlScrollStrategy = strategy;
  applyViewerScrollStrategyAttribute(document, strategy);
}

export function installThemeSwitcher(
  registry: PluginRegistry,
  container: PDFViewerRef['container'],
  themeIndexRef: MutableRefObject<number>,
  _onToggleThumbnails?: () => void,
  _isThumbnailsOpen?: () => boolean,
) {
  if (!container) {
    return EMPTY_CLEANUP;
  }

  const ui = registry.getPlugin('ui')?.provides?.();
  const cleanupToolbarDomOverrides = ui ? installToolbarDomOverrides() : EMPTY_CLEANUP;

  applyViewerTheme(container, themeIndexRef.current);
  return cleanupToolbarDomOverrides;
}
