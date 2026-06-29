import type { MutableRefObject } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import {
  type Command,
  type CommandsCapability,
  type PDFViewerRef,
  type ThemeConfig,
  type ToolbarItem,
  type UICapability,
} from '@embedpdf/react-pdf-viewer';
import { getActiveDocumentId, type ScrollCapability } from './utils';

type ViewerTheme = {
  id: string;
  name: string;
  icon: string;
  config: ThemeConfig;
};

const EMPTY_CLEANUP = () => {};
const COMMENT_PANEL_COMMAND_ID = 'panel:toggle-comment';
export const VIEWER_THEMES: ViewerTheme[] = [
  {
    id: 'light',
    name: 'Light',
    icon: 'shnctl-palette-1',
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
    icon: 'shnctl-palette-2',
    config: {
      preference: 'dark',
      dark: {
        accent: {
          primary: '#60a5fa',
          primaryHover: '#3b82f6',
          primaryActive: '#2563eb',
          primaryLight: '#1e3a8a',
          primaryForeground: '#0f172a',
        },
      },
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    icon: 'shnctl-palette-3',
    config: {
      preference: 'dark',
      dark: {
        background: {
          app: '#2e3440',
          surface: '#3b4252',
          surfaceAlt: '#353c4a',
          elevated: '#434c5e',
          overlay: 'rgba(46, 52, 64, 0.68)',
          input: '#2e3440',
        },
        foreground: {
          primary: '#eceff4',
          secondary: '#d8dee9',
          muted: '#a7b1c2',
          disabled: '#6f7888',
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
          primaryLight: '#3b5360',
          primaryForeground: '#2e3440',
        },
        interactive: {
          hover: '#434c5e',
          active: '#4c566a',
          selected: '#3b5360',
          focus: '#88c0d0',
          focusRing: '#5e81ac',
        },
      },
    },
  },
  {
    id: 'solar',
    name: 'Solar',
    icon: 'shnctl-palette-4',
    config: {
      preference: 'light',
      light: {
        background: {
          app: '#f8f5ec',
          surface: '#f1ede3',
          surfaceAlt: '#f5f1e8',
          elevated: '#fffdf7',
          overlay: 'rgba(101, 92, 75, 0.16)',
          input: '#fbf8f0',
        },
        foreground: {
          primary: '#2d332f',
          secondary: '#5f675f',
          muted: '#8b9288',
          disabled: '#a9aea4',
          onAccent: '#fbf8f0',
        },
        border: {
          default: '#d8d0bf',
          subtle: '#e5dfd2',
          strong: '#5f8f86',
        },
        accent: {
          primary: '#5f8f86',
          primaryHover: '#527d75',
          primaryActive: '#466c65',
          primaryLight: '#dbe8e3',
          primaryForeground: '#fbf8f0',
        },
        interactive: {
          hover: '#e9e2d4',
          active: '#ddd5c6',
          selected: '#dbe8e3',
          focus: '#5f8f86',
          focusRing: '#9eb8b1',
        },
      },
    },
  },
];

const THEME_COMMAND_ID = 'shnctl.theme.cycle';
const THEME_BUTTON_ID = 'shnctl-theme-cycle-button';
const THEME_STORAGE_KEY = 'shnctl-viewer-theme-v1';
const TOOLBAR_PIN_COMMAND_ID = 'shnctl.toolbar.pin';
const TOOLBAR_PIN_BUTTON_ID = 'shnctl-toolbar-pin-button';
const TOOLBAR_PIN_STORAGE_KEY = 'shnctl-toolbar-pinned-v1';
const PAGE_MODE_COMMAND_ID = 'shnctl.mode.page';
const SINGLE_PAGE_COMMAND_ID = 'shnctl.view.single-page';
const TWO_PAGE_ODD_COMMAND_ID = 'shnctl.view.two-page-odd';
const VERTICAL_SCROLL_COMMAND_ID = 'shnctl.view.vertical-scroll';
const HORIZONTAL_SCROLL_COMMAND_ID = 'shnctl.view.horizontal-scroll';
const ROTATE_COMMAND_ID = 'shnctl.view.rotate';
const PAN_COMMAND_ID = 'shnctl.tool.pan';
const PAN_BUTTON_ID = 'shnctl-pan-button';
const PAGE_TOOLBAR_ID = 'shnctl-page-toolbar';
const PAGE_MODE_TAB_ID = 'shnctl-page-mode';
const VIEW_CONTROL_BUTTON_IDS = new Set([
  'shnctl-single-page-button',
  'shnctl-two-page-odd-button',
  'shnctl-vertical-scroll-button',
  'shnctl-horizontal-scroll-button',
  'shnctl-rotate-button',
]);
const PAGE_SETTINGS_BUTTON_ID = 'page-settings-button';
const MAIN_ZOOM_ITEM_IDS = new Set(['zoom-menu-button', 'zoom-toolbar', 'divider-3']);
const MAIN_TOOL_ITEM_IDS = new Set(['pan-button', 'pointer-button', 'divider-2']);
const TOOLBAR_LABEL_OVERRIDES = [
  { itemId: 'view-mode', label: 'VIEW' },
  { itemId: PAGE_MODE_TAB_ID, label: 'PAGE' },
  { itemId: 'shnctl-search-mode', label: 'SEARCH' },
  { itemId: 'annotate-mode', label: 'MARKUP' },
  { itemId: 'shapes-mode', label: 'DRAW' },
];
const TOOLBAR_UI_FONT_FAMILY = '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
const TOOLBAR_AUTO_HIDE_STYLE_ATTRIBUTE = 'data-shnctl-toolbar-auto-hide-style';
const TOOLBAR_PINNED_ATTRIBUTE = 'data-shnctl-toolbar-pinned';
const TOOLBAR_VISIBLE_ATTRIBUTE = 'data-shnctl-toolbar-visible';
const SEARCH_OPEN_ATTRIBUTE = 'data-shnctl-search-open';
const TOOLBAR_VISIBILITY_SELECTOR = [
  '[data-epdf-i="main-toolbar"]',
  '[data-epdf-i="shnctl-page-toolbar"]',
  '[data-epdf-i="annotation-toolbar"]',
  '[data-epdf-i="shapes-toolbar"]',
  '[data-epdf-i="insert-toolbar"]',
  '[data-epdf-i="form-toolbar"]',
  '[data-epdf-i="redaction-toolbar"]',
  '.shnctl-search-bar',
].join(', ');
const SECONDARY_TOOLBAR_CLOSE_TAB_IDS = new Set([
  'view-mode',
]);
const toolbarVisibilityElements = new WeakSet<Element>();
const secondaryToolbarCloseElements = new WeakSet<Element>();
let toolbarVisibilityHideTimer: number | undefined;
const TOOLBAR_AUTO_HIDE_CSS = `
[data-epdf] :is(
  [data-epdf-i="main-toolbar"],
  [data-epdf-i="shnctl-page-toolbar"],
  [data-epdf-i="annotation-toolbar"],
  [data-epdf-i="shapes-toolbar"],
  [data-epdf-i="insert-toolbar"],
  [data-epdf-i="form-toolbar"],
  [data-epdf-i="redaction-toolbar"]
) [data-epdf-i] > button {
  min-width: 32px !important;
  height: 32px !important;
  min-height: 32px !important;
  padding-inline: 6px !important;
  font-size: 13px !important;
}

[data-epdf] :is(
  [data-epdf-i="main-toolbar"],
  [data-epdf-i="shnctl-page-toolbar"],
  [data-epdf-i="annotation-toolbar"],
  [data-epdf-i="shapes-toolbar"],
  [data-epdf-i="insert-toolbar"],
  [data-epdf-i="form-toolbar"],
  [data-epdf-i="redaction-toolbar"]
) svg {
  width: 18px !important;
  height: 18px !important;
}

[data-epdf] :is(
  [data-epdf-i="shnctl-page-toolbar"],
  [data-epdf-i="annotation-toolbar"],
  [data-epdf-i="shapes-toolbar"],
  [data-epdf-i="insert-toolbar"],
  [data-epdf-i="form-toolbar"],
  [data-epdf-i="redaction-toolbar"]
) {
  min-height: 38px !important;
  height: 38px !important;
  padding-top: 3px !important;
  padding-bottom: 3px !important;
  box-sizing: border-box !important;
}

[data-epdf][data-shnctl-search-open="true"] [data-epdf-i="mode-tabs"] :is(
  [data-epdf-i="view-mode"],
  [data-epdf-i="shnctl-page-mode"],
  [data-epdf-i="annotate-mode"],
  [data-epdf-i="shapes-mode"],
  [data-epdf-i="insert-mode"],
  [data-epdf-i="form-mode"],
  [data-epdf-i="redact-mode"]
) button {
  border-bottom-color: transparent !important;
  color: var(--color-fg-primary, var(--ep-foreground-primary)) !important;
}

[data-epdf][data-shnctl-search-open="true"] [data-epdf-i="shnctl-search-mode"] button {
  border-bottom-color: var(--color-accent, var(--ep-accent-primary)) !important;
  color: var(--color-accent, var(--ep-accent-primary)) !important;
}

[data-epdf][data-shnctl-search-open="true"] :is(
  [data-epdf-i="shnctl-page-toolbar"],
  [data-epdf-i="annotation-toolbar"],
  [data-epdf-i="shapes-toolbar"],
  [data-epdf-i="insert-toolbar"],
  [data-epdf-i="form-toolbar"],
  [data-epdf-i="redaction-toolbar"]
) {
  visibility: hidden !important;
  pointer-events: none !important;
}

[data-epdf]:not([data-shnctl-toolbar-pinned="true"]) [data-epdf-i="main-toolbar"] {
  --shnctl-main-toolbar-hidden-offset: 38px;
  position: fixed !important;
  top: 0 !important;
  right: 0 !important;
  left: 0 !important;
  z-index: 30 !important;
  transform: translateY(calc(-1 * var(--shnctl-main-toolbar-hidden-offset))) !important;
  opacity: 0.08 !important;
  transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease-out !important;
  will-change: transform, opacity;
}

[data-epdf]:not([data-shnctl-toolbar-pinned="true"]) [data-epdf-i="main-toolbar"]::after {
  position: absolute;
  right: 0;
  bottom: -14px;
  left: 0;
  height: 14px;
  content: "";
}

[data-epdf]:not([data-shnctl-toolbar-pinned="true"]) :is(
  [data-epdf-i="shnctl-page-toolbar"],
  [data-epdf-i="annotation-toolbar"],
  [data-epdf-i="shapes-toolbar"],
  [data-epdf-i="insert-toolbar"],
  [data-epdf-i="form-toolbar"],
  [data-epdf-i="redaction-toolbar"]
) {
  --shnctl-main-toolbar-hidden-offset: 38px;
  --shnctl-secondary-toolbar-top-offset: 48px;
  --shnctl-page-toolbar-hidden-offset: 38px;
  position: fixed !important;
  top: var(--shnctl-secondary-toolbar-top-offset) !important;
  right: 0 !important;
  left: 0 !important;
  z-index: 29 !important;
  transform: translateY(calc(-1 * (var(--shnctl-secondary-toolbar-top-offset) + var(--shnctl-page-toolbar-hidden-offset)))) !important;
  opacity: 0 !important;
  transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease-out !important;
  will-change: transform, opacity;
}

[data-epdf]:not([data-shnctl-toolbar-pinned="true"]):has(:is(
  [data-epdf-i="main-toolbar"],
  [data-epdf-i="shnctl-page-toolbar"],
  [data-epdf-i="annotation-toolbar"],
  [data-epdf-i="shapes-toolbar"],
  [data-epdf-i="insert-toolbar"],
  [data-epdf-i="form-toolbar"],
  [data-epdf-i="redaction-toolbar"]
):is(:hover, :focus-within)) [data-epdf-i="main-toolbar"] {
  transform: translateY(0) !important;
  opacity: 1 !important;
}

[data-epdf]:not([data-shnctl-toolbar-pinned="true"]):has(:is(
  [data-epdf-i="main-toolbar"],
  [data-epdf-i="shnctl-page-toolbar"],
  [data-epdf-i="annotation-toolbar"],
  [data-epdf-i="shapes-toolbar"],
  [data-epdf-i="insert-toolbar"],
  [data-epdf-i="form-toolbar"],
  [data-epdf-i="redaction-toolbar"]
):is(:hover, :focus-within)) :is(
  [data-epdf-i="shnctl-page-toolbar"],
  [data-epdf-i="annotation-toolbar"],
  [data-epdf-i="shapes-toolbar"],
  [data-epdf-i="insert-toolbar"],
  [data-epdf-i="form-toolbar"],
  [data-epdf-i="redaction-toolbar"]
) {
  transform: translateY(0) !important;
  opacity: 1 !important;
}

[data-epdf]:not([data-shnctl-toolbar-pinned="true"])[data-shnctl-toolbar-visible="true"] [data-epdf-i="main-toolbar"] {
  transform: translateY(0) !important;
  opacity: 1 !important;
}

[data-epdf]:not([data-shnctl-toolbar-pinned="true"])[data-shnctl-toolbar-visible="true"] :is(
  [data-epdf-i="shnctl-page-toolbar"],
  [data-epdf-i="annotation-toolbar"],
  [data-epdf-i="shapes-toolbar"],
  [data-epdf-i="insert-toolbar"],
  [data-epdf-i="form-toolbar"],
  [data-epdf-i="redaction-toolbar"]
) {
  transform: translateY(0) !important;
  opacity: 1 !important;
}

html[data-shnctl-toolbar-pinned="true"] .shnctl-search-bar {
  transform: none !important;
  opacity: 1 !important;
  transition: none !important;
  will-change: auto;
}

.shnctl-search-bar {
  --shnctl-secondary-toolbar-top-offset: 48px;
  --shnctl-page-toolbar-hidden-offset: 38px;
  transform: translateY(calc(-1 * (var(--shnctl-secondary-toolbar-top-offset) + var(--shnctl-page-toolbar-hidden-offset)))) !important;
  opacity: 0 !important;
  transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease-out !important;
  will-change: transform, opacity;
}

html[data-shnctl-toolbar-visible="true"] .shnctl-search-bar {
  transform: translateY(0) !important;
  opacity: 1 !important;
}
`;

type SpreadModeValue = 'none' | 'odd' | 'even';
type ScrollStrategyValue = 'vertical' | 'horizontal';

interface SpreadCapability {
  setSpreadMode(mode: SpreadModeValue): void;
  getSpreadMode(): SpreadModeValue;
}

interface RotateCapability {
  rotateForward(): void;
}

interface PanCapability {
  forDocument(documentId: string): {
    enablePan(): void;
    disablePan(): void;
    isPanMode(): boolean;
  };
}

interface UiPluginState {
  plugins?: {
    ui?: {
      documents?: Record<
        string,
        {
          activeToolbars?: Record<string, { toolbarId?: string; isOpen?: boolean }>;
        }
      >;
    };
    scroll?: {
      documents?: Record<
        string,
        {
          strategy?: ScrollStrategyValue;
        }
      >;
    };
  };
}

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

function getStoredToolbarPinned() {
  try {
    return window.localStorage.getItem(TOOLBAR_PIN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function setStoredToolbarPinned(pinned: boolean) {
  try {
    window.localStorage.setItem(TOOLBAR_PIN_STORAGE_KEY, pinned ? 'true' : 'false');
  } catch {
    // Pinning should still work for this session if storage is unavailable.
  }
}

function applyToolbarPinnedState(root: ParentNode, pinned = getStoredToolbarPinned()) {
  const uiRoots = Array.from(root.querySelectorAll('[data-epdf]'));

  if (root instanceof Element && root.matches('[data-epdf]')) {
    uiRoots.unshift(root);
  }

  for (const uiRoot of uiRoots) {
    if (pinned) {
      uiRoot.setAttribute(TOOLBAR_PINNED_ATTRIBUTE, 'true');
    } else {
      uiRoot.removeAttribute(TOOLBAR_PINNED_ATTRIBUTE);
    }
  }

  if (pinned) {
    document.documentElement.setAttribute(TOOLBAR_PINNED_ATTRIBUTE, 'true');
  } else {
    document.documentElement.removeAttribute(TOOLBAR_PINNED_ATTRIBUTE);
  }
}

function applyToolbarPinnedStateToAllRoots(pinned = getStoredToolbarPinned()) {
  for (const root of getDomRoots()) {
    applyToolbarPinnedState(root, pinned);
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

function getEpUiRoots() {
  const uiRoots = new Set<Element>();
  for (const root of getDomRoots()) {
    for (const uiRoot of Array.from(root.querySelectorAll('[data-epdf]'))) {
      uiRoots.add(uiRoot);
    }

    if (root instanceof Element && root.matches('[data-epdf]')) {
      uiRoots.add(root);
    }
  }

  return uiRoots;
}

function setToolbarVisible(visible: boolean) {
  if (toolbarVisibilityHideTimer !== undefined) {
    window.clearTimeout(toolbarVisibilityHideTimer);
    toolbarVisibilityHideTimer = undefined;
  }

  const uiRoots = getEpUiRoots();

  if (visible) {
    document.documentElement.setAttribute(TOOLBAR_VISIBLE_ATTRIBUTE, 'true');
    for (const uiRoot of uiRoots) {
      uiRoot.setAttribute(TOOLBAR_VISIBLE_ATTRIBUTE, 'true');
    }
  } else {
    document.documentElement.removeAttribute(TOOLBAR_VISIBLE_ATTRIBUTE);
    for (const uiRoot of uiRoots) {
      uiRoot.removeAttribute(TOOLBAR_VISIBLE_ATTRIBUTE);
    }
  }
}

export function setSearchOpenAttribute(open: boolean) {
  const uiRoots = getEpUiRoots();

  if (open) {
    document.documentElement.setAttribute(SEARCH_OPEN_ATTRIBUTE, 'true');
    for (const uiRoot of uiRoots) {
      uiRoot.setAttribute(SEARCH_OPEN_ATTRIBUTE, 'true');
    }
  } else {
    document.documentElement.removeAttribute(SEARCH_OPEN_ATTRIBUTE);
    for (const uiRoot of uiRoots) {
      uiRoot.removeAttribute(SEARCH_OPEN_ATTRIBUTE);
    }
  }
}

function isToolbarPinned() {
  return document.documentElement.hasAttribute(TOOLBAR_PINNED_ATTRIBUTE);
}

function isAnyToolbarVisibleTargetActive() {
  for (const root of getDomRoots()) {
    const targets = Array.from(root.querySelectorAll(TOOLBAR_VISIBILITY_SELECTOR));
    if (root instanceof Element && root.matches(TOOLBAR_VISIBILITY_SELECTOR)) {
      targets.unshift(root);
    }

    if (targets.some((target) => target.matches(':hover, :focus-within'))) {
      return true;
    }
  }

  return false;
}

function scheduleToolbarHidden() {
  if (toolbarVisibilityHideTimer !== undefined) {
    window.clearTimeout(toolbarVisibilityHideTimer);
  }

  toolbarVisibilityHideTimer = window.setTimeout(() => {
    toolbarVisibilityHideTimer = undefined;
    setToolbarVisible(isAnyToolbarVisibleTargetActive());
  }, 120);
}

function ensureToolbarVisibilityListeners(root: ParentNode) {
  const targets = Array.from(root.querySelectorAll(TOOLBAR_VISIBILITY_SELECTOR));
  if (root instanceof Element && root.matches(TOOLBAR_VISIBILITY_SELECTOR)) {
    targets.unshift(root);
  }

  for (const target of targets) {
    if (toolbarVisibilityElements.has(target)) {
      continue;
    }

    toolbarVisibilityElements.add(target);
    target.addEventListener('mouseenter', () => setToolbarVisible(true));
    target.addEventListener('focusin', () => setToolbarVisible(true));
    target.addEventListener('mouseleave', () => {
      if (!isToolbarPinned()) {
        scheduleToolbarHidden();
      }
    });
    target.addEventListener('focusout', () => {
      if (!isToolbarPinned()) {
        scheduleToolbarHidden();
      }
    });
  }
}

function ensureSecondaryToolbarCloseListeners(root: ParentNode, registry: PluginRegistry, ui: UICapability) {
  for (const itemId of SECONDARY_TOOLBAR_CLOSE_TAB_IDS) {
    const element = root.querySelector(`[data-epdf-i="${itemId}"] > button`);
    if (!(element instanceof HTMLButtonElement) || secondaryToolbarCloseElements.has(element)) {
      continue;
    }

    secondaryToolbarCloseElements.add(element);
    element.addEventListener('click', () => {
      const documentId = getActiveDocumentId(registry);
      if (!documentId) {
        return;
      }

      ui.forDocument(documentId).closeToolbarSlot('top', 'secondary');
    });
  }
}

function applyToolbarDomOverrides(registry: PluginRegistry, ui: UICapability) {
  for (const root of getDomRoots()) {
    ensureToolbarAutoHideStyle(root);
    ensureToolbarVisibilityListeners(root);
    ensureSecondaryToolbarCloseListeners(root, registry, ui);
    applyToolbarPinnedState(root);

    for (const { itemId, label } of TOOLBAR_LABEL_OVERRIDES) {
      const button = root.querySelector(`[data-epdf-i="${itemId}"] > button`);
      if (!(button instanceof HTMLButtonElement)) {
        continue;
      }

      if (button.textContent !== label) {
        button.textContent = label;
      }

      button.style.setProperty('font-family', TOOLBAR_UI_FONT_FAMILY, 'important');
      button.style.setProperty('font-size', '13px', 'important');
      button.style.setProperty('font-weight', '700', 'important');
      button.style.setProperty('line-height', '18px', 'important');
      button.style.setProperty('letter-spacing', '0.02em', 'important');
      button.style.setProperty('text-transform', 'uppercase', 'important');
      button.style.setProperty('-webkit-font-smoothing', 'antialiased');
    }
  }
}

function installToolbarDomOverrides(registry: PluginRegistry, ui: UICapability) {
  let scheduled = false;
  const scheduleApply = () => {
    if (scheduled) {
      return;
    }

    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      applyToolbarDomOverrides(registry, ui);
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
    if (toolbarVisibilityHideTimer !== undefined) {
      window.clearTimeout(toolbarVisibilityHideTimer);
      toolbarVisibilityHideTimer = undefined;
    }
    setToolbarVisible(false);
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


function getThemeAccentColor(theme: ViewerTheme) {
  const colorScheme = theme.config.preference === 'dark' ? 'dark' : 'light';
  const colors = colorScheme === 'dark' ? theme.config.dark : theme.config.light;

  return colors?.accent?.primary ?? '#2563eb';
}

function applyViewerTheme(container: PDFViewerRef['container'], themeIndex: number) {
  const theme = VIEWER_THEMES[themeIndex] ?? VIEWER_THEMES[0];

  container?.setTheme(theme.config);
  document.documentElement.dataset.viewerTheme = theme.id;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme.id);
  } catch {
    // Theme switching should still work if storage is unavailable.
  }
}

function registerThemeIcons(container: PDFViewerRef['container']) {
  if (!container) {
    return;
  }

  const createPaletteIcon = () => ({
    viewBox: '0 0 24 24',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 2,
    paths: [
      { d: 'M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z', stroke: 'primary', fill: 'none' },
      { d: 'M13.5 7a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1', stroke: 'primary', fill: 'primary' },
      { d: 'M17.5 11a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1', stroke: 'primary', fill: 'primary' },
      { d: 'M6.5 13a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1', stroke: 'primary', fill: 'primary' },
      { d: 'M8.5 8a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1', stroke: 'primary', fill: 'primary' },
    ],
  });

  container.registerIcons({
    'shnctl-palette-1': createPaletteIcon(),
    'shnctl-palette-2': createPaletteIcon(),
    'shnctl-palette-3': createPaletteIcon(),
    'shnctl-palette-4': createPaletteIcon(),
    'shnctl-search': {
      viewBox: '0 0 24 24',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: 2,
      paths: [
        { d: 'm21 21-4.34-4.34', stroke: 'primary', fill: 'none' },
        { d: 'M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0', stroke: 'primary', fill: 'none' },
      ],
    },
    'shnctl-single-page': {
      viewBox: '0 0 24 24',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: 1.8,
      paths: [
        { d: 'M5 8V5c0-1 1-2 2-2h10c1 0 2 1 2 2v3', stroke: 'primary', fill: 'none' },
        { d: 'M19 16v3c0 1-1 2-2 2H7c-1 0-2-1-2-2v-3', stroke: 'primary', fill: 'none' },
        { d: 'M4 12h16', stroke: 'primary', fill: 'none' },
      ],
    },
    'shnctl-two-page-odd': {
      viewBox: '0 0 24 24',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: 1.8,
      paths: [
        { d: 'M8 19H5c-1 0-2-1-2-2V7c0-1 1-2 2-2h3', stroke: 'primary', fill: 'none' },
        { d: 'M16 5h3c1 0 2 1 2 2v10c0 1-1 2-2 2h-3', stroke: 'primary', fill: 'none' },
        { d: 'M12 4v16', stroke: 'primary', fill: 'none' },
      ],
    },
    'shnctl-scroll-vertical': {
      viewBox: '0 0 24 24',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: 2,
      paths: [
        { d: 'M12 22v-6', stroke: 'primary', fill: 'none' },
        { d: 'M12 8V2', stroke: 'primary', fill: 'none' },
        { d: 'M4 12H2', stroke: 'primary', fill: 'none' },
        { d: 'M10 12H8', stroke: 'primary', fill: 'none' },
        { d: 'M16 12h-2', stroke: 'primary', fill: 'none' },
        { d: 'M22 12h-2', stroke: 'primary', fill: 'none' },
        { d: 'm15 19-3 3-3-3', stroke: 'primary', fill: 'none' },
        { d: 'm15 5-3-3-3 3', stroke: 'primary', fill: 'none' },
      ],
    },
    'shnctl-scroll-horizontal': {
      viewBox: '0 0 24 24',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: 2,
      paths: [
        { d: 'M16 12h6', stroke: 'primary', fill: 'none' },
        { d: 'M8 12H2', stroke: 'primary', fill: 'none' },
        { d: 'M12 2v2', stroke: 'primary', fill: 'none' },
        { d: 'M12 8v2', stroke: 'primary', fill: 'none' },
        { d: 'M12 14v2', stroke: 'primary', fill: 'none' },
        { d: 'M12 20v2', stroke: 'primary', fill: 'none' },
        { d: 'm19 15 3-3-3-3', stroke: 'primary', fill: 'none' },
        { d: 'm5 9-3 3 3 3', stroke: 'primary', fill: 'none' },
      ],
    },
    'shnctl-rotate': {
      viewBox: '0 0 24 24',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: 2,
      paths: [
        { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', stroke: 'primary', fill: 'none' },
        { d: 'M3 3v5h5', stroke: 'primary', fill: 'none' },
      ],
    },
    'shnctl-page-menu': {
      viewBox: '0 0 24 24',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: 1.8,
      paths: [
        { d: 'M6.5 3.5h8.2L19 7.8v10.7a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z', stroke: 'primary', fill: 'none' },
        { d: 'M14.5 3.8v4.4h4.2M8 11.5h8M8 15h5.5', stroke: 'primary', fill: 'none' },
      ],
    },
    'shnctl-toolbar-pin': {
      viewBox: '0 0 24 24',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: 2,
      paths: [
        { d: 'M12 17v5', stroke: 'primary', fill: 'none' },
        { d: 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z', stroke: 'primary', fill: 'none' },
      ],
    },
    'shnctl-hand': {
      viewBox: '0 0 24 24',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: 2,
      paths: [
        { d: 'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2', stroke: 'primary', fill: 'none' },
        { d: 'M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2', stroke: 'primary', fill: 'none' },
        { d: 'M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8', stroke: 'primary', fill: 'none' },
        { d: 'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15', stroke: 'primary', fill: 'none' },
      ],
    },
  });
}

function refreshMainToolbar(registry: PluginRegistry, ui: UICapability) {
  const documentId = getActiveDocumentId(registry);

  if (documentId) {
    ui.forDocument(documentId).setActiveToolbar('top', 'main', 'main-toolbar');
  }
}

function switchScrollStrategyPreservingPage(
  registry: PluginRegistry,
  ui: UICapability,
  scroll: ScrollCapability | undefined,
  strategy: ScrollStrategyValue,
) {
  const documentId = getActiveDocumentId(registry);

  if (!scroll || !documentId) {
    return;
  }

  const scrollScope = scroll.forDocument(documentId);
  const pageNumber = scrollScope.getCurrentPage();

  scroll.setScrollStrategy(strategy, documentId);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollScope.scrollToPage({
        pageNumber,
        behavior: 'instant',
      });
      refreshMainToolbar(registry, ui);
    });
  });
}

function removeToolbarItemByCommandId(items: ToolbarItem[], commandId: string): ToolbarItem[] {
  return items.reduce<ToolbarItem[]>((nextItems, item) => {
    if (item.type === 'command-button' && item.commandId === commandId) {
      return nextItems;
    }

    if (item.type === 'group') {
      nextItems.push({
        ...item,
        items: removeToolbarItemByCommandId(item.items as ToolbarItem[], commandId),
      });
      return nextItems;
    }

    nextItems.push(item);
    return nextItems;
  }, []);
}

function removeToolbarItemsById(items: ToolbarItem[], ids: Set<string>): ToolbarItem[] {
  return items.reduce<ToolbarItem[]>((nextItems, item) => {
    if (ids.has(item.id)) {
      return nextItems;
    }

    if (item.type === 'group') {
      nextItems.push({
        ...item,
        items: removeToolbarItemsById(item.items as ToolbarItem[], ids),
      });
      return nextItems;
    }

    nextItems.push(item);
    return nextItems;
  }, []);
}

function isPanToolbarItem(item: ToolbarItem) {
  const itemLike = item as ToolbarItem & {
    commandId?: string;
    componentId?: string;
  };

  return [itemLike.id, itemLike.commandId, itemLike.componentId].some((value) => value?.toLowerCase().includes('pan'));
}

function removeDividerBeforePanTool(items: ToolbarItem[]): ToolbarItem[] {
  return items.reduce<ToolbarItem[]>((nextItems, item) => {
    const nextItem =
      item.type === 'group'
        ? {
            ...item,
            items: removeDividerBeforePanTool(item.items as ToolbarItem[]),
          }
        : item;

    if (isPanToolbarItem(nextItem) && nextItems.at(-1)?.type === 'divider') {
      nextItems.pop();
    }

    nextItems.push(nextItem);
    return nextItems;
  }, []);
}

function appendUnique(items: string[] | undefined, item: string) {
  return items?.includes(item) ? items : [...(items ?? []), item];
}

function prependUnique(items: string[] | undefined, item: string) {
  return items?.includes(item) ? items : [item, ...(items ?? [])];
}

function addPageModeToResponsiveSchema(toolbar: { responsive?: any; items: ToolbarItem[] }, schema: ReturnType<UICapability['getSchema']>) {
  const breakpoints = toolbar.responsive?.breakpoints;

  if (breakpoints?.xxxs) {
    breakpoints.xxxs.hide = appendUnique(breakpoints.xxxs.hide, PAGE_MODE_TAB_ID);
  }

  if (breakpoints?.sm) {
    breakpoints.sm.show = appendUnique(breakpoints.sm.show, PAGE_MODE_TAB_ID);
  }

  if (breakpoints?.md) {
    breakpoints.md.show = appendUnique(breakpoints.md.show, PAGE_MODE_TAB_ID);
  }

  const modeSelect = toolbar.items.find((item) => item.id === 'mode-select-button');
  if (modeSelect) {
    modeSelect.visibilityDependsOn = {
      ...modeSelect.visibilityDependsOn,
      itemIds: appendUnique(modeSelect.visibilityDependsOn?.itemIds, PAGE_MODE_COMMAND_ID),
    };
  }

  const overflowMenu = schema.menus['mode-tabs-overflow-menu'];
  if (!overflowMenu.items.some((item) => item.id === PAGE_MODE_COMMAND_ID)) {
    overflowMenu.items.splice(1, 0, {
      type: 'command',
      id: PAGE_MODE_COMMAND_ID,
      commandId: PAGE_MODE_COMMAND_ID,
      categories: ['mode', 'page'],
    });
  }

  const overflowBreakpoints = overflowMenu.responsive?.breakpoints;
  if (overflowBreakpoints?.xs) {
    overflowBreakpoints.xs.show = appendUnique(overflowBreakpoints.xs.show, PAGE_MODE_COMMAND_ID);
  }
  if (overflowBreakpoints?.sm) {
    overflowBreakpoints.sm.hide = prependUnique(overflowBreakpoints.sm.hide, PAGE_MODE_COMMAND_ID);
  }
  if (overflowBreakpoints?.md) {
    overflowBreakpoints.md.hide = prependUnique(overflowBreakpoints.md.hide, PAGE_MODE_COMMAND_ID);
  }
}

export function installThemeSwitcher(
  registry: PluginRegistry,
  container: PDFViewerRef['container'],
  themeIndexRef: MutableRefObject<number>,
) {
  if (!container) {
    return EMPTY_CLEANUP;
  }

  const commands = registry.getPlugin('commands')?.provides?.() as CommandsCapability | undefined;
  const ui = registry.getPlugin('ui')?.provides?.() as UICapability | undefined;

  if (!commands || !ui) {
    return EMPTY_CLEANUP;
  }

  const cleanupToolbarDomOverrides = installToolbarDomOverrides(registry, ui);

  registerThemeIcons(container);
  applyViewerTheme(container, themeIndexRef.current);
  const spread = registry.getPlugin('spread')?.provides?.() as SpreadCapability | undefined;
  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  const rotate = registry.getPlugin('rotate')?.provides?.() as RotateCapability | undefined;
  const pan = registry.getPlugin('pan')?.provides?.() as PanCapability | undefined;
  const registeredCommandIds = [
    THEME_COMMAND_ID,
    TOOLBAR_PIN_COMMAND_ID,
    PAN_COMMAND_ID,
    PAGE_MODE_COMMAND_ID,
    SINGLE_PAGE_COMMAND_ID,
    TWO_PAGE_ODD_COMMAND_ID,
    VERTICAL_SCROLL_COMMAND_ID,
    HORIZONTAL_SCROLL_COMMAND_ID,
    ROTATE_COMMAND_ID,
  ];

  const themeCommand: Command = {
    id: THEME_COMMAND_ID,
    label: 'Switch theme',
    icon: () => (VIEWER_THEMES[themeIndexRef.current] ?? VIEWER_THEMES[0]).icon,
    iconProps: () => ({
      secondaryColor: getThemeAccentColor(VIEWER_THEMES[themeIndexRef.current] ?? VIEWER_THEMES[0]),
    }),
    action: () => {
      themeIndexRef.current = (themeIndexRef.current + 1) % VIEWER_THEMES.length;
      applyViewerTheme(container, themeIndexRef.current);
      refreshMainToolbar(registry, ui);
    },
    categories: ['document'],
  };
  applyToolbarPinnedStateToAllRoots();
  const toolbarPinCommand: Command = {
    id: TOOLBAR_PIN_COMMAND_ID,
    label: 'Pin toolbar',
    icon: 'shnctl-toolbar-pin',
    action: () => {
      const pinned = !getStoredToolbarPinned();
      setStoredToolbarPinned(pinned);
      applyToolbarPinnedStateToAllRoots(pinned);
      refreshMainToolbar(registry, ui);
    },
    active: () => getStoredToolbarPinned(),
    categories: ['document'],
  };
  const panCommand: Command = {
    id: PAN_COMMAND_ID,
    label: 'Toggle Pan Mode',
    icon: 'shnctl-hand',
    action: ({ documentId }) => {
      const activeDocumentId = documentId ?? getActiveDocumentId(registry);

      if (!pan || !activeDocumentId) {
        return;
      }

      const panScope = pan.forDocument(activeDocumentId);
      if (panScope.isPanMode()) {
        panScope.disablePan();
      } else {
        panScope.enablePan();
      }
      refreshMainToolbar(registry, ui);
    },
    active: ({ documentId }) => {
      const activeDocumentId = documentId ?? getActiveDocumentId(registry);
      return Boolean(pan && activeDocumentId && pan.forDocument(activeDocumentId).isPanMode());
    },
    disabled: () => !pan,
    categories: ['tools', 'pan'],
  };
  const pageModeCommand: Command = {
    id: PAGE_MODE_COMMAND_ID,
    label: 'PAGE',
    action: ({ documentId }) => {
      ui.forDocument(documentId).setActiveToolbar('top', 'secondary', PAGE_TOOLBAR_ID);
    },
    active: ({ state, documentId }) => {
      const activeToolbars = (state as UiPluginState).plugins?.ui?.documents?.[documentId]?.activeToolbars;
      const secondaryToolbar = activeToolbars?.['top-secondary'];
      return secondaryToolbar?.toolbarId === PAGE_TOOLBAR_ID && secondaryToolbar.isOpen === true;
    },
    categories: ['mode', 'page'],
  };
  const viewCommands: Command[] = [
    {
      id: SINGLE_PAGE_COMMAND_ID,
      label: 'Single Page',
      icon: 'shnctl-single-page',
      action: () => {
        spread?.setSpreadMode('none');
        refreshMainToolbar(registry, ui);
      },
      active: () => spread?.getSpreadMode() === 'none',
      disabled: () => !spread,
      categories: ['document'],
    },
    {
      id: TWO_PAGE_ODD_COMMAND_ID,
      label: 'TwoPage (Odd)',
      icon: 'shnctl-two-page-odd',
      action: () => {
        spread?.setSpreadMode('odd');
        refreshMainToolbar(registry, ui);
      },
      active: () => spread?.getSpreadMode() === 'odd',
      disabled: () => !spread,
      categories: ['document'],
    },
    {
      id: VERTICAL_SCROLL_COMMAND_ID,
      label: 'Vertical',
      icon: 'shnctl-scroll-vertical',
      action: () => {
        switchScrollStrategyPreservingPage(registry, ui, scroll, 'vertical');
      },
      active: ({ state, documentId }) => (state as UiPluginState).plugins?.scroll?.documents?.[documentId]?.strategy === 'vertical',
      disabled: () => !scroll,
      categories: ['document'],
    },
    {
      id: HORIZONTAL_SCROLL_COMMAND_ID,
      label: 'Horizontal',
      icon: 'shnctl-scroll-horizontal',
      action: () => {
        switchScrollStrategyPreservingPage(registry, ui, scroll, 'horizontal');
      },
      active: ({ state, documentId }) => (state as UiPluginState).plugins?.scroll?.documents?.[documentId]?.strategy === 'horizontal',
      disabled: () => !scroll,
      categories: ['document'],
    },
    {
      id: ROTATE_COMMAND_ID,
      label: 'Rotate',
      icon: 'shnctl-rotate',
      action: () => {
        rotate?.rotateForward();
        refreshMainToolbar(registry, ui);
      },
      disabled: () => !rotate,
      categories: ['document'],
    },
  ];

  for (const command of [themeCommand, toolbarPinCommand, panCommand, pageModeCommand, ...viewCommands]) {
    commands.registerCommand(command);
  }

  const schema = ui.getSchema();
  const toolbar = schema.toolbars['main-toolbar'];
  if (!toolbar) {
    return () => {
      cleanupToolbarDomOverrides();
      for (const commandId of registeredCommandIds) {
        commands.unregisterCommand(commandId);
      }
    };
  }

  addPageModeToResponsiveSchema(toolbar, schema);

  const items = removeDividerBeforePanTool(
    removeToolbarItemsById(
      removeToolbarItemByCommandId(structuredClone(toolbar.items) as ToolbarItem[], COMMENT_PANEL_COMMAND_ID),
      new Set([...VIEW_CONTROL_BUTTON_IDS, ...MAIN_ZOOM_ITEM_IDS, ...MAIN_TOOL_ITEM_IDS, PAGE_SETTINGS_BUTTON_ID, PAGE_MODE_TAB_ID]),
    ),
  );
  const rightGroup = items.find((item): item is Extract<ToolbarItem, { type: 'group' }> => item.type === 'group' && item.id === 'right-group');
  const modeTabs = items.find((item): item is Extract<ToolbarItem, { type: 'tab-group' }> => item.type === 'tab-group' && item.id === 'mode-tabs');

  if (modeTabs && !modeTabs.tabs.some((tab) => tab.id === PAGE_MODE_TAB_ID)) {
    const viewModeTab = modeTabs.tabs.find((tab) => tab.id === 'view-mode');

    if (viewModeTab?.visibilityDependsOn?.itemIds && !viewModeTab.visibilityDependsOn.itemIds.includes(PAGE_MODE_TAB_ID)) {
      viewModeTab.visibilityDependsOn.itemIds = [PAGE_MODE_TAB_ID, ...viewModeTab.visibilityDependsOn.itemIds];
    }

    modeTabs.tabs.splice(1, 0, {
      id: PAGE_MODE_TAB_ID,
      commandId: PAGE_MODE_COMMAND_ID,
      variant: 'text',
      categories: ['mode', 'page'],
    });
  }

  if (rightGroup) {
    if (!rightGroup.items.some((item) => item.id === THEME_BUTTON_ID)) {
      rightGroup.items.unshift({
        type: 'command-button',
        id: THEME_BUTTON_ID,
        commandId: THEME_COMMAND_ID,
        variant: 'icon',
      });
    }
    if (!rightGroup.items.some((item) => item.id === PAN_BUTTON_ID)) {
      rightGroup.items.push({
        type: 'command-button',
        id: PAN_BUTTON_ID,
        commandId: PAN_COMMAND_ID,
        variant: 'icon',
      });
    }
    if (!rightGroup.items.some((item) => item.id === TOOLBAR_PIN_BUTTON_ID)) {
      rightGroup.items.push({
        type: 'command-button',
        id: TOOLBAR_PIN_BUTTON_ID,
        commandId: TOOLBAR_PIN_COMMAND_ID,
        variant: 'icon',
      });
    }

    ui.mergeSchema({
      toolbars: {
        'main-toolbar': {
          ...toolbar,
          items,
        },
        [PAGE_TOOLBAR_ID]: {
          id: PAGE_TOOLBAR_ID,
          position: {
            placement: 'top',
            slot: 'secondary',
            order: 0,
          },
          items: [
            {
              type: 'spacer',
              id: 'shnctl-page-spacer-left',
              flex: true,
            },
            {
              type: 'group',
              id: 'shnctl-page-group',
              alignment: 'center',
              gap: 2,
              items: [
                {
                  type: 'custom',
                  id: 'shnctl-zoom-toolbar',
                  componentId: 'zoom-toolbar',
                  categories: ['zoom'],
                },
                {
                  type: 'divider',
                  id: 'shnctl-page-divider-0',
                  orientation: 'vertical',
                },
                {
                  type: 'command-button',
                  id: 'shnctl-single-page-button',
                  commandId: SINGLE_PAGE_COMMAND_ID,
                  variant: 'icon',
                },
                {
                  type: 'command-button',
                  id: 'shnctl-two-page-odd-button',
                  commandId: TWO_PAGE_ODD_COMMAND_ID,
                  variant: 'icon',
                },
                {
                  type: 'command-button',
                  id: 'shnctl-vertical-scroll-button',
                  commandId: VERTICAL_SCROLL_COMMAND_ID,
                  variant: 'icon',
                },
                {
                  type: 'command-button',
                  id: 'shnctl-horizontal-scroll-button',
                  commandId: HORIZONTAL_SCROLL_COMMAND_ID,
                  variant: 'icon',
                },
                {
                  type: 'command-button',
                  id: 'shnctl-rotate-button',
                  commandId: ROTATE_COMMAND_ID,
                  variant: 'icon',
                },
              ],
            },
            {
              type: 'spacer',
              id: 'shnctl-page-spacer-right',
              flex: true,
            },
          ],
          categories: ['page', 'zoom'],
        },
      },
    });
    refreshMainToolbar(registry, ui);
  }

  return () => {
    cleanupToolbarDomOverrides();
    for (const commandId of registeredCommandIds) {
      commands.unregisterCommand(commandId);
    }
  };
}
