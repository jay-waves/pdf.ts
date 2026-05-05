import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PluginRegistry } from '@embedpdf/core';
import {
  PDFViewer,
  PDFViewerConfig,
  type PDFViewerRef,
} from '@embedpdf/react-pdf-viewer';
import './viewer.css';
import {
  getActiveDocumentId,
  getInitialFileUrl
} from './utils'
import { 
  ShnctlOutline, 
  installBuiltInPageControlsHider,
  installCurrentTitleTracker,
  installOutlinePrefetch,
  installPageKeyboardNavigation,
  BottomNavigationControl,
  getCurrentBookmarkTitle,
  type OutlineCache
} from './outline'
import { 
  ShnctlSearch, 
  installSearchKeyboardShortcut,
  installPanelCommandRedirects
} from './search'
import {
  getStoredThemeIndex,
  VIEWER_THEMES,
  installThemeSwitcher
} from './theme'
import {
  installReadingHistory,
  savePdfToOriginalFile
} from './file-handle'

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
  const searchOpenRef = useRef(false);

  const revealNavigation = () => {
    setNavigationVisible(true);

    if (navigationHideTimerRef.current) {
      window.clearTimeout(navigationHideTimerRef.current);
    }

    navigationHideTimerRef.current = window.setTimeout(() => {
      setNavigationVisible(false);
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
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        savePdfToOriginalFile(viewerRef, fileHandleRef, fileUrl).catch((err) => {
          console.warn('Save cancelled or failed', err);
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
      tabBar: 'never',
      disabledCategories: ['form', 'redaction', 'panel-sidebar', 'insert', 'navigation'],
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

  const handleOpenOutline = () => {
    setOutlineOpen(true);
  };

  const handleOpenSearch = () => {
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

          const refreshCurrentTitle = () => {
            const pageNumber = currentPageNumberRef.current;
            setCurrentTitle(getCurrentBookmarkTitle(outlineCacheRef.current.bookmarks, pageNumber));
          };

          titleTrackerRefreshRef.current = refreshCurrentTitle;

          const cleanups: Array<() => void> = [
            installThemeSwitcher(nextRegistry, viewerRef.current?.container ?? null, themeIndexRef),
            installPanelCommandRedirects(nextRegistry, searchOpenRef, handleSearchOpenChange),
            installBuiltInPageControlsHider(nextRegistry),
            installPageKeyboardNavigation(nextRegistry, revealNavigation),
            installSearchKeyboardShortcut(handleOpenSearch),
            installBrowserZoomInterceptor(nextRegistry),
            installReadingHistory(nextRegistry, fileUrl),
            installOutlinePrefetch(nextRegistry, setOutlineCache),
            installCurrentTitleTracker(nextRegistry, () => outlineCacheRef.current.bookmarks, ({ pageNumber, title, totalPages: nextTotalPages }) => {
              currentPageNumberRef.current = pageNumber;
              setCurrentPageNumber(pageNumber);
              setCurrentTitle(title);
              setTotalPages(nextTotalPages);
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
      <ShnctlSearch registry={registry} open={searchOpen} onClose={() => handleSearchOpenChange(false)} />
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
