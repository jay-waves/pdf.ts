import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PluginRegistry } from '@embedpdf/core';
import pdfiumWasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import {
  type AnnotationCapability,
  type CommandsCapability,
  type PanCapability,
  PDFViewer,
  PDFViewerConfig,
  type PDFViewerRef,
} from '@embedpdf/react-pdf-viewer';
import './viewer.css';
import { getActiveDocumentId, getInitialFileUrl, runWhenIdle, type ScrollCapability } from './utils';
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
  ShnctlSearch,
  installPanelCommandRedirects,
  installSearchKeyboardShortcut,
} from './search';
import {
  getStoredThemeIndex,
  VIEWER_THEMES,
  installThemeSwitcher,
  setSearchOpenAttribute,
} from './theme';
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

interface ZoomAnchor {
  documentId: string;
  pageNumber: number;
  pageCoordinates?: { x: number; y: number };
}

const MAX_RENDER_DPR = 1.5;
const RENDER_IMAGE_TYPE = 'image/bmp';
const TILING_TILE_SIZE = 768;
const TILING_OVERLAP_PX = 2;
const TILING_EXTRA_RINGS = 0;
const EMPTY_CLEANUP = () => {};
const PDFIUM_WASM_URL = new URL(pdfiumWasmUrl, location.href).href;
const DISABLED_VIEWER_CATEGORIES = [
  'attachment',
  'document-capture',
  'form',
  'fullscreen',
  'insert',
  'panel-sidebar',
  'redaction',
  'signature',
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

function installTextMarkupViewReset(registry: PluginRegistry) {
  const annotation = registry.getPlugin('annotation')?.provides?.() as AnnotationCapability | undefined;
  const commands = registry.getPlugin('commands')?.provides?.() as CommandsCapability | undefined;

  if (!annotation || !commands) {
    return EMPTY_CLEANUP;
  }

  return annotation.onAnnotationEvent((event) => {
    const activeToolId = annotation.forDocument(event.documentId).getActiveTool()?.id;
    if (event.type === 'create' && activeToolId && ['highlight', 'underline', 'strikeout', 'squiggly'].includes(activeToolId)) {
      requestAnimationFrame(() => commands.execute('mode:view', event.documentId, 'api'));
    }
  });
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

function getCurrentZoomAnchor(registry: PluginRegistry): ZoomAnchor | null {
  const documentId = getActiveDocumentId(registry);
  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;

  if (!documentId || !scroll) {
    return null;
  }

  const scrollScope = scroll.forDocument(documentId);
  const pageNumber = scrollScope.getCurrentPage();
  const metrics = scrollScope.getMetrics();
  const pageMetric =
    metrics.pageVisibilityMetrics.find((metric) => metric.pageNumber === pageNumber) ??
    metrics.pageVisibilityMetrics[0];
  const viewport = registry.getPlugin('viewport')?.provides?.() as { getViewportGap(): number } | undefined;

  return {
    documentId,
    pageNumber,
    pageCoordinates: pageMetric
      ? {
          x: pageMetric.original.pageX,
          y: pageMetric.original.pageY - (viewport?.getViewportGap() ?? 0) / (pageMetric.scaled.scale || 1),
        }
      : undefined,
  };
}

function restoreZoomAnchor(registry: PluginRegistry, anchor: ZoomAnchor) {
  if (getActiveDocumentId(registry) !== anchor.documentId) {
    return;
  }

  // TODO: track upstream EmbedPDF zoom/virtual-scroll anchor handling and remove this workaround when fixed.
  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  scroll?.forDocument(anchor.documentId).scrollToPage({
    pageNumber: anchor.pageNumber,
    pageCoordinates: anchor.pageCoordinates,
    behavior: 'instant',
  });
}

function requestPdfZoom(registry: PluginRegistry, direction: 1 | -1, event?: WheelEvent | KeyboardEvent) {
  const documentId = getActiveDocumentId(registry);
  const zoom = registry.getPlugin('zoom')?.provides?.() as ZoomCapability | undefined;

  if (!documentId || !zoom) {
    return null;
  }

  const anchor = getCurrentZoomAnchor(registry);
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
  let zoomRestoreAnchor: ZoomAnchor | null = null;
  let zoomRestoreTimer = 0;

  const scheduleZoomAnchorRestore = (anchor: ZoomAnchor | null) => {
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

      if (!nextAnchor) {
        return;
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => restoreZoomAnchor(registry, nextAnchor));
      });
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
      const anchor = getCurrentZoomAnchor(registry);

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

function installNativeContextMenuBlocker() {
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };

  window.addEventListener('contextmenu', onContextMenu, { capture: true });

  return () => {
    window.removeEventListener('contextmenu', onContextMenu, { capture: true });
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
  const themeIndexRef = useRef(getStoredThemeIndex());
  const navigationHideTimerRef = useRef<number>(0);
  const navigationVisibleRef = useRef(false);
  const searchOpenRef = useRef(false);

  const setHasUnsavedChanges = (dirty: boolean) => {
    document.title = dirty ? `*${document.title.replace(/^\*/, '')}` : document.title.replace(/^\*/, '');
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
    setSearchOpenAttribute(searchOpen);

    return () => {
      setSearchOpenAttribute(false);
    };
  }, [searchOpen]);

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
      cleanupRenderDprCap();
      registryCleanupRef.current?.();
      registryCleanupRef.current = null;
    };
  }, []);

  const handleOpenOutline = () => {
    setOutlineOpen(true);
  };

  const handleOpenSearch = (targetRegistry = registry) => {
    const documentId = targetRegistry ? getActiveDocumentId(targetRegistry) : undefined;
    const ui = targetRegistry?.getPlugin('ui')?.provides?.() as
      | {
          forDocument(documentId: string): {
            closeSidebarSlot(placement: 'left' | 'right', slot: string): void;
            setActiveToolbar(placement: 'top', slot: 'main' | 'secondary', toolbarId: string): void;
          };
        }
      | undefined;

    if (documentId && ui) {
      const scope = ui.forDocument(documentId);
      scope.closeSidebarSlot('right', 'main');
      scope.closeSidebarSlot('left', 'main');

      requestAnimationFrame(() => {
        scope.setActiveToolbar('top', 'main', 'main-toolbar');
      });
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
            installNativeContextMenuBlocker,
            () => installMiddleMousePanInterceptor(nextRegistry),
            () => installTextMarkupViewReset(nextRegistry),
            () => installUnsavedChangesTracker(nextRegistry, setHasUnsavedChanges),
            () => installReadingHistory(nextRegistry, fileUrl),
            () => installCurrentTitleTracker(nextRegistry, () => outlineCacheRef.current.bookmarks, ({ pageNumber, title, totalPages: nextTotalPages }) => {
                currentPageNumberRef.current = pageNumber;
                setCurrentPageNumber(pageNumber);
                setCurrentTitle(title);
                setTotalPages(nextTotalPages);
              }),
            () => installWhenIdle(() => installThemeSwitcher(nextRegistry, viewerRef.current?.container ?? null, themeIndexRef)),
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
      <ShnctlOutline
        registry={registry}
        open={outlineOpen}
        cache={outlineCache}
        currentTitle={currentTitle}
        onCacheChange={setOutlineCache}
        onClose={() => setOutlineOpen(false)}
      />
      <ShnctlSearch registry={registry} open={searchOpen} />
      <BottomNavigationControl
        registry={registry}
        title={currentTitle}
        pageNumber={currentPageNumber}
        totalPages={totalPages}
        outlineStatus={outlineCache.status}
        visible={navigationVisible}
        onReveal={revealNavigation}
        onOpenOutline={handleOpenOutline}
      />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
