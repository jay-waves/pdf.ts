import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import {
  BookImage,
  CornerDownLeft,
  CornerUpRight,
  ListTree,
} from 'lucide-react';
import {
  PdfZoomMode,
  type PdfBookmarkObject,
} from '@embedpdf/models';
import {
  type BookmarkCapability,
} from '@embedpdf/plugin-bookmark';
import { FloatingSurface, PanelContent, PanelState } from './components';
import {
  EMPTY_CLEANUP,
  getActiveDocumentId,
  getDestinationFromTarget,
  getPluginCapability,
  isEditableTarget,
  scrollToPagePreservingViewport,
  type ScrollCapability,
} from './utils';
import styles from './outline.module.css';

const outlinePrefetchCache = new Map<string, OutlineCache>();
const flattenedBookmarksCache = new WeakMap<PdfBookmarkObject[], FlattenedBookmark[]>();
const SIDE_BUTTON_LONG_PRESS_MS = 450;

type OutlineStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
export type OutlineCache = {
  status: OutlineStatus;
  bookmarks: PdfBookmarkObject[];
};
type FlattenedBookmark = {
  key: string;
  title: string;
  pageNumber: number;
};
type CurrentBookmark = Pick<FlattenedBookmark, 'key' | 'title'>;

function toOutlineCache(bookmarks: PdfBookmarkObject[]): OutlineCache {
  return {
    status: bookmarks.length ? 'ready' : 'empty',
    bookmarks,
  };
}

function requestPageNavigation(registry: PluginRegistry, direction: 1 | -1, pageCount = 1) {
  const documentId = getActiveDocumentId(registry);
  const scroll = getPluginCapability<ScrollCapability>(registry, 'scroll');

  if (!documentId || !scroll) {
    return;
  }

  const scrollScope = scroll.forDocument(documentId);
  const currentPage = scrollScope.getCurrentPage();
  const targetPage = Math.min(
    Math.max(1, currentPage + direction * pageCount),
    scrollScope.getTotalPages(),
  );
  if (targetPage === currentPage) {
    return;
  }

  scrollToPagePreservingViewport(registry, targetPage, 'smooth');
}

