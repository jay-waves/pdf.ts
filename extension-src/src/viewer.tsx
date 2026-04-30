import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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

const READING_HISTORY_KEY = 'embedpdf-reading-history-v1';
const SCROLL_ANCHOR_FIX_STYLE_ID = 'shnctl-scroll-anchor-fix';

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
    return () => {};
  }

  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  if (!scroll) {
    return () => {};
  }

  let restoredDocumentId: string | null = null;
  let pendingPageNumber = 0;
  let pendingWriteId = 0;
  let beforeUnloadCleanup: (() => void) | null = null;

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
  beforeUnloadCleanup = () => window.removeEventListener('beforeunload', onBeforeUnload);

  return () => {
    if (pendingWriteId) {
      window.clearTimeout(pendingWriteId);
      flushPendingWrite();
    }
    beforeUnloadCleanup?.();
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
    return () => {};
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

function installOutlinePrefetch(
  registry: PluginRegistry,
  onLoaded: (cache: OutlineCache) => void,
) {
  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  if (!scroll) {
    onLoaded({ status: 'error', bookmarks: [] });
    return () => {};
  }

  let loadedDocumentId: string | null = null;

  const unsubscribeLayoutReady = scroll.onLayoutReady((event) => {
    if (!event.isInitial || loadedDocumentId === event.documentId) {
      return;
    }

    loadedDocumentId = event.documentId;
    onLoaded({ status: 'loading', bookmarks: [] });

    loadBookmarks(registry)
      .then((bookmarks) => {
        onLoaded({
          status: bookmarks.length ? 'ready' : 'empty',
          bookmarks,
        });
      })
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


    // Cache Bookmarks
    let cancelled = false;
    onCacheChange({ status: 'loading', bookmarks: [] });

    loadBookmarks(registry)
      .then((nextBookmarks) => {
        if (cancelled) {
          return;
        }
        onCacheChange({
          status: nextBookmarks.length ? 'ready' : 'empty',
          bookmarks: nextBookmarks,
        });
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
  return (
    <button
      type="button"
      className="shnctl-current-title"
      title={title || 'No matching outline entry for the current page'}
      onClick={onOpenOutline}
      onPointerDown={onPointerDown}
      style={position ? { left: `${position.x}px`, top: `${position.y}px`, right: 'auto' } : undefined}
    >
      <span className="shnctl-current-title-label">Current section</span>
      <span className="shnctl-current-title-text">{title || 'No matching outline entry for the current page'}</span>
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
  const registryCleanupRef = useRef<(() => void) | null>(null);
  const badgeRef = useRef<HTMLButtonElement | null>(null);
  const outlineCacheRef = useRef(outlineCache);
  const currentPageNumberRef = useRef(1);
  const titleTrackerRefreshRef = useRef<(() => void) | null>(null);
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
      theme: {
        preference: 'system',
      },
      scroll: {
        defaultBufferSize: 1,
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
    // Parse File URL to Title Bar
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

    // icon 
    // let icon = document.querySelector<HTMLLinkElement>("link[rel~='icon']");

    // if (!icon) {
    //   icon = document.createElement("link");
    //   icon.rel = "icon";
    //   document.head.appendChild(icon);
    // }

    // icon.type = "image/png";
    // icon.href = chrome.runtime.getURL("logo.png");

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
