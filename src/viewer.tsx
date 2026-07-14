import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PluginRegistry } from '@embedpdf/core';
import pdfiumWasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import {
  type AnnotationCapability,
  type PanCapability,
  LockModeType,
  PDFViewer,
  PDFViewerConfig,
  type PDFViewerRef,
} from '@embedpdf/react-pdf-viewer';
import './viewer.css';
import {
  EMPTY_CLEANUP,
  getActiveDocumentId,
  getCurrentScrollAnchor,
  getInitialFileUrl,
  restoreScrollAnchorAfterLayout,
  runWhenIdle,
  type ScrollAnchor,
  type ScrollCapability,
} from './utils';
import {
  BottomNavigationControl,
  ShnctlOutline,
  getCurrentBookmarkTitle,
  installBuiltInPageControlsHider,
  installCurrentTitleTracker,
  installOutlinePrefetch,
  installPageKeyboardNavigation,
  type OutlineCache,
} from './outline';
import {
  installPanelCommandRedirects,
  installSearchKeyboardShortcut,
} from './search';
import {
  getStoredThemeIndex,
  VIEWER_THEMES,
  installThemeSwitcher,
  setViewerScrollStrategyAttribute,
} from './theme';
import { ShnctlToolbar } from './toolbar';
import { ShnctlThumbnails } from './thumbnails';
import { ShnctlSignatures } from './signatures';
import { ShnctlColorPalette } from './color-palette';
import { installReadingHistory, savePdfToOriginalFile } from './file-handle';
import { installSelectionTranslate } from './selection-translate';

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

interface CommandsRegistryCapability {
  registerCommand(command: {
    id: string;
    label?: string;
    icon?: string;
    categories?: string[];
    action(context: { documentId: string; registry: PluginRegistry }): void;
  }): void;
  unregisterCommand(commandId: string): void;
}

interface UiSchemaCapability {
  getSchema(): {
    sidebars?: Record<string, unknown>;
  };
  forDocument(documentId: string): {
    closeSidebarSlot?(placement: 'left' | 'right', slot: string): void;
  };
}

const MAX_RENDER_DPR = 1.5;
const RENDER_IMAGE_TYPE = 'image/bmp';
const TILING_TILE_SIZE = 768;
const TILING_OVERLAP_PX = 2;
const TILING_EXTRA_RINGS = 0;
const COMMENT_PANEL_WIDTH = '24vw';
const TEXT_MARKUP_TOOL_IDS = ['highlight', 'underline', 'strikeout', 'squiggly'];
const NATIVE_TOOLBAR_IDS = [
  'main-toolbar',
  'annotation-toolbar',
  'shapes-toolbar',
  'insert-toolbar',
  'form-toolbar',
  'redaction-toolbar',
  'shnctl-page-toolbar',
] as const;
const DISABLED_INSERT_COMMAND_IDS = [
  'insert:add-attachment',
  'insert:add-image',
  'insert:add-rubber-stamp',
] as const;
const DISABLED_NATIVE_SIDEBAR_IDS = [
  'annotation-panel',
  'rubber-stamp-panel',
] as const;
const ANNOTATION_STYLE_COMMAND_IDS = [
  'annotation:toggle-annotation-style',
  'panel:toggle-annotation-style',
] as const;
const PAINT_BUCKET_ICON_ID = 'paint-bucket';
const PDFIUM_WASM_URL = new URL(pdfiumWasmUrl, location.href).href;

function handleBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = '';
}
const DISABLED_VIEWER_CATEGORIES = [
  'attachment',
  'document-capture',
  'form',
  'fullscreen',
  'insert-attachment',
  'insert-image',
  'insert-link',
  'insert-rubber-stamp',
  'panel-sidebar',
  'redaction',
  'stamp',
];

function installWhenIdle(install: () => () => void) {
  let cleanup = EMPTY_CLEANUP;
  let installed = false;

  const cancel = runWhenIdle(() => {
    installed = true;
    try {
      cleanup = install();
    } catch (error) {
      console.warn('[shnctl] deferred viewer setup step failed', error);
    }
  });

  return () => {
    if (!installed) {
      cancel();
      return;
    }

    cleanup();
  };
}

