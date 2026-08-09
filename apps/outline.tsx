import { useEffect, useMemo, useRef, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import {
  PdfZoomMode,
  type PdfBookmarkObject,
} from '@embedpdf/models';
import {
  type BookmarkCapability,
} from '@embedpdf/plugin-bookmark';
import { PanelContent, PanelState } from './components';
import {
  EMPTY_CLEANUP,
  getActiveDocumentId,
  getDestinationFromTarget,
  getPluginCapability,
  type ScrollCapability,
} from './utils';
import styles from './outline.module.css';

const outlinePrefetchCache = new Map<string, OutlineCache>();
const flattenedBookmarksCache = new WeakMap<PdfBookmarkObject[], FlattenedBookmark[]>();
const OUTLINE_CACHE_LIMIT = 4;

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

function cacheOutline(key: string, cache: OutlineCache) {
  if (!outlinePrefetchCache.has(key) && outlinePrefetchCache.size >= OUTLINE_CACHE_LIMIT) {
    const oldestKey = outlinePrefetchCache.keys().next().value;
    if (oldestKey !== undefined) outlinePrefetchCache.delete(oldestKey);
  }
  outlinePrefetchCache.set(key, cache);
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
  let low = 0;
  let high = flattened.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (flattened[middle].pageNumber <= pageNumber) low = middle + 1;
    else high = middle;
  }
  const current = flattened[low - 1];
  return current ? { key: current.key, title: current.title } : null;
}

export function installPageTracker(
  registry: PluginRegistry,
  onChange: (value: { pageNumber: number; totalPages: number }) => void,
) {
  const scroll = getPluginCapability<ScrollCapability>(registry, 'scroll');
  if (!scroll) {
    return EMPTY_CLEANUP;
  }

  let currentPageNumber = 1;
  let totalPages = 0;

  const refresh = () => {
    onChange({
      pageNumber: currentPageNumber,
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

async function loadOutline(registry: PluginRegistry, documentId?: string) {
  return toOutlineCache(await loadBookmarks(registry, documentId));
}

export function installOutlinePrefetch(
  registry: PluginRegistry,
  {
    cacheKey,
    onLoaded,
  }: {
    cacheKey?: string;
    onLoaded(cache: OutlineCache): void;
  },
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

  let requestedDocumentId: string | null = null;
  let cancelled = false;

  const loadForDocument = (documentId: string) => {
    if (
      cancelled ||
      !isCurrentLoadedDocument(registry, documentId) ||
      requestedDocumentId === documentId
    ) {
      return;
    }

    requestedDocumentId = documentId;
    onLoaded({ status: 'loading', bookmarks: [] });

    loadOutline(registry, documentId)
      .then((cache) => {
        if (cancelled || !isCurrentLoadedDocument(registry, documentId)) {
          requestedDocumentId = null;
          return;
        }

        if (cacheKey && (cache.status === 'ready' || cache.status === 'empty')) {
          cacheOutline(cacheKey, cache);
        }

        onLoaded(cache);
      })
      .catch((error) => {
        requestedDocumentId = null;
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
  const [navigatedBookmarkKey, setNavigatedBookmarkKey] = useState(currentBookmarkKey);

  useEffect(() => {
    setSelectedBookmarkKey(currentBookmarkKey);
    setNavigatedBookmarkKey(currentBookmarkKey);
    setExpandedBookmarkKeys((current) => {
      const next = new Set(current);
      getAncestorBookmarkKeys(currentBookmarkKey).forEach((key) => next.add(key));
      return next;
    });
  }, [currentBookmarkKey]);

  useEffect(() => {
    setSelectedBookmarkKey(currentBookmarkKey);
    setExpandedBookmarkKeys(new Set(getAncestorBookmarkKeys(currentBookmarkKey)));
    setNavigatedBookmarkKey(currentBookmarkKey);
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

    loadOutline(registry)
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
          const destination = getDestinationFromTarget(bookmark.target);

          if (hasChildren && isExpanded && navigatedBookmarkKey === bookmarkKey) {
            setExpandedBookmarkKeys((current) => {
              const next = new Set(current);
              next.delete(bookmarkKey);
              return next;
            });
            setSelectedBookmarkKey(bookmarkKey);
            return;
          }

          if (hasChildren && (!isExpanded || selectedBookmarkKey !== bookmarkKey)) {
            setExpandedBookmarkKeys((current) => new Set(current).add(bookmarkKey));
            setSelectedBookmarkKey(bookmarkKey);
            if (navigatedBookmarkKey !== bookmarkKey) {
              setNavigatedBookmarkKey('');
            }
            return;
          }

          if (!destination) {
            return;
          }

          setSelectedBookmarkKey(bookmarkKey);
          setNavigatedBookmarkKey(hasChildren ? bookmarkKey : '');
          scrollToBookmark(registry, bookmark);
        }}
      />
    );
  }, [
    cache.bookmarks,
    cache.status,
    expandedBookmarkKeys,
    navigatedBookmarkKey,
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
