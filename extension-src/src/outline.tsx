// outline + nagivation bar

import { 
    useEffect, 
    useMemo, 
    useRef,
    useState,
    type FormEvent
} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { PluginRegistry } from '@embedpdf/core';
import {
  CornerDownLeft,
  CornerUpRight,
} from 'lucide-react';
import {
  PdfZoomMode,
  type PdfBookmarkObject,
} from '@embedpdf/models';
import {
  type BookmarkCapability,
  type UICapability,
} from '@embedpdf/react-pdf-viewer';
import './viewer.css';
import {
    getActiveDocumentId,
    getDestinationFromTarget,
    type ScrollCapability,
} from './utils'

const EMPTY_CLEANUP = () => {};
const outlinePrefetchCache = new Map<string, OutlineCache>();

export type OutlineStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
export type OutlineCache = {
  status: OutlineStatus;
  bookmarks: PdfBookmarkObject[];
};

function toOutlineCache(bookmarks: PdfBookmarkObject[]): OutlineCache {
  return {
    status: bookmarks.length ? 'ready' : 'empty',
    bookmarks,
  };
}

type FlattenedBookmark = {
  title: string;
  pageNumber: number;
};

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
}

function requestPageNavigation(registry: PluginRegistry, direction: 1 | -1, behavior: 'instant' | 'smooth' | 'auto' = 'smooth') {
  const documentId = getActiveDocumentId(registry);
  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;

  if (!documentId || !scroll) {
    return;
  }

  const scrollScope = scroll.forDocument(documentId);
  const currentPage = scrollScope.getCurrentPage();
  const nextPage = currentPage + direction;

  if (nextPage < 1 || nextPage > scrollScope.getTotalPages()) {
    return;
  }

  const metrics = scrollScope.getMetrics();
  const currentPageMetric =
    metrics.pageVisibilityMetrics.find((metric) => metric.pageNumber === currentPage) ??
    metrics.pageVisibilityMetrics[0];

  scrollScope.scrollToPage({
    pageNumber: nextPage,
    pageCoordinates: currentPageMetric
      ? {
          x: currentPageMetric.original.pageX,
          y: currentPageMetric.original.pageY,
        }
      : undefined,
    behavior,
  });
}

export function installPageKeyboardNavigation(registry: PluginRegistry, onNavigate: () => void) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    if (isEditableKeyboardTarget(event.target)) {
      return;
    }

    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    requestPageNavigation(registry, event.key === 'ArrowLeft' ? -1 : 1);
    onNavigate();
  };

  window.addEventListener('keydown', onKeyDown, { capture: true });

  return () => {
    window.removeEventListener('keydown', onKeyDown, { capture: true });
  };
}