function installUnsavedChangesTracker(registry: PluginRegistry, onDirtyChange: (dirty: boolean) => void) {
  const annotation = registry.getPlugin('annotation')?.provides?.() as AnnotationCapability | undefined;

  if (!annotation) {
    return EMPTY_CLEANUP;
  }

  return annotation.onAnnotationEvent((event) => {
    if (event.type !== 'loaded' && event.committed) {
      onDirtyChange(true);
    }
  });
}

function installTextMarkupToolReset(registry: PluginRegistry) {
  const annotation = registry.getPlugin('annotation')?.provides?.() as AnnotationCapability | undefined;

  if (!annotation) {
    return EMPTY_CLEANUP;
  }

  return annotation.onAnnotationEvent((event) => {
    if (event.type !== 'create') {
      return;
    }

    const scope = annotation.forDocument(event.documentId);
    if (TEXT_MARKUP_TOOL_IDS.includes(scope.getActiveTool()?.id ?? '')) {
      scope.setActiveTool(null);
    }
  });
}

function installCommentPanelWidth(registry: PluginRegistry) {
  const ui = registry.getPlugin('ui')?.provides?.() as
    | { getSchema(): { sidebars?: Record<string, { width?: string }> } }
    | undefined;
  const commentPanel = ui?.getSchema().sidebars?.['comment-panel'];

  if (commentPanel) {
    commentPanel.width = COMMENT_PANEL_WIDTH;
  }

  return EMPTY_CLEANUP;
}

function installNativeToolbarDisabler(registry: PluginRegistry) {
  const ui = registry.getPlugin('ui')?.provides?.() as
    | {
        getSchema(): {
          toolbars?: Record<string, unknown>;
          sidebars?: Record<string, unknown>;
        };
        forDocument(documentId: string): {
          closeToolbarSlot(placement: 'top', slot: 'main' | 'secondary'): void;
          isToolbarOpen(placement: 'top', slot: 'main' | 'secondary'): boolean;
        };
        onToolbarChanged(listener: (event: { documentId: string; placement: string; slot: string }) => void): () => void;
      }
    | undefined;

  if (!ui) {
    return EMPTY_CLEANUP;
  }

  const toolbars = ui.getSchema().toolbars;
  if (toolbars) {
    for (const toolbarId of NATIVE_TOOLBAR_IDS) {
      delete toolbars[toolbarId];
    }
  }
  const sidebars = ui.getSchema().sidebars;
  if (sidebars) {
    for (const sidebarId of DISABLED_NATIVE_SIDEBAR_IDS) {
      delete sidebars[sidebarId];
    }
  }

  const closeNativeToolbar = (documentId = getActiveDocumentId(registry)) => {
    if (!documentId) {
      return;
    }

    const scope = ui.forDocument(documentId);
    if (scope.isToolbarOpen('top', 'main')) {
      scope.closeToolbarSlot('top', 'main');
    }
    if (scope.isToolbarOpen('top', 'secondary')) {
      scope.closeToolbarSlot('top', 'secondary');
    }
  };

  requestAnimationFrame(() => closeNativeToolbar());
  const unsubscribe = ui.onToolbarChanged((event) => {
    if (event.placement !== 'top' || (event.slot !== 'main' && event.slot !== 'secondary')) {
      return;
    }

    requestAnimationFrame(() => closeNativeToolbar(event.documentId));
  });

  return unsubscribe;
}

function registerPaintBucketIcon(container: PDFViewerRef['container']) {
  container?.registerIcons({
    [PAINT_BUCKET_ICON_ID]: {
      viewBox: '0 0 24 24',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: 2,
      paths: [
        { d: 'M11 7 6 2', stroke: 'primary', fill: 'none' },
        { d: 'M18.992 12H2.041', stroke: 'primary', fill: 'none' },
        {
          d: 'M21.145 18.38A3.34 3.34 0 0 1 20 16.5a3.3 3.3 0 0 1-1.145 1.88c-.575.46-.855 1.02-.855 1.595A2 2 0 0 0 20 22a2 2 0 0 0 2-2.025c0-.58-.285-1.13-.855-1.595',
          stroke: 'primary',
          fill: 'none',
        },
        {
          d: 'm8.5 4.5 2.148-2.148a1.205 1.205 0 0 1 1.704 0l7.296 7.296a1.205 1.205 0 0 1 0 1.704l-7.592 7.592a3.615 3.615 0 0 1-5.112 0l-3.888-3.888a3.615 3.615 0 0 1 0-5.112L5.67 7.33',
          stroke: 'primary',
          fill: 'none',
        },
      ],
    },
  });
}

