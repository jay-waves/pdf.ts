import { useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import * as Dialog from '@radix-ui/react-dialog';
import type { PluginRegistry } from '@embedpdf/core';
import {
  PdfZoomMode,
  type PdfActionObject,
  type PdfBookmarkObject,
  type PdfDestinationObject,
  type PdfErrorReason,
  type PdfLinkTarget,
  type Task,
} from '@embedpdf/models';
import {
  PDFViewer,
  PDFViewerConfig,
  type Command,
  type CommandsCapability,
  type PDFViewerRef,
  type ThemeConfig,
  type ToolbarItem,
  type UICapability,
} from '@embedpdf/react-pdf-viewer';
import './viewer.css';

interface ZoomScope {
  getState(): { currentZoomLevel: number };
  requestZoom(level: 'fit-page'): void;
  requestZoomBy(delta: number, center?: { vx: number; vy: number }): void;
}

interface ZoomCapability {
  forDocument(documentId: string): ZoomScope;
}

interface ViewportCapability {
  forDocument(documentId: string): {
    getBoundingRect(): {
      origin: { x: number; y: number };
    };
  };
}

interface ScrollPageChangeEvent {
  documentId: string;
  pageNumber: number;
  totalPages: number;
}

interface ScrollLayoutReadyEvent {
  documentId: string;
  isInitial: boolean;
}

interface ScrollScope {
  getCurrentPage(): number;
  scrollToPage(options: {
    pageNumber: number;
    pageCoordinates?: { x: number; y: number };
    behavior?: 'instant' | 'smooth' | 'auto';
  }): void;
}

interface ScrollCapability {
  forDocument(documentId: string): ScrollScope;
  onPageChange(listener: (event: ScrollPageChangeEvent) => void): () => void;
  onLayoutReady(listener: (event: ScrollLayoutReadyEvent) => void): () => void;
}

interface ReadingHistoryEntry {
  pageNumber: number;
  updatedAt: string;
}

interface BookmarkCapability {
  getBookmarks(): BookmarkTask;
  forDocument(documentId: string): {
    getBookmarks(): BookmarkTask;
  };
}

type BookmarkTask = Task<{ bookmarks: PdfBookmarkObject[] }, PdfErrorReason>;

type OutlineStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
type OutlineCache = {
  status: OutlineStatus;
  bookmarks: PdfBookmarkObject[];
};

type FlattenedBookmark = {
  title: string;
  pageNumber: number;
};

type ViewerTheme = {
  id: string;
  name: string;
  icon: string;
  config: ThemeConfig;
};

const EMPTY_CLEANUP = () => {};
const DEFAULT_BADGE_TITLE = 'No matching outline entry for the current page';
const READING_HISTORY_KEY = 'embedpdf-reading-history-v1';
const SCROLL_ANCHOR_FIX_STYLE_ID = 'shnctl-scroll-anchor-fix';
const THEME_COMMAND_ID = 'shnctl.theme.cycle';
const THEME_BUTTON_ID = 'shnctl-theme-cycle-button';
const THEME_STORAGE_KEY = 'shnctl-viewer-theme-v1';

const VIEWER_THEMES: ViewerTheme[] = [
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
          app: '#fdf6e3',
          surface: '#eee8d5',
          surfaceAlt: '#f4efd9',
          elevated: '#fffaf0',
          overlay: 'rgba(147, 128, 108, 0.22)',
          input: '#fdf6e3',
        },
        foreground: {
          primary: '#073642',
          secondary: '#586e75',
          muted: '#839496',
          disabled: '#93a1a1',
          onAccent: '#fdf6e3',
        },
        border: {
          default: '#d6cfb8',
          subtle: '#e2dcc7',
          strong: '#268bd2',
        },
        accent: {
          primary: '#268bd2',
          primaryHover: '#2aa198',
          primaryActive: '#006d8f',
          primaryLight: '#d8edf0',
          primaryForeground: '#fdf6e3',
        },
        interactive: {
          hover: '#e8dfc6',
          active: '#ddd3ba',
          selected: '#d8edf0',
          focus: '#268bd2',
          focusRing: '#93a1a1',
        },
      },
    },
  },
  {
    id: 'morandi',
    name: 'Morandi',
    icon: 'shnctl-palette-5',
    config: {
      preference: 'light',
      light: {
        background: {
          app: '#f3f0ea',
          surface: '#e6e0d7',
          surfaceAlt: '#ece7df',
          elevated: '#faf7f1',
          overlay: 'rgba(116, 105, 96, 0.22)',
          input: '#f8f5ef',
        },
        foreground: {
          primary: '#353331',
          secondary: '#5d5853',
          muted: '#80796f',
          disabled: '#aaa196',
          onAccent: '#fffaf4',
        },
        border: {
          default: '#d0c8bd',
          subtle: '#ddd6cc',
          strong: '#7b8f87',
        },
        accent: {
          primary: '#7b8f87',
          primaryHover: '#6f817a',
          primaryActive: '#63756f',
          primaryLight: '#d9dfdb',
          primaryForeground: '#fffaf4',
        },
        interactive: {
          hover: '#ded8cf',
          active: '#d3cbc1',
          selected: '#d9dfdb',
          focus: '#7b8f87',
          focusRing: '#b7aaa0',
        },
      },
    },
  },
  {
    id: 'mediterranean',
    name: 'Mediterranean',
    icon: 'shnctl-palette-6',
    config: {
      preference: 'light',
      light: {
        background: {
          app: '#f3f4ee',
          surface: '#e6ece6',
          surfaceAlt: '#eef1ea',
          elevated: '#fbfbf4',
          overlay: 'rgba(58, 83, 92, 0.2)',
          input: '#f8f8f1',
        },
        foreground: {
          primary: '#263b40',
          secondary: '#486064',
          muted: '#6d7d7f',
          disabled: '#9aa5a4',
          onAccent: '#f7fbf8',
        },
        border: {
          default: '#c9d4cf',
          subtle: '#d9e0dc',
          strong: '#3f7278',
        },
        accent: {
          primary: '#3f7278',
          primaryHover: '#35666d',
          primaryActive: '#2e5a60',
          primaryLight: '#d7e6e3',
          primaryForeground: '#f7fbf8',
        },
        interactive: {
          hover: '#dce7e2',
          active: '#ccdcd6',
          selected: '#d7e6e3',
          focus: '#3f7278',
          focusRing: '#8aa9a8',
        },
      },
    },
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: 'shnctl-palette-7',
    config: {
      preference: 'light',
      light: {
        background: {
          app: '#f6f8fa',
          surface: '#ffffff',
          surfaceAlt: '#f6f8fa',
          elevated: '#ffffff',
          overlay: 'rgba(31, 35, 40, 0.16)',
          input: '#ffffff',
        },
        foreground: {
          primary: '#1f2328',
          secondary: '#59636e',
          muted: '#6e7781',
          disabled: '#8c959f',
          onAccent: '#ffffff',
        },
        border: {
          default: '#d0d7de',
          subtle: '#d8dee4',
          strong: '#0969da',
        },
        accent: {
          primary: '#0969da',
          primaryHover: '#0757b7',
          primaryActive: '#054da7',
          primaryLight: '#ddf4ff',
          primaryForeground: '#ffffff',
        },
        interactive: {
          hover: '#f3f4f6',
          active: '#eaeef2',
          selected: '#ddf4ff',
          focus: '#0969da',
          focusRing: '#0969da',
        },
      },
    },
  },
];