export function installPageKeyboardNavigation(registry: PluginRegistry, onNavigate: () => void) {
  let sideButtonPress: { button: 3 | 4; startedAt: number } | null = null;

  const navigate = (direction: -1 | 1, pageCount = 1) => {
    requestPageNavigation(registry, direction, pageCount);
    onNavigate();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    if (isEditableTarget(event.target)) {
      return;
    }

    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    navigate(event.key === 'ArrowLeft' ? -1 : 1);
  };

  const stopSideButtonEvent = (event: MouseEvent | PointerEvent) => {
    if (event.button !== 3 && event.button !== 4) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onSideButtonDown = (event: MouseEvent) => {
    stopSideButtonEvent(event);
    if (event.button !== 3 && event.button !== 4) return;
    sideButtonPress = { button: event.button, startedAt: performance.now() };
  };

  const onSideButtonUp = (event: MouseEvent) => {
    if (event.button !== 3 && event.button !== 4) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    const duration = sideButtonPress?.button === event.button
      ? performance.now() - sideButtonPress.startedAt
      : 0;
    sideButtonPress = null;
    navigate(event.button === 3 ? -1 : 1, duration >= SIDE_BUTTON_LONG_PRESS_MS ? 2 : 1);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!(event.buttons & 24)) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const clearSideButtonPress = () => {
    sideButtonPress = null;
  };

  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('mousedown', onSideButtonDown, { capture: true });
  window.addEventListener('mouseup', onSideButtonUp, { capture: true });
  window.addEventListener('pointermove', onPointerMove, { capture: true });
  window.addEventListener('auxclick', stopSideButtonEvent, { capture: true });
  window.addEventListener('blur', clearSideButtonPress);

  return () => {
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    window.removeEventListener('mousedown', onSideButtonDown, { capture: true });
    window.removeEventListener('mouseup', onSideButtonUp, { capture: true });
    window.removeEventListener('pointermove', onPointerMove, { capture: true });
    window.removeEventListener('auxclick', stopSideButtonEvent, { capture: true });
    window.removeEventListener('blur', clearSideButtonPress);
  };
}

function flattenBookmarks(bookmarks: PdfBookmarkObject[]) {
  const cached = flattenedBookmarksCache.get(bookmarks);
  if (cached) return cached;

  const flattened: FlattenedBookmark[] = [];

  const walk = (items: PdfBookmarkObject[], parentPath: number[] = []) => {
    items.forEach((item, index) => {
      const destination = getDestinationFromTarget(item.target);
      const title = item.title?.trim();
      const path = [...parentPath, index];

      if (destination && title) {
        flattened.push({
          key: path.join('.'),
          title,
          pageNumber: destination.pageIndex + 1,
        });
      }

      if (item.children?.length) {
        walk(item.children, path);
      }
    });
  };

  walk(bookmarks);

  flattened.sort((left, right) => {
    if (left.pageNumber !== right.pageNumber) {
      return left.pageNumber - right.pageNumber;
    }

    return left.title.localeCompare(right.title, 'zh-CN');
  });

  flattenedBookmarksCache.set(bookmarks, flattened);
  return flattened;
}

export function getCurrentBookmark(bookmarks: PdfBookmarkObject[], pageNumber: number): CurrentBookmark | null {
  if (pageNumber < 1) {
    return null;
  }

  const flattened = flattenBookmarks(bookmarks);
  let currentBookmark: CurrentBookmark | null = null;

  for (const item of flattened) {
    if (item.pageNumber > pageNumber) {
      break;
    }

    currentBookmark = { key: item.key, title: item.title };
  }

  return currentBookmark;
}

export function installCurrentTitleTracker(
  registry: PluginRegistry,
  getBookmarks: () => PdfBookmarkObject[],
  onChange: (value: { pageNumber: number; bookmarkKey: string; title: string; totalPages: number }) => void,
) {
  const scroll = getPluginCapability<ScrollCapability>(registry, 'scroll');
  if (!scroll) {
    return EMPTY_CLEANUP;
  }

  let currentPageNumber = 1;
  let totalPages = 0;

  const refresh = () => {
    const currentBookmark = getCurrentBookmark(getBookmarks(), currentPageNumber);
    onChange({
      pageNumber: currentPageNumber,
      bookmarkKey: currentBookmark?.key ?? '',
      title: currentBookmark?.title ?? '',
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

function isCurrentLoadedDocument(registry: PluginRegistry, documentId: string) {
  const state = registry.getStore().getState();
  return state.core.activeDocumentId === documentId && Boolean(state.core.documents[documentId]?.document);
}

async function loadBookmarks(registry: PluginRegistry, requestedDocumentId?: string) {
  const documentId = requestedDocumentId ?? getActiveDocumentId(registry);
  const bookmark = getPluginCapability<BookmarkCapability>(registry, 'bookmark');

  if (!bookmark) {
    throw new Error('Bookmark plugin is not available.');
  }

  if (!documentId || !isCurrentLoadedDocument(registry, documentId)) {
    return [];
  }

  return (await bookmark.forDocument(documentId).getBookmarks().toPromise()).bookmarks;
}

export function installOutlinePrefetch(
  registry: PluginRegistry,
  onLoaded: (cache: OutlineCache) => void,
  cacheKey?: string,
) {
  const scroll = getPluginCapability<ScrollCapability>(registry, 'scroll');
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
    if (
      cancelled ||
      !isCurrentLoadedDocument(registry, documentId) ||
      loadingDocumentId === documentId ||
      loadedDocumentId === documentId
    ) {
      return;
    }

    loadingDocumentId = documentId;
    onLoaded({ status: 'loading', bookmarks: [] });

    loadBookmarks(registry, documentId)
      .then(toOutlineCache)
      .then((cache) => {
        if (cancelled || !isCurrentLoadedDocument(registry, documentId)) {
          loadingDocumentId = null;
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
        if (cancelled || !isCurrentLoadedDocument(registry, documentId)) {
          return;
        }
        console.error('[pdf-ts] outline prefetch failed after initial layout', {
          documentId,
          error,
        });
        onLoaded({ status: 'error', bookmarks: [] });
      });
  };

  const unsubscribeLayoutReady = scroll.onLayoutReady((event) => {
    if (!event.isInitial) {
      return;
    }

    loadForDocument(event.documentId);
  });

  const documentId = getActiveDocumentId(registry);
  if (documentId) loadForDocument(documentId);

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
  const scroll = getPluginCapability<ScrollCapability>(registry, 'scroll');
  if (!documentId || !scroll) {
    return;
  }

  const xyzZoom = destination.zoom.mode === PdfZoomMode.XYZ ? destination.zoom : undefined;
  scroll.forDocument(documentId).scrollToPage({
    pageNumber: destination.pageIndex + 1,
    pageCoordinates: xyzZoom ? { x: xyzZoom.params.x, y: xyzZoom.params.y } : undefined,
    behavior: 'instant',
  });
}

function getCurrentPageNumber(registry: PluginRegistry) {
  const documentId = getActiveDocumentId(registry);
  const scroll = getPluginCapability<ScrollCapability>(registry, 'scroll');
  return documentId && scroll ? scroll.forDocument(documentId).getCurrentPage() : undefined;
}

function getAncestorBookmarkKeys(bookmarkKey: string) {
  const parts = bookmarkKey.split('.');
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('.'));
}

export function Outline({
  registry,
  open,
  cache,
  currentBookmarkKey,
  onCacheChange,
}: {
  registry?: PluginRegistry;
  open: boolean;
  cache: OutlineCache;
  currentBookmarkKey: string;
  onCacheChange: (cache: OutlineCache) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const retriedOnOpenRef = useRef(false);
  const [selectedBookmarkKey, setSelectedBookmarkKey] = useState(currentBookmarkKey);
  const [expandedBookmarkKeys, setExpandedBookmarkKeys] = useState<Set<string>>(
    () => new Set(getAncestorBookmarkKeys(currentBookmarkKey)),
  );
  const [lastNavigatedBookmarkKey, setLastNavigatedBookmarkKey] = useState('');

  useEffect(() => {
    setSelectedBookmarkKey(currentBookmarkKey);
    setExpandedBookmarkKeys((current) => {
      const next = new Set(current);
      getAncestorBookmarkKeys(currentBookmarkKey).forEach((key) => next.add(key));
      return next;
    });
  }, [currentBookmarkKey]);

  useEffect(() => {
    setSelectedBookmarkKey(currentBookmarkKey);
    setExpandedBookmarkKeys(new Set(getAncestorBookmarkKeys(currentBookmarkKey)));
    setLastNavigatedBookmarkKey('');
  }, [cache.bookmarks]);

  useEffect(() => {
    if (!open) {
      retriedOnOpenRef.current = false;
      return;
    }
    if (!registry || cache.status !== 'error' || retriedOnOpenRef.current) {
      return;
    }

    retriedOnOpenRef.current = true;
    let cancelled = false;
    onCacheChange({ status: 'loading', bookmarks: [] });

    loadBookmarks(registry)
      .then(toOutlineCache)
      .then((nextCache) => {
        if (cancelled) {
          return;
        }
        onCacheChange(nextCache);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('[pdf-ts] outline retry failed when panel opened', {
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
  }, [cache.status, open, selectedBookmarkKey]);

  const body = useMemo(() => {
    if (cache.status === 'idle' || cache.status === 'loading') {
      return <PanelState className="text-[11px]">Loading outline...</PanelState>;
    }

    if (cache.status === 'empty') {
      return <PanelState className="text-[11px]">This PDF does not include an outline.</PanelState>;
    }

    if (cache.status === 'error') {
      return <PanelState className="text-[11px]">Failed to load the outline.</PanelState>;
    }

    return (
      <BookmarkList
        bookmarks={cache.bookmarks}
        selectedBookmarkKey={selectedBookmarkKey}
        expandedBookmarkKeys={expandedBookmarkKeys}
        path={[]}
        onSelect={(bookmark, bookmarkKey, hasChildren) => {
          if (!registry) return;

          const isExpanded = expandedBookmarkKeys.has(bookmarkKey);
          if (hasChildren && !isExpanded) {
            setExpandedBookmarkKeys((current) => new Set(current).add(bookmarkKey));
            setSelectedBookmarkKey(bookmarkKey);
            setLastNavigatedBookmarkKey('');
            return;
          }

          const destination = getDestinationFromTarget(bookmark.target);
          if (
            hasChildren
            && lastNavigatedBookmarkKey === bookmarkKey
            && destination?.pageIndex !== undefined
            && getCurrentPageNumber(registry) === destination.pageIndex + 1
          ) {
            setExpandedBookmarkKeys((current) => {
              const next = new Set(current);
              next.delete(bookmarkKey);
              return next;
            });
            setSelectedBookmarkKey(bookmarkKey);
            setLastNavigatedBookmarkKey('');
            return;
          }

          if (!destination) {
            if (hasChildren) {
              setExpandedBookmarkKeys((current) => {
                const next = new Set(current);
                next.delete(bookmarkKey);
                return next;
              });
            }
            return;
          }

          setSelectedBookmarkKey(bookmarkKey);
          setLastNavigatedBookmarkKey(bookmarkKey);
          scrollToBookmark(registry, bookmark);
        }}
      />
    );
  }, [
    cache.bookmarks,
    cache.status,
    expandedBookmarkKeys,
    lastNavigatedBookmarkKey,
    registry,
    selectedBookmarkKey,
  ]);

  return (
    <PanelContent overflow="hidden" hidden={!open}>
      <div ref={contentRef} className="h-full overflow-y-auto">{body}</div>
    </PanelContent>
  );
}

function BookmarkList({
  bookmarks,
  selectedBookmarkKey,
  expandedBookmarkKeys,
  path,
  onSelect,
}: {
  bookmarks: PdfBookmarkObject[];
  selectedBookmarkKey: string;
  expandedBookmarkKeys: Set<string>;
  path: number[];
  onSelect: (bookmark: PdfBookmarkObject, bookmarkKey: string, hasChildren: boolean) => void;
}) {
  return (
    <ol className={path.length ? styles.nestedList : styles.list}>
      {bookmarks.map((bookmark, index) => {
        const destination = getDestinationFromTarget(bookmark.target);
        const pageNumber = destination ? destination.pageIndex + 1 : undefined;
        const children = bookmark.children ?? [];
        const title = bookmark.title || `Item ${index + 1}`;
        const bookmarkPath = [...path, index];
        const bookmarkKey = bookmarkPath.join('.');
        const isCurrent = selectedBookmarkKey.length > 0 && bookmarkKey === selectedBookmarkKey;

        if (children.length) {
          return (
            <li key={bookmarkKey}>
              <details open={expandedBookmarkKeys.has(bookmarkKey)}>
                <summary
                  className={styles.bookmark}
                  data-outline-bookmark
                  data-current={isCurrent ? 'true' : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    onSelect(bookmark, bookmarkKey, true);
                  }}
                >
                  <span className={styles.title}>{title}</span>
                  {pageNumber ? <span className={styles.page}>{pageNumber}</span> : null}
                </summary>
                <BookmarkList
                  bookmarks={children}
                  selectedBookmarkKey={selectedBookmarkKey}
                  expandedBookmarkKeys={expandedBookmarkKeys}
                  path={bookmarkPath}
                  onSelect={onSelect}
                />
              </details>
            </li>
          );
        }

        return (
          <li key={bookmarkKey}>
            <button
              type="button"
              className={styles.bookmark}
              data-outline-bookmark
              data-current={isCurrent ? 'true' : undefined}
              style={{ marginLeft: `${path.length * 18}px`, width: `calc(100% - ${path.length * 18}px)` }}
              onClick={() => onSelect(bookmark, bookmarkKey, false)}
              disabled={!destination}
            >
              <span className={styles.title}>{title}</span>
              {pageNumber ? <span className={styles.page}>{pageNumber}</span> : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function scrollCurrentBookmarkIntoView(root: HTMLElement | null) {
  if (!root) {
    return;
  }

  const scrollToCurrent = () => {
    const currentBookmark = root.querySelector<HTMLElement>('[data-outline-bookmark][data-current="true"]');
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

  requestAnimationFrame(scrollToCurrent);
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
  onOpenThumbnails,
}: {
  registry?: PluginRegistry;
  title: string;
  pageNumber: number;
  totalPages: number;
  outlineStatus: OutlineStatus;
  visible: boolean;
  onReveal: () => void;
  onOpenOutline: () => void;
  onOpenThumbnails: () => void;
}) {
  const [pageInput, setPageInput] = useState(String(pageNumber || 1));
  const canNavigate = Boolean(registry && totalPages > 0);
  const canGoPrevious = canNavigate && pageNumber > 1;
  const canGoNext = canNavigate && pageNumber < totalPages;
  const outlineTitle = title.trim();
  const shouldShowOutlineTitle = outlineStatus === 'ready' && outlineTitle.length > 0;
  const shouldShowThumbnails = outlineStatus === 'empty';
  useEffect(() => {
    setPageInput(String(pageNumber || 1));
  }, [pageNumber]);

  const scrollToPage = (nextPageNumber: number) => {
    onReveal();

    if (!registry || !totalPages) {
      return;
    }

    const clampedPageNumber = Math.min(Math.max(1, nextPageNumber), totalPages);
    scrollToPagePreservingViewport(registry, clampedPageNumber);
    setPageInput(String(clampedPageNumber));
  };

  const handlePageSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextPageNumber = Number(pageInput);
    if (!Number.isInteger(nextPageNumber)) {
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
    <FloatingSurface
      as="nav"
      className={styles.navigation}
      data-visible={visible ? 'true' : undefined}
      aria-label="PDF navigation"
      onMouseEnter={onReveal}
      onFocus={onReveal}
    >
      <div className={styles.navigationButtons}>
        <button
          type="button"
          className={styles.navigationButton}
          onClick={() => scrollByPage(-1)}
          disabled={!canGoPrevious}
          aria-label="Previous page"
        >
          <CornerDownLeft size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.navigationButton}
          onClick={() => scrollByPage(1)}
          disabled={!canGoNext}
          aria-label="Next page"
        >
          <CornerUpRight size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.navigationContent}>
        {shouldShowOutlineTitle ? (
          <button
            type="button"
            className={styles.outlineButton}
            aria-label="Open outline"
            onClick={() => {
              onReveal();
              onOpenOutline();
            }}
          >
            <ListTree className={styles.navigationTitleIcon} size={14} strokeWidth={1.8} aria-hidden="true" />
            <span className={styles.navigationTitle}>{outlineTitle}</span>
          </button>
        ) : shouldShowThumbnails ? (
          <button
            type="button"
            className={`${styles.outlineButton} ${styles.thumbnailButton}`}
            title="Open thumbnails"
            aria-label="Open thumbnails"
            onClick={() => {
              onReveal();
              onOpenThumbnails();
            }}
          >
            <BookImage className="block flex-none" size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
        ) : null}
        <form className={styles.pageForm} onSubmit={handlePageSubmit} aria-label="Page jump">
          <input
            className={styles.pageInput}
            value={pageInput}
            type="text"
            inputMode="numeric"
            enterKeyHint="go"
            required
            aria-label="Current page"
            disabled={!canNavigate}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (/^\d*$/.test(value)) setPageInput(value);
            }}
            onFocus={onReveal}
            onBlur={() => setPageInput(String(pageNumber || 1))}
          />
          <span className={styles.pageTotal}>/ {totalPages || '-'}</span>
        </form>
      </div>
    </FloatingSurface>
  );
}