function installAnnotationStyleCommandRedirect(
  registry: PluginRegistry,
  container: PDFViewerRef['container'],
  openColorPalette: () => void,
) {
  const commands = registry.getPlugin('commands')?.provides?.() as CommandsRegistryCapability | undefined;
  const ui = registry.getPlugin('ui')?.provides?.() as UiSchemaCapability | undefined;

  if (!commands || !ui) {
    return EMPTY_CLEANUP;
  }

  registerPaintBucketIcon(container);
  const sidebars = ui.getSchema().sidebars;
  if (sidebars) {
    delete sidebars['annotation-panel'];
  }

  for (const commandId of ANNOTATION_STYLE_COMMAND_IDS) {
    try {
      commands.unregisterCommand(commandId);
    } catch {
      // Optional command depending on the active snippet schema.
    }

    commands.registerCommand({
      id: commandId,
      label: 'Style',
      icon: PAINT_BUCKET_ICON_ID,
      categories: commandId.startsWith('panel:')
        ? ['panel', 'panel-annotation-style']
        : ['annotation', 'annotation-style'],
      action: ({ documentId }) => {
        const scope = ui.forDocument(documentId);
        scope.closeSidebarSlot?.('left', 'main');
        scope.closeSidebarSlot?.('right', 'main');
        openColorPalette();
      },
    });
  }

  return () => {
    for (const commandId of ANNOTATION_STYLE_COMMAND_IDS) {
      commands.unregisterCommand(commandId);
    }
  };
}

function installSignatureOnlyInsertCommands(registry: PluginRegistry) {
  const commands = registry.getPlugin('commands')?.provides?.() as
    | {
        unregisterCommand(commandId: string): void;
      }
    | undefined;

  if (!commands) {
    return EMPTY_CLEANUP;
  }

  for (const commandId of DISABLED_INSERT_COMMAND_IDS) {
    try {
      commands.unregisterCommand(commandId);
    } catch {
      // Some commands are optional depending on snippet configuration.
    }
  }

  return EMPTY_CLEANUP;
}

function installScrollStrategyAttribute(registry: PluginRegistry) {
  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  if (!scroll) {
    return EMPTY_CLEANUP;
  }

  const sync = (strategy?: string) => {
    if (strategy === 'horizontal' || strategy === 'vertical') {
      setViewerScrollStrategyAttribute(strategy);
      return;
    }

    const documentId = getActiveDocumentId(registry);
    if (!documentId) {
      setViewerScrollStrategyAttribute('vertical');
      return;
    }

    try {
      const state = registry.getStore().getState() as {
        plugins?: { scroll?: { documents?: Record<string, { strategy?: 'vertical' | 'horizontal' }> } };
      };
      setViewerScrollStrategyAttribute(state.plugins?.scroll?.documents?.[documentId]?.strategy ?? 'vertical');
    } catch {
      setViewerScrollStrategyAttribute('vertical');
    }
  };

  sync();
  return scroll.onStateChange((state) => sync(state.strategy));
}

function installRenderDprCap(maxDpr = MAX_RENDER_DPR) {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  const originalDpr = window.devicePixelRatio || 1;
  const cappedOriginalDpr = Math.min(originalDpr, maxDpr);
  let nativeDescriptor: PropertyDescriptor | undefined = descriptor;

  for (let target = Object.getPrototypeOf(window); !nativeDescriptor && target; target = Object.getPrototypeOf(target)) {
    nativeDescriptor = Object.getOwnPropertyDescriptor(target, 'devicePixelRatio');
  }

  const getNativeDpr = () => {
    if (nativeDescriptor?.get) {
      return nativeDescriptor.get.call(window) || originalDpr;
    }

    return originalDpr;
  };

  try {
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      get: () => cappedOriginalDpr * (getNativeDpr() / originalDpr),
    });
  } catch {
    return EMPTY_CLEANUP;
  }

  return () => {
    try {
      if (descriptor) {
        Object.defineProperty(window, 'devicePixelRatio', descriptor);
      } else {
        Reflect.deleteProperty(window, 'devicePixelRatio');
      }
    } catch {
      // Leaving the capped DPR in place is safer than throwing during unmount.
    }
  };
}