const isPdfDocumentUrl = (value: string) => {
  try {
    const url = new URL(value);
    const isSupportedProtocol = url.protocol === 'file:' || url.protocol === 'https:';

    return isSupportedProtocol && url.pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
};

function getInitialFileUrl() {
  const params = new URLSearchParams(window.location.search);
  const file = params.get('file') ?? params.get('src');

  return file && isPdfDocumentUrl(file) ? file : undefined;
}

function getActiveDocumentId(registry: PluginRegistry) {
  return registry.getStore().getState().core.activeDocumentId;
}

function getStoredThemeIndex() {
  let storedThemeId: string | null = null;

  try {
    storedThemeId = window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return 0;
  }

  const index = VIEWER_THEMES.findIndex((theme) => theme.id === storedThemeId);

  return index >= 0 ? index : 0;
}

function registerThemeIcons(container: PDFViewerRef['container']) {
  if (!container) {
    return;
  }

  const createPaletteIcon = (countPath: string) => ({
    viewBox: '0 0 24 24',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.8,
    paths: [
      {
        d: 'M12 3.4c-4.75 0-8.6 3.35-8.6 7.9 0 4 3.2 7.3 7.2 7.3h1.15c.9 0 1.5-.62 1.5-1.42 0-.7-.48-1.25-1.2-1.25h-.42c-.9 0-1.62-.7-1.62-1.58 0-.9.72-1.62 1.62-1.62h2.68c3.47 0 6.29-2.03 6.29-4.82 0-2.88-3.85-4.51-8.6-4.51z',
        stroke: 'primary',
        fill: 'none',
      },
      { d: 'M7.4 10.2h.02', stroke: 'primary', fill: 'none', strokeWidth: 2.4 },
      { d: 'M10.25 7.35h.02', stroke: 'primary', fill: 'none', strokeWidth: 2.4 },
      { d: 'M14.15 7.35h.02', stroke: 'primary', fill: 'none', strokeWidth: 2.4 },
      { d: 'M16.95 10.2h.02', stroke: 'primary', fill: 'none', strokeWidth: 2.4 },
      { d: 'M15.6 16.9a4.4 4.4 0 1 0 8.8 0a4.4 4.4 0 1 0 -8.8 0', stroke: 'none', fill: 'secondary' },
      { d: countPath, stroke: '#ffffff', fill: 'none', strokeWidth: 1.55 },
    ],
  });

  container.registerIcons({
    'shnctl-palette-1': createPaletteIcon('M20 14.7v4.4'),
    'shnctl-palette-2': createPaletteIcon('M18.35 14.65h3.25v1.5h-3.25v2.95h3.25'),
    'shnctl-palette-3': createPaletteIcon('M18.35 14.65h3.25v1.55h-2.35M21.6 16.2v2.9h-3.25'),
    'shnctl-palette-4': createPaletteIcon('M18.3 14.65v2.45h3.3M21.6 14.65v4.45'),
    'shnctl-palette-5': createPaletteIcon('M21.55 14.65h-3.2l-.2 1.9h1.75a1.3 1.3 0 0 1 0 2.55h-1.8'),
    'shnctl-palette-6': createPaletteIcon('M21.45 14.75h-1.8a1.55 1.55 0 0 0 0 3.1h.35a1.25 1.25 0 0 0 0-2.5h-1.85'),
    'shnctl-palette-7': createPaletteIcon('M18.3 14.65h3.35l-2.15 4.45'),
  });
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

function refreshMainToolbar(registry: PluginRegistry, ui: UICapability) {
  const documentId = getActiveDocumentId(registry);

  if (documentId) {
    ui.forDocument(documentId).setActiveToolbar('top', 'main', 'main-toolbar');
  }
}

function installThemeSwitcher(
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

  registerThemeIcons(container);
  applyViewerTheme(container, themeIndexRef.current);

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

  commands.registerCommand(themeCommand);

  const schema = ui.getSchema();
  const toolbar = schema.toolbars['main-toolbar'];
  if (!toolbar) {
    return () => commands.unregisterCommand(THEME_COMMAND_ID);
  }

  const items = structuredClone(toolbar.items) as ToolbarItem[];
  const rightGroup = items.find((item): item is Extract<ToolbarItem, { type: 'group' }> => item.type === 'group' && item.id === 'right-group');

  if (rightGroup && !rightGroup.items.some((item) => item.id === THEME_BUTTON_ID)) {
    rightGroup.items.unshift({
      type: 'command-button',
      id: THEME_BUTTON_ID,
      commandId: THEME_COMMAND_ID,
      variant: 'icon',
    });

    ui.mergeSchema({
      toolbars: {
        'main-toolbar': {
          ...toolbar,
          items,
        },
      },
    });
    refreshMainToolbar(registry, ui);
  }

  return () => {
    commands.unregisterCommand(THEME_COMMAND_ID);
  };
}

function readHistoryStore() {
  try {
    const raw = window.localStorage.getItem(READING_HISTORY_KEY);
    if (!raw) {
      return {} as Record<string, ReadingHistoryEntry>;
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, ReadingHistoryEntry>) : {};
  } catch {
    return {} as Record<string, ReadingHistoryEntry>;
  }
}

function writeHistoryEntry(fileUrl: string, pageNumber: number) {
  if (!fileUrl || pageNumber < 1) {
    return;
  }

  const store = readHistoryStore();
  store[fileUrl] = {
    pageNumber,
    updatedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(READING_HISTORY_KEY, JSON.stringify(store));
}

function readHistoryEntry(fileUrl: string) {
  return readHistoryStore()[fileUrl];
}

function toOutlineCache(bookmarks: PdfBookmarkObject[]): OutlineCache {
  return {
    status: bookmarks.length ? 'ready' : 'empty',
    bookmarks,
  };
}

function requestPdfZoom(registry: PluginRegistry, direction: 1 | -1, event?: WheelEvent | KeyboardEvent) {
  const documentId = getActiveDocumentId(registry);
  const zoom = registry.getPlugin('zoom')?.provides?.() as ZoomCapability | undefined;

  if (!documentId || !zoom) {
    return;
  }

  const zoomScope = zoom.forDocument(documentId);
  const currentZoom = zoomScope.getState().currentZoomLevel || 1;
  const delta = currentZoom * 0.12 * direction;
  const viewportCapability = registry.getPlugin('viewport')?.provides?.() as ViewportCapability | undefined;
  const viewport = viewportCapability?.forDocument(documentId);
  const viewportRect = viewport?.getBoundingRect?.();
  const clientX = event instanceof WheelEvent ? event.clientX : window.innerWidth / 2;
  const clientY = event instanceof WheelEvent ? event.clientY : window.innerHeight / 2;
  const center = viewportRect
    ? {
        vx: clientX - viewportRect.origin.x,
        vy: clientY - viewportRect.origin.y,
      }
    : undefined;

  zoomScope.requestZoomBy(delta, center);
}

function installBrowserZoomInterceptor(registry: PluginRegistry) {
  let lastWheelZoomAt = 0;

  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const now = performance.now();
    if (now - lastWheelZoomAt < 45) {
      return;
    }

    lastWheelZoomAt = now;
    requestPdfZoom(registry, event.deltaY < 0 ? 1 : -1, event);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    if (event.key !== '+' && event.key !== '=' && event.key !== '-' && event.key !== '_' && event.key !== '0') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.key === '0') {
      const documentId = getActiveDocumentId(registry);
      const zoom = registry.getPlugin('zoom')?.provides?.() as ZoomCapability | undefined;

      if (documentId && zoom) {
        zoom.forDocument(documentId).requestZoom('fit-page');
      }

      return;
    }

    requestPdfZoom(registry, event.key === '-' || event.key === '_' ? -1 : 1, event);
  };

  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  window.addEventListener('keydown', onKeyDown, { capture: true });

  return () => {
    window.removeEventListener('wheel', onWheel, { capture: true });
    window.removeEventListener('keydown', onKeyDown, { capture: true });
  };
}

function installReadingHistory(registry: PluginRegistry, fileUrl?: string) {
  if (!fileUrl) {
    return EMPTY_CLEANUP;
  }

  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  if (!scroll) {
    return EMPTY_CLEANUP;
  }

  let restoredDocumentId: string | null = null;
  let pendingPageNumber = 0;
  let pendingWriteId = 0;

  const flushPendingWrite = () => {
    pendingWriteId = 0;
    writeHistoryEntry(fileUrl, pendingPageNumber);
  };

  const scheduleHistoryWrite = (pageNumber: number) => {
    pendingPageNumber = pageNumber;
    if (pendingWriteId) {
      window.clearTimeout(pendingWriteId);
    }
    pendingWriteId = window.setTimeout(flushPendingWrite, 300);
  };

  const unsubscribePageChange = scroll.onPageChange((event) => {
    scheduleHistoryWrite(event.pageNumber);
  });

  const unsubscribeLayoutReady = scroll.onLayoutReady((event) => {
    if (!event.isInitial || restoredDocumentId === event.documentId) {
      return;
    }

    const saved = readHistoryEntry(fileUrl);
    if (!saved || saved.pageNumber <= 1) {
      restoredDocumentId = event.documentId;
      return;
    }

    restoredDocumentId = event.documentId;
    scroll.forDocument(event.documentId).scrollToPage({
      pageNumber: saved.pageNumber,
      behavior: 'instant',
    });
  });

  const onBeforeUnload = () => {
    if (pendingWriteId) {
      window.clearTimeout(pendingWriteId);
      flushPendingWrite();
    }

    const documentId = getActiveDocumentId(registry);
    if (!documentId) {
      return;
    }

    writeHistoryEntry(fileUrl, scroll.forDocument(documentId).getCurrentPage());
  };

  window.addEventListener('beforeunload', onBeforeUnload);

  return () => {
    if (pendingWriteId) {
      window.clearTimeout(pendingWriteId);
      flushPendingWrite();
    }
    window.removeEventListener('beforeunload', onBeforeUnload);
    unsubscribePageChange();
    unsubscribeLayoutReady();
  };
}

function installScrollAnchorFix() {
  let attempts = 0;

  const inject = () => {
    const container = document.querySelector('embedpdf-container');
    const root = container?.shadowRoot;

    if (!root) {
      if (attempts < 10) {
        attempts += 1;
        window.setTimeout(inject, 50);
      }
      return;
    }

    if (root.getElementById(SCROLL_ANCHOR_FIX_STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = SCROLL_ANCHOR_FIX_STYLE_ID;
    style.textContent = `
      #document-content,
      #document-content *,
      .bg-bg-app,
      .bg-bg-app * {
        overflow-anchor: none !important;
      }

      :host([data-color-scheme="dark"]) #document-content canvas,
      :host([data-color-scheme="dark"]) #document-content img {
        filter: brightness(0.82) contrast(1.08) saturate(0.92);
      }
    `;
    root.appendChild(style);
  };

  inject();
}

function flattenBookmarks(bookmarks: PdfBookmarkObject[]) {
  const flattened: FlattenedBookmark[] = [];

  const walk = (items: PdfBookmarkObject[]) => {
    for (const item of items) {
      const destination = getDestinationFromTarget(item.target);
      const title = item.title?.trim();

      if (destination && title) {
        flattened.push({
          title,
          pageNumber: destination.pageIndex + 1,
        });
      }

      if (item.children?.length) {
        walk(item.children);
      }
    }
  };

  walk(bookmarks);

  flattened.sort((left, right) => {
    if (left.pageNumber !== right.pageNumber) {
      return left.pageNumber - right.pageNumber;
    }

    return left.title.localeCompare(right.title, 'zh-CN');
  });

  return flattened;
}

function getCurrentBookmarkTitle(bookmarks: PdfBookmarkObject[], pageNumber: number) {
  if (pageNumber < 1) {
    return '';
  }

  const flattened = flattenBookmarks(bookmarks);
  let currentTitle = '';

  for (const item of flattened) {
    if (item.pageNumber > pageNumber) {
      break;
    }

    currentTitle = item.title;
  }

  return currentTitle;
}

function installCurrentTitleTracker(
  registry: PluginRegistry,
  getBookmarks: () => PdfBookmarkObject[],
  onChange: (value: { pageNumber: number; title: string }) => void,
) {
  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  if (!scroll) {
    return EMPTY_CLEANUP;
  }

  let currentPageNumber = 1;

  const refresh = () => {
    const title = getCurrentBookmarkTitle(getBookmarks(), currentPageNumber);
    onChange({
      pageNumber: currentPageNumber,
      title,
    });
  };

  const unsubscribePageChange = scroll.onPageChange((event) => {
    currentPageNumber = event.pageNumber;
    refresh();
  });

  const unsubscribeLayoutReady = scroll.onLayoutReady((event) => {
    currentPageNumber = scroll.forDocument(event.documentId).getCurrentPage();
    refresh();
  });

  refresh();

  return () => {
    unsubscribePageChange();
    unsubscribeLayoutReady();
  };
}

function getDestinationFromTarget(target?: PdfLinkTarget): PdfDestinationObject | undefined {
  if (!target) {
    return undefined;
  }

  if (target.type === 'destination') {
    return target.destination;
  }

  if (target.type === 'action') {
    const action = target.action as PdfActionObject;
    return 'destination' in action ? action.destination : undefined;
  }

  return undefined;
}

async function loadBookmarks(registry: PluginRegistry) {
  const documentId = getActiveDocumentId(registry);
  const bookmark = registry.getPlugin('bookmark')?.provides?.() as BookmarkCapability | undefined;

  if (!bookmark) {
    console.error('[shnctl] bookmark plugin is not available');
    return [];
  }

  const task = documentId ? bookmark.forDocument(documentId).getBookmarks() : bookmark.getBookmarks();

  try {
    return (await task.toPromise()).bookmarks;
  } catch (error) {
    console.error('[shnctl] failed to load bookmarks', {
      documentId,
      error,
    });
    throw error;
  }
}

async function loadOutlineCache(registry: PluginRegistry) {
  return toOutlineCache(await loadBookmarks(registry));
}

function installOutlinePrefetch(
  registry: PluginRegistry,
  onLoaded: (cache: OutlineCache) => void,
) {
  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  if (!scroll) {
    onLoaded({ status: 'error', bookmarks: [] });
    return EMPTY_CLEANUP;
  }

  let loadedDocumentId: string | null = null;

  const unsubscribeLayoutReady = scroll.onLayoutReady((event) => {
    if (!event.isInitial || loadedDocumentId === event.documentId) {
      return;
    }

    loadedDocumentId = event.documentId;
    onLoaded({ status: 'loading', bookmarks: [] });

    loadOutlineCache(registry)
      .then(onLoaded)
      .catch((error) => {
        console.error('[shnctl] outline prefetch failed after initial layout', {
          documentId: event.documentId,
          error,
        });
        onLoaded({ status: 'error', bookmarks: [] });
      });
  });

  return () => {
    unsubscribeLayoutReady();
  };
}

function scrollToBookmark(registry: PluginRegistry, bookmark: PdfBookmarkObject) {
  const destination = getDestinationFromTarget(bookmark.target);
  if (!destination) {
    return;
  }

  const documentId = getActiveDocumentId(registry);
  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  if (!documentId || !scroll) {
    return;
  }

  const xyzZoom = destination.zoom.mode === PdfZoomMode.XYZ ? destination.zoom : undefined;
  scroll.forDocument(documentId).scrollToPage({
    pageNumber: destination.pageIndex + 1,
    pageCoordinates: xyzZoom ? { x: xyzZoom.params.x, y: xyzZoom.params.y } : undefined,
    behavior: 'smooth',
  });
}

function ShnctlOutline({
  registry,
  open,
  cache,
  onCacheChange,
  onClose,
}: {
  registry?: PluginRegistry;
  open: boolean;
  cache: OutlineCache;
  onCacheChange: (cache: OutlineCache) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open || !registry || cache.status !== 'error') {
      return;
    }

    let cancelled = false;
    onCacheChange({ status: 'loading', bookmarks: [] });

    loadOutlineCache(registry)
      .then((nextCache) => {
        if (cancelled) {
          return;
        }
        onCacheChange(nextCache);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('[shnctl] outline retry failed when panel opened', {
            error,
          });
          onCacheChange({ status: 'error', bookmarks: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cache.status, onCacheChange, open, registry]);

  const body = useMemo(() => {
    if (cache.status === 'idle' || cache.status === 'loading') {
      return <div className="shnctl-state">Loading outline...</div>;
    }

    if (cache.status === 'empty') {
      return <div className="shnctl-state">This PDF does not include an outline.</div>;
    }

    if (cache.status === 'error') {
      return <div className="shnctl-state">Failed to load the outline.</div>;
    }

    return (
      <BookmarkList
        bookmarks={cache.bookmarks}
        level={0}
        onSelect={(bookmark) => {
          if (registry) {
            scrollToBookmark(registry, bookmark);
          }
        }}
      />
    );
  }, [cache.bookmarks, cache.status, registry]);

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="shnctl-overlay" />
        <Dialog.Content className="shnctl-panel" aria-describedby={undefined}>
          <Dialog.Title className="shnctl-visually-hidden">PDF Outline</Dialog.Title>
          <div className="shnctl-content">{body}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function BookmarkList({
  bookmarks,
  level,
  onSelect,
}: {
  bookmarks: PdfBookmarkObject[];
  level: number;
  onSelect: (bookmark: PdfBookmarkObject) => void;
}) {
  return (
    <ol className="shnctl-list">
      {bookmarks.map((bookmark, index) => {
        const destination = getDestinationFromTarget(bookmark.target);
        const pageNumber = destination ? destination.pageIndex + 1 : undefined;

        return (
          <li key={`${level}-${index}-${bookmark.title}`} className="shnctl-item">
            <button
              type="button"
              className="shnctl-bookmark"
              style={{ marginLeft: `${level * 18}px`, width: `calc(100% - ${level * 18}px)` }}
              onClick={() => onSelect(bookmark)}
              disabled={!destination}
            >
              <span className="shnctl-bookmark-title">{bookmark.title || `Item ${index + 1}`}</span>
              {pageNumber ? <span className="shnctl-bookmark-page">{pageNumber}</span> : null}
            </button>
            {bookmark.children?.length ? (
              <BookmarkList bookmarks={bookmark.children} level={level + 1} onSelect={onSelect} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function CurrentTitleBadge({
  title,
  pageNumber,
  onOpenOutline,
  position,
  onPointerDown,
}: {
  title: string;
  pageNumber: number;
  onOpenOutline: () => void;
  position?: { x: number; y: number };
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const badgeTitle = title || DEFAULT_BADGE_TITLE;

  return (
    <button
      type="button"
      className="shnctl-current-title"
      title={badgeTitle}
      onClick={onOpenOutline}
      onPointerDown={onPointerDown}
      style={position ? { left: `${position.x}px`, top: `${position.y}px`, right: 'auto' } : undefined}
    >
      <span className="shnctl-current-title-text">{badgeTitle}</span>
      <span className="shnctl-current-title-page">Page {pageNumber || 1}</span>
    </button>
  );
}

function App() {
  const fileUrl = getInitialFileUrl();
  const [registry, setRegistry] = useState<PluginRegistry>();
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineCache, setOutlineCache] = useState<OutlineCache>({
    status: 'idle',
    bookmarks: [],
  });
  const [currentPageNumber, setCurrentPageNumber] = useState(1);
  const [currentTitle, setCurrentTitle] = useState('');
  const [badgePosition, setBadgePosition] = useState<{ x: number; y: number }>();
  const viewerRef = useRef<PDFViewerRef>(null);
  const registryCleanupRef = useRef<(() => void) | null>(null);
  const badgeRef = useRef<HTMLButtonElement | null>(null);
  const outlineCacheRef = useRef(outlineCache);
  const currentPageNumberRef = useRef(1);
  const titleTrackerRefreshRef = useRef<(() => void) | null>(null);
  const themeIndexRef = useRef(getStoredThemeIndex());
  const dragStateRef = useRef<{
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null>(null);
  const suppressBadgeClickRef = useRef(false);

  useEffect(() => {
    outlineCacheRef.current = outlineCache;
    titleTrackerRefreshRef.current?.();
  }, [outlineCache]);

  useEffect(() => {
    currentPageNumberRef.current = currentPageNumber;
  }, [currentPageNumber]);

  const viewerConfig = useMemo<PDFViewerConfig>(
    () => ({
      ...(fileUrl ? { src: fileUrl } : {}),
      worker: true,
      tabBar: 'never',
      disabledCategories: ['form', 'redaction', 'panel-sidebar', 'insert'],
      theme: VIEWER_THEMES[themeIndexRef.current]?.config ?? VIEWER_THEMES[0].config,
      scroll: {
        defaultBufferSize: 2,
      },
      render: {
        defaultImageType: 'image/bmp',
      },
      tiling: {
        defaultImageType: 'image/bmp',
      },
    }),
    [fileUrl],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fileUrl = params.get('file');

    if (!fileUrl) {
      document.title = 'PDF';
      return;
    }

    try {
      const url = new URL(fileUrl);
      const name = decodeURIComponent(url.pathname)
        .split('/')
        .filter(Boolean)
        .pop();

      document.title = name || 'PDF';
    } catch {
      document.title = 'PDF';
    }
  }, []);

  useEffect(() => {
    return () => {
      registryCleanupRef.current?.();
      registryCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      const badge = badgeRef.current;
      if (!dragState || !badge) {
        return;
      }

      const width = badge.offsetWidth;
      const height = badge.offsetHeight;
      const nextX = Math.min(Math.max(12, event.clientX - dragState.offsetX), Math.max(12, window.innerWidth - width - 12));
      const nextY = Math.min(Math.max(12, event.clientY - dragState.offsetY), Math.max(12, window.innerHeight - height - 12));

      if (!dragState.moved) {
        const distance = Math.abs(event.movementX) + Math.abs(event.movementY);
        if (distance > 2) {
          dragState.moved = true;
          suppressBadgeClickRef.current = true;
        }
      }

      setBadgePosition({ x: nextX, y: nextY });
    };

    const onPointerUp = () => {
      dragStateRef.current = null;
      window.setTimeout(() => {
        suppressBadgeClickRef.current = false;
      }, 0);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  const handleBadgePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    badgeRef.current = event.currentTarget;
    dragStateRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    };
    setBadgePosition((current) => current ?? { x: rect.left, y: rect.top });
  };

  const handleOpenOutline = () => {
    if (suppressBadgeClickRef.current) {
      return;
    }

    setOutlineOpen(true);
  };

  const shouldRenderCurrentTitleBadge =
    outlineCache.status === 'ready' && outlineCache.bookmarks.length > 0;

  return (
    <main className="app-shell">
      <PDFViewer
        ref={viewerRef}
        config={viewerConfig}
        className="viewer"
        onReady={(nextRegistry) => {
          registryCleanupRef.current?.();

          setRegistry(nextRegistry);
          setOutlineCache({ status: 'idle', bookmarks: [] });
          setCurrentPageNumber(1);
          setCurrentTitle('');
          installScrollAnchorFix();

          const refreshCurrentTitle = () => {
            const pageNumber = currentPageNumberRef.current;
            setCurrentTitle(getCurrentBookmarkTitle(outlineCacheRef.current.bookmarks, pageNumber));
          };

          titleTrackerRefreshRef.current = refreshCurrentTitle;

          const cleanups: Array<() => void> = [
            installThemeSwitcher(nextRegistry, viewerRef.current?.container ?? null, themeIndexRef),
            installBrowserZoomInterceptor(nextRegistry),
            installReadingHistory(nextRegistry, fileUrl),
            installOutlinePrefetch(nextRegistry, setOutlineCache),
            installCurrentTitleTracker(nextRegistry, () => outlineCacheRef.current.bookmarks, ({ pageNumber, title }) => {
              currentPageNumberRef.current = pageNumber;
              setCurrentPageNumber(pageNumber);
              setCurrentTitle(title);
            }),
            () => {
              titleTrackerRefreshRef.current = null;
            },
          ];

          registryCleanupRef.current = () => {
            for (const cleanup of cleanups) {
              cleanup();
            }
          };
        }}
      />
      <ShnctlOutline
        registry={registry}
        open={outlineOpen}
        cache={outlineCache}
        onCacheChange={setOutlineCache}
        onClose={() => setOutlineOpen(false)}
      />
      {shouldRenderCurrentTitleBadge ? (
        <CurrentTitleBadge
          title={currentTitle}
          pageNumber={currentPageNumber}
          position={badgePosition}
          onPointerDown={handleBadgePointerDown}
          onOpenOutline={handleOpenOutline}
        />
      ) : null}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