export function installBuiltInPageControlsHider(registry: PluginRegistry) {
  const ui = registry.getPlugin('ui')?.provides?.() as UICapability | undefined;
  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;

  if (!ui || !scroll) {
    return EMPTY_CLEANUP;
  }

  const hidePageControls = (documentId?: string | null) => {
    if (!documentId) {
      return;
    }

    ui.disableOverlay('page-controls', documentId);
  };

  hidePageControls(getActiveDocumentId(registry));

  const unsubscribeLayoutReady = scroll.onLayoutReady((event) => {
    hidePageControls(event.documentId);
  });

  return () => {
    unsubscribeLayoutReady();
  };
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

export function getCurrentBookmarkTitle(bookmarks: PdfBookmarkObject[], pageNumber: number) {
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

export function installCurrentTitleTracker(
  registry: PluginRegistry,
  getBookmarks: () => PdfBookmarkObject[],
  onChange: (value: { pageNumber: number; title: string; totalPages: number }) => void,
) {
  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  if (!scroll) {
    return EMPTY_CLEANUP;
  }

  let currentPageNumber = 1;
  let totalPages = 0;

  const refresh = () => {
    const title = getCurrentBookmarkTitle(getBookmarks(), currentPageNumber);
    onChange({
      pageNumber: currentPageNumber,
      title,
      totalPages,
    });
  };

  const unsubscribePageChange = scroll.onPageChange((event) => {
    currentPageNumber = event.pageNumber;
    totalPages = event.totalPages;
    refresh();
  });

  const unsubscribeLayoutReady = scroll.onLayoutReady((event) => {
    currentPageNumber = scroll.forDocument(event.documentId).getCurrentPage();
    totalPages = event.totalPages || scroll.forDocument(event.documentId).getTotalPages();
    refresh();
  });

  refresh();

  return () => {
    unsubscribePageChange();
    unsubscribeLayoutReady();
  };
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

export function installOutlinePrefetch(
  registry: PluginRegistry,
  onLoaded: (cache: OutlineCache) => void,
  cacheKey?: string,
) {
  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  if (!scroll) {
    onLoaded({ status: 'error', bookmarks: [] });
    return EMPTY_CLEANUP;
  }

  const cached = cacheKey ? outlinePrefetchCache.get(cacheKey) : undefined;
  if (cached) {
    onLoaded(cached);
    return EMPTY_CLEANUP;
  }

  let loadingDocumentId: string | null = null;
  let loadedDocumentId: string | null = null;
  let cancelled = false;

  const loadForDocument = (documentId: string) => {
    if (cancelled || loadingDocumentId === documentId || loadedDocumentId === documentId) {
      return;
    }

    loadingDocumentId = documentId;
    onLoaded({ status: 'loading', bookmarks: [] });

    loadOutlineCache(registry)
      .then((cache) => {
        if (cancelled) {
          return;
        }

        loadingDocumentId = null;
        loadedDocumentId = documentId;

        if (cacheKey && (cache.status === 'ready' || cache.status === 'empty')) {
          outlinePrefetchCache.set(cacheKey, cache);
        }

        onLoaded(cache);
      })
      .catch((error) => {
        loadingDocumentId = null;
        console.error('[shnctl] outline prefetch failed after initial layout', {
          documentId,
          error,
        });
        if (!cancelled) {
          onLoaded({ status: 'error', bookmarks: [] });
        }
      });
  };

  const unsubscribeLayoutReady = scroll.onLayoutReady((event) => {
    if (!event.isInitial) {
      return;
    }

    loadForDocument(event.documentId);
  });

  const documentId = getActiveDocumentId(registry);
  if (documentId) {
    window.setTimeout(() => loadForDocument(documentId), 300);
  }

  return () => {
    cancelled = true;
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

export function ShnctlOutline({
  registry,
  open,
  cache,
  currentTitle,
  onCacheChange,
  onClose,
}: {
  registry?: PluginRegistry;
  open: boolean;
  cache: OutlineCache;
  currentTitle: string;
  onCacheChange: (cache: OutlineCache) => void;
  onClose: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!open || cache.status !== 'ready') {
      return;
    }

    scrollCurrentBookmarkIntoView(contentRef.current);
  }, [cache.status, currentTitle, open]);

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
        currentTitle={currentTitle}
        level={0}
        onSelect={(bookmark) => {
          if (registry) {
            scrollToBookmark(registry, bookmark);
          }
        }}
      />
    );
  }, [cache.bookmarks, cache.status, currentTitle, registry]);

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="shnctl-overlay" />
        <Dialog.Content className="shnctl-panel" aria-describedby={undefined}>
          <Dialog.Title className="shnctl-visually-hidden">PDF Outline</Dialog.Title>
          <div className="shnctl-content" ref={contentRef}>{body}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function BookmarkList({
  bookmarks,
  currentTitle,
  level,
  onSelect,
}: {
  bookmarks: PdfBookmarkObject[];
  currentTitle: string;
  level: number;
  onSelect: (bookmark: PdfBookmarkObject) => void;
}) {
  const normalizedCurrentTitle = currentTitle.trim();

  return (
    <ol className="shnctl-list">
      {bookmarks.map((bookmark, index) => {
        const destination = getDestinationFromTarget(bookmark.target);
        const pageNumber = destination ? destination.pageIndex + 1 : undefined;
        const children = bookmark.children ?? [];
        const title = bookmark.title || `Item ${index + 1}`;
        const bookmarkKey = `${level}-${index}-${title}`;
        const isCurrent = normalizedCurrentTitle.length > 0 && title.trim() === normalizedCurrentTitle;
        const hasCurrentChild = containsBookmarkTitle(children, normalizedCurrentTitle);

        if (children.length && level === 0) {
          return (
            <li key={bookmarkKey} className="shnctl-item">
              <details className="shnctl-details" open={isCurrent || hasCurrentChild}>
                <summary className="shnctl-bookmark shnctl-summary" data-current={isCurrent ? 'true' : undefined}>
                  <span className="shnctl-bookmark-title">{title}</span>
                  {pageNumber ? <span className="shnctl-bookmark-page">{pageNumber}</span> : null}
                </summary>
                <BookmarkList bookmarks={children} currentTitle={currentTitle} level={level + 1} onSelect={onSelect} />
              </details>
            </li>
          );
        }

        return (
          <li key={bookmarkKey} className="shnctl-item">
            <button
              type="button"
              className="shnctl-bookmark"
              data-current={isCurrent ? 'true' : undefined}
              style={{ marginLeft: `${level * 18}px`, width: `calc(100% - ${level * 18}px)` }}
              onClick={() => onSelect(bookmark)}
              disabled={!destination}
            >
              <span className="shnctl-bookmark-title">{title}</span>
              {pageNumber ? <span className="shnctl-bookmark-page">{pageNumber}</span> : null}
            </button>
            {children.length ? (
              <BookmarkList bookmarks={children} currentTitle={currentTitle} level={level + 1} onSelect={onSelect} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function containsBookmarkTitle(bookmarks: PdfBookmarkObject[], title: string): boolean {
  if (!title) {
    return false;
  }

  return bookmarks.some((bookmark) => bookmark.title?.trim() === title || containsBookmarkTitle(bookmark.children ?? [], title));
}

function scrollCurrentBookmarkIntoView(root: HTMLElement | null) {
  if (!root) {
    return;
  }

  const scrollToCurrent = () => {
    const currentBookmark = root.querySelector<HTMLElement>('.shnctl-bookmark[data-current="true"]');
    if (!currentBookmark) {
      root.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }

    const rootRect = root.getBoundingClientRect();
    const bookmarkRect = currentBookmark.getBoundingClientRect();
    if (!rootRect.height || !bookmarkRect.height) {
      return;
    }

    const centeredDelta = bookmarkRect.top - rootRect.top - root.clientHeight / 2 + bookmarkRect.height / 2;
    root.scrollTo({
      top: Math.max(0, root.scrollTop + centeredDelta),
      behavior: 'smooth',
    });
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollToCurrent();
      window.setTimeout(scrollToCurrent, 80);
    });
  });
}

export function BottomNavigationControl({
  registry,
  title,
  pageNumber,
  totalPages,
  outlineStatus,
  visible,
  onReveal,
  onOpenOutline,
}: {
  registry?: PluginRegistry;
  title: string;
  pageNumber: number;
  totalPages: number;
  outlineStatus: OutlineStatus;
  visible: boolean;
  onReveal: () => void;
  onOpenOutline: () => void;
}) {
  const [pageInput, setPageInput] = useState(String(pageNumber || 1));
  const canNavigate = Boolean(registry && totalPages > 0);
  const canGoPrevious = canNavigate && pageNumber > 1;
  const canGoNext = canNavigate && pageNumber < totalPages;
  const outlineTitle = title.trim();
  const shouldShowOutlineTitle = outlineStatus === 'ready' && outlineTitle.length > 0;
  useEffect(() => {
    setPageInput(String(pageNumber || 1));
  }, [pageNumber]);

  const scrollToPage = (nextPageNumber: number) => {
    onReveal();

    if (!registry || !totalPages) {
      return;
    }

    const documentId = getActiveDocumentId(registry);
    const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
    if (!documentId || !scroll) {
      return;
    }

    const clampedPageNumber = Math.min(Math.max(1, nextPageNumber), totalPages);
    scroll.forDocument(documentId).scrollToPage({
      pageNumber: clampedPageNumber,
      behavior: 'smooth',
    });
    setPageInput(String(clampedPageNumber));
  };

  const handlePageSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextPageNumber = Number.parseInt(pageInput, 10);
    if (!Number.isFinite(nextPageNumber)) {
      setPageInput(String(pageNumber || 1));
      return;
    }

    scrollToPage(nextPageNumber);
  };

  const scrollByPage = (direction: -1 | 1) => {
    onReveal();

    if (!registry) {
      return;
    }

    requestPageNavigation(registry, direction);
  };

  return (
    <nav
      className={`shnctl-bottom-nav${visible ? ' is-visible' : ''}`}
      aria-label="PDF navigation"
      onMouseEnter={onReveal}
      onFocus={onReveal}
    >
      <div className="shnctl-bottom-nav-actions">
        <button
          type="button"
          className="shnctl-bottom-nav-button"
          onClick={() => scrollByPage(-1)}
          disabled={!canGoPrevious}
          aria-label="Previous page"
        >
          <CornerDownLeft size={20} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="shnctl-bottom-nav-button"
          onClick={() => scrollByPage(1)}
          disabled={!canGoNext}
          aria-label="Next page"
        >
          <CornerUpRight size={20} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      <div className="shnctl-bottom-nav-meta">
        {shouldShowOutlineTitle ? (
          <button
            type="button"
            className="shnctl-bottom-nav-outline"
            title={outlineTitle}
            onClick={() => {
              onReveal();
              onOpenOutline();
            }}
          >
            <span className="shnctl-bottom-nav-title">{outlineTitle}</span>
          </button>
        ) : null}
        <form className="shnctl-bottom-nav-page" onSubmit={handlePageSubmit} aria-label="Page jump">
          <input
            className="shnctl-bottom-nav-page-input"
            value={pageInput}
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label="Current page"
            disabled={!canNavigate}
            onChange={(event) => setPageInput(event.currentTarget.value)}
            onFocus={onReveal}
            onBlur={() => setPageInput(String(pageNumber || 1))}
          />
          <span className="shnctl-bottom-nav-page-total">/ {totalPages || '-'}</span>
        </form>
      </div>
    </nav>
  );
}