const cleanupRenderDprCap = installRenderDprCap();

function requestPdfZoom(registry: PluginRegistry, direction: 1 | -1, event?: WheelEvent | KeyboardEvent) {
  const documentId = getActiveDocumentId(registry);
  const zoom = registry.getPlugin('zoom')?.provides?.() as ZoomCapability | undefined;

  if (!documentId || !zoom) {
    return null;
  }

  const anchor = getCurrentScrollAnchor(registry);
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
  return anchor;
}

function installBrowserZoomInterceptor(registry: PluginRegistry) {
  let lastWheelZoomAt = 0;
  let zoomRestoreAnchor: ScrollAnchor | null = null;
  let zoomRestoreTimer = 0;

  const scheduleZoomAnchorRestore = (anchor: ScrollAnchor | null) => {
    if (!anchor) {
      return;
    }

    zoomRestoreAnchor ??= anchor;

    if (zoomRestoreTimer) {
      window.clearTimeout(zoomRestoreTimer);
    }

    zoomRestoreTimer = window.setTimeout(() => {
      zoomRestoreTimer = 0;
      const nextAnchor = zoomRestoreAnchor;
      zoomRestoreAnchor = null;
      restoreScrollAnchorAfterLayout(registry, nextAnchor);
    }, 180);
  };

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
    scheduleZoomAnchorRestore(requestPdfZoom(registry, event.deltaY < 0 ? 1 : -1, event));
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
      const anchor = getCurrentScrollAnchor(registry);

      if (documentId && zoom) {
        zoom.forDocument(documentId).requestZoom('fit-page');
        scheduleZoomAnchorRestore(anchor);
      }

      return;
    }

    scheduleZoomAnchorRestore(requestPdfZoom(registry, event.key === '-' || event.key === '_' ? -1 : 1, event));
  };

  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  window.addEventListener('keydown', onKeyDown, { capture: true });

  return () => {
    if (zoomRestoreTimer) {
      window.clearTimeout(zoomRestoreTimer);
    }

    window.removeEventListener('wheel', onWheel, { capture: true });
    window.removeEventListener('keydown', onKeyDown, { capture: true });
  };
}

function installMiddleMousePanInterceptor(registry: PluginRegistry) {
  let activeDocumentId: string | null = null;
  let restorePan = false;
  let suppressMiddleMouseUntil = 0;

  const getPanScope = () => {
    const documentId = getActiveDocumentId(registry);
    const pan = registry.getPlugin('pan')?.provides?.() as PanCapability | undefined;

    if (!documentId || !pan) {
      return null;
    }

    return {
      documentId,
      scope: pan.forDocument(documentId),
    };
  };

  const startMiddleMousePan = (event: MouseEvent | PointerEvent) => {
    if (event.button !== 1) {
      return;
    }

    const isPointerEvent = event instanceof PointerEvent;

    if (activeDocumentId) {
      if (!isPointerEvent) {
        event.preventDefault();
      }
      return;
    }

    const panScope = getPanScope();
    if (!panScope) {
      return;
    }

    if (!isPointerEvent) {
      event.preventDefault();
    }
    activeDocumentId = panScope.documentId;
    restorePan = !panScope.scope.isPanMode();
    panScope.scope.enablePan();
  };

  const finishMiddleMousePan = (event: MouseEvent | PointerEvent) => {
    if (event.button !== 1 || !activeDocumentId) {
      return;
    }

    event.preventDefault();
    suppressMiddleMouseUntil = performance.now() + 180;
    const documentId = activeDocumentId;
    const shouldRestorePan = restorePan;
    activeDocumentId = null;
    restorePan = false;

    window.setTimeout(() => {
      if (!shouldRestorePan) {
        return;
      }

      const pan = registry.getPlugin('pan')?.provides?.() as PanCapability | undefined;
      pan?.forDocument(documentId).disablePan();
    }, 120);
  };

  const stopBrowserMiddleMouse = (event: MouseEvent | PointerEvent) => {
    if (event.button !== 1) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  const suppressTailEvent = (event: MouseEvent | PointerEvent) => {
    if (event.button !== 1 || performance.now() > suppressMiddleMouseUntil) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  window.addEventListener('pointerdown', startMiddleMousePan, { capture: true });
  window.addEventListener('mousedown', startMiddleMousePan, { capture: true });
  window.addEventListener('pointerup', finishMiddleMousePan);
  window.addEventListener('mouseup', finishMiddleMousePan);
  window.addEventListener('auxclick', stopBrowserMiddleMouse, { capture: true });
  window.addEventListener('pointermove', suppressTailEvent, { capture: true });
  window.addEventListener('pointerup', suppressTailEvent, { capture: true });
  window.addEventListener('click', suppressTailEvent, { capture: true });

  return () => {
    window.removeEventListener('pointerdown', startMiddleMousePan, { capture: true });
    window.removeEventListener('mousedown', startMiddleMousePan, { capture: true });
    window.removeEventListener('pointerup', finishMiddleMousePan);
    window.removeEventListener('mouseup', finishMiddleMousePan);
    window.removeEventListener('auxclick', stopBrowserMiddleMouse, { capture: true });
    window.removeEventListener('pointermove', suppressTailEvent, { capture: true });
    window.removeEventListener('pointerup', suppressTailEvent, { capture: true });
    window.removeEventListener('click', suppressTailEvent, { capture: true });
  };
}

function App() {
  const fileUrl = getInitialFileUrl();
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const [registry, setRegistry] = useState<PluginRegistry>();
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [thumbnailsOpen, setThumbnailsOpen] = useState(false);
  const [signaturesOpen, setSignaturesOpen] = useState(false);
  const [colorPaletteOpen, setColorPaletteOpen] = useState(false);
  const [outlineCache, setOutlineCache] = useState<OutlineCache>({
    status: 'idle',
    bookmarks: [],
  });
  const [currentPageNumber, setCurrentPageNumber] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [currentTitle, setCurrentTitle] = useState('');
  const [navigationVisible, setNavigationVisible] = useState(false);
  const viewerRef = useRef<PDFViewerRef>(null);
  const registryCleanupRef = useRef<(() => void) | null>(null);
  const outlineCacheRef = useRef(outlineCache);
  const currentPageNumberRef = useRef(1);
  const titleTrackerRefreshRef = useRef<(() => void) | null>(null);
  const hasUnsavedChangesRef = useRef(false);
  const cleanDocumentTitleRef = useRef(document.title);
  const themeIndexRef = useRef(getStoredThemeIndex());
  const navigationHideTimerRef = useRef<number>(0);
  const navigationVisibleRef = useRef(false);
  const searchOpenRef = useRef(false);
  const thumbnailsOpenRef = useRef(false);

  const renderDocumentTitle = () => {
    const title = `${hasUnsavedChangesRef.current ? '*' : ''}${cleanDocumentTitleRef.current}`;
    document.title = title;
    document.querySelector('title')?.replaceChildren(title);
  };

  const setHasUnsavedChanges = (dirty: boolean) => {
    hasUnsavedChangesRef.current = dirty;
    if (dirty) {
      window.addEventListener('beforeunload', handleBeforeUnload);
    } else {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    }
    renderDocumentTitle();
  };

  const revealNavigation = () => {
    if (!navigationVisibleRef.current) {
      navigationVisibleRef.current = true;
      setNavigationVisible(true);
    }

    if (navigationHideTimerRef.current) {
      window.clearTimeout(navigationHideTimerRef.current);
    }

    navigationHideTimerRef.current = window.setTimeout(() => {
      if (navigationVisibleRef.current) {
        navigationVisibleRef.current = false;
        setNavigationVisible(false);
      }
      navigationHideTimerRef.current = 0;
    }, 1800);
  };

  useEffect(() => {
    outlineCacheRef.current = outlineCache;
    titleTrackerRefreshRef.current?.();
  }, [outlineCache]);

  useEffect(() => {
    currentPageNumberRef.current = currentPageNumber;
    revealNavigation();
  }, [currentPageNumber]);

  useEffect(() => {
    searchOpenRef.current = searchOpen;
  }, [searchOpen]);

  useEffect(() => {
    thumbnailsOpenRef.current = thumbnailsOpen;
  }, [thumbnailsOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        savePdfToOriginalFile(viewerRef, fileHandleRef, fileUrl)
          .then((saved) => {
            if (!saved) {
              return;
            }

            setHasUnsavedChanges(false);
          })
          .catch((error) => {
            console.warn('Save cancelled or failed', error);
          });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fileUrl]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (window.innerHeight - event.clientY <= 96) {
        revealNavigation();
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });

    return () => {
      if (navigationHideTimerRef.current) {
        window.clearTimeout(navigationHideTimerRef.current);
      }
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, []);

  const viewerConfig = useMemo<PDFViewerConfig>(
    () => ({
      ...(fileUrl ? { src: fileUrl } : {}),
      worker: true,
      wasmUrl: PDFIUM_WASM_URL,
      fontFallback: {
        fonts: {},
      },
      stamp: {
        defaultLibrary: false,
        manifests: [],
      },
      tabBar: 'never',
      disabledCategories: DISABLED_VIEWER_CATEGORIES,
      theme: VIEWER_THEMES[themeIndexRef.current]?.config ?? VIEWER_THEMES[0].config,
      render: {
        defaultImageType: RENDER_IMAGE_TYPE,
      },
      tiling: {
        defaultImageType: RENDER_IMAGE_TYPE,
        tileSize: TILING_TILE_SIZE,
        overlapPx: TILING_OVERLAP_PX,
        extraRings: TILING_EXTRA_RINGS,
      },
      annotations: {
        locked: { type: LockModeType.Include, categories: ['form'] },
        tools: TEXT_MARKUP_TOOL_IDS.map((id) => ({
          id,
          behavior: { deactivateToolAfterCreate: true },
        })),
      },
    }),
    [fileUrl],
  );

  useEffect(() => {
    if (!fileUrl) {
      cleanDocumentTitleRef.current = 'PDF';
      renderDocumentTitle();
      return;
    }

    try {
      const url = new URL(fileUrl);
      const name = decodeURIComponent(url.pathname)
        .split('/')
        .filter(Boolean)
        .pop();

      cleanDocumentTitleRef.current = name || 'PDF';
      renderDocumentTitle();
    } catch {
      cleanDocumentTitleRef.current = 'PDF';
      renderDocumentTitle();
    }
  }, [fileUrl]);

  useEffect(() => {
    return () => {
      cleanupRenderDprCap();
      registryCleanupRef.current?.();
      registryCleanupRef.current = null;
    };
  }, []);

  const handleOpenSearch = (targetRegistry = registry) => {
    const documentId = targetRegistry ? getActiveDocumentId(targetRegistry) : undefined;
    const ui = targetRegistry?.getPlugin('ui')?.provides?.() as
      | {
          forDocument(documentId: string): {
            closeSidebarSlot(placement: 'left' | 'right', slot: string): void;
          };
        }
      | undefined;

    if (documentId && ui) {
      const scope = ui.forDocument(documentId);
      scope.closeSidebarSlot('right', 'main');
      scope.closeSidebarSlot('left', 'main');
    }

    searchOpenRef.current = true;
    setSearchOpen(true);
  };

  const handleSearchOpenChange = (open: boolean) => {
    searchOpenRef.current = open;
    setSearchOpen(open);
  };


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
          setTotalPages(0);
          setCurrentTitle('');
          setThumbnailsOpen(false);
          setSignaturesOpen(false);
          setColorPaletteOpen(false);
          setHasUnsavedChanges(false);
          if (navigationVisibleRef.current) {
            navigationVisibleRef.current = false;
            setNavigationVisible(false);
          }

          const refreshCurrentTitle = () => {
            const pageNumber = currentPageNumberRef.current;
            setCurrentTitle(getCurrentBookmarkTitle(outlineCacheRef.current.bookmarks, pageNumber));
          };

          titleTrackerRefreshRef.current = refreshCurrentTitle;

          const installers: Array<() => () => void> = [
            () => installBuiltInPageControlsHider(nextRegistry),
            () => installPageKeyboardNavigation(nextRegistry, revealNavigation),
            () => installBrowserZoomInterceptor(nextRegistry),
            () => installNativeToolbarDisabler(nextRegistry),
            () => installSignatureOnlyInsertCommands(nextRegistry),
            () => installAnnotationStyleCommandRedirect(nextRegistry, viewerRef.current?.container ?? null, () => setColorPaletteOpen(true)),
            () => installScrollStrategyAttribute(nextRegistry),
            () => installMiddleMousePanInterceptor(nextRegistry),
            () => installUnsavedChangesTracker(nextRegistry, setHasUnsavedChanges),
            () => installTextMarkupToolReset(nextRegistry),
            () => installCommentPanelWidth(nextRegistry),
            () => installReadingHistory(nextRegistry, fileUrl),
            () => installCurrentTitleTracker(nextRegistry, () => outlineCacheRef.current.bookmarks, ({ pageNumber, title, totalPages: nextTotalPages }) => {
                currentPageNumberRef.current = pageNumber;
                setCurrentPageNumber(pageNumber);
                setCurrentTitle(title);
                setTotalPages(nextTotalPages);
              }),
            () => installWhenIdle(() => installThemeSwitcher(
              nextRegistry,
              viewerRef.current?.container ?? null,
              themeIndexRef,
              () => setThumbnailsOpen((open) => !open),
              () => thumbnailsOpenRef.current,
            )),
            () => installWhenIdle(() => installPanelCommandRedirects(nextRegistry, searchOpenRef, handleSearchOpenChange)),
            () => installWhenIdle(() => installSearchKeyboardShortcut(() => handleOpenSearch(nextRegistry))),
            () => installWhenIdle(() => installSelectionTranslate(nextRegistry, viewerRef.current?.container ?? null)),
            () => installWhenIdle(() => installOutlinePrefetch(nextRegistry, setOutlineCache, fileUrl)),
            () => () => {
              titleTrackerRefreshRef.current = null;
            },
          ];

          const cleanups = installers.flatMap((install) => {
            try {
              return [install()];
            } catch (error) {
              console.warn('[shnctl] viewer setup step failed', error);
              return [];
            }
          });

          registryCleanupRef.current = () => {
            for (const cleanup of cleanups) {
              cleanup();
            }
          };
        }}
      />
      <ShnctlToolbar
        registry={registry}
        container={viewerRef.current?.container ?? null}
        searchOpen={searchOpen}
        thumbnailsOpen={thumbnailsOpen}
        signaturesOpen={signaturesOpen}
        colorPaletteOpen={colorPaletteOpen}
        themeIndexRef={themeIndexRef}
        onSearchOpenChange={handleSearchOpenChange}
        onToggleThumbnails={() => setThumbnailsOpen((open) => !open)}
        onOpenSignatures={() => setSignaturesOpen((open) => !open)}
        onToggleColorPalette={() => setColorPaletteOpen((open) => !open)}
      />
      <ShnctlOutline
        registry={registry}
        open={outlineOpen}
        cache={outlineCache}
        currentTitle={currentTitle}
        onCacheChange={setOutlineCache}
        onClose={() => setOutlineOpen(false)}
      />
      <ShnctlThumbnails
        registry={registry}
        open={thumbnailsOpen}
        totalPages={totalPages}
        currentPageNumber={currentPageNumber}
        onClose={() => setThumbnailsOpen(false)}
      />
      <ShnctlSignatures
        registry={registry}
        open={signaturesOpen}
        onClose={() => setSignaturesOpen(false)}
      />
      <ShnctlColorPalette
        registry={registry}
        open={colorPaletteOpen}
        onClose={() => setColorPaletteOpen(false)}
      />
      <BottomNavigationControl
        registry={registry}
        title={currentTitle}
        pageNumber={currentPageNumber}
        totalPages={totalPages}
        outlineStatus={outlineCache.status}
        visible={navigationVisible}
        onReveal={revealNavigation}
        onOpenOutline={() => setOutlineOpen(true)}
      />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
