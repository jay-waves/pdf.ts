import { useEffect, useRef, useState } from 'react';
import {
  PdfZoomMode,
  type PdfBookmarkObject,
} from '@embedpdf/models';
import { PanelContent, PanelState } from '../components';
import type { PdfRuntime } from '../renderer/pdf-engine';
import type { PdfScroll } from '../renderer/pdf-scroll';
import { getDestinationFromTarget } from '../shared/utils';
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

  const sorted = flattened.toSorted((left, right) => {
    if (left.pageNumber !== right.pageNumber) {
      return left.pageNumber - right.pageNumber;
    }

    return left.title.localeCompare(right.title, 'zh-CN');
  });

  flattenedBookmarksCache.set(bookmarks, sorted);
  return sorted;
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
  scroll: PdfScroll,
  onChange: (value: { pageNumber: number; totalPages: number }) => void,
) {
  let currentPageNumber = 1;
  let totalPages = 0;

  const refresh = () => {
    onChange({
      pageNumber: currentPageNumber,
      totalPages,
    });
  };

  const unsubscribePageChange = scroll.onPageChange((pageNumber, pageCount) => {
    currentPageNumber = pageNumber;
    totalPages = pageCount;
    refresh();
  });

  const unsubscribeLayoutReady = scroll.onLayoutReady((pageCount) => {
    currentPageNumber = scroll.getCurrentPage();
    totalPages = pageCount || scroll.getTotalPages();
    refresh();
  });

  refresh();

  return () => {
    unsubscribePageChange();
    unsubscribeLayoutReady();
  };
}

function isCurrentLoadedDocument(pdfium: PdfRuntime, documentId: string) {
  return Boolean(pdfium.getDocument(documentId));
}

async function loadOutline(pdfium: PdfRuntime, documentId: string) {
  if (!isCurrentLoadedDocument(pdfium, documentId)) {
    return { status: 'empty', bookmarks: [] } satisfies OutlineCache;
  }

  const task = pdfium.withDocument(documentId, (engine, document) => (
    engine.getBookmarks(document)
  ));
  const { bookmarks } = await task.toPromise();
  return {
    status: bookmarks.length ? 'ready' : 'empty',
    bookmarks,
  } satisfies OutlineCache;
}

export function installOutlinePrefetch(
  pdfium: PdfRuntime,
  {
    documentId,
    scroll,
    cacheKey,
    onLoaded,
  }: {
    documentId: string;
    scroll: PdfScroll;
    cacheKey?: string;
    onLoaded(cache: OutlineCache): void;
  },
) {
  const cached = cacheKey ? outlinePrefetchCache.get(cacheKey) : undefined;
  if (cached) {
    onLoaded(cached);
    return;
  }

  let requestedDocumentId: string | null = null;
  let cancelled = false;

  const loadForDocument = (documentId: string) => {
    if (
      cancelled ||
      !isCurrentLoadedDocument(pdfium, documentId) ||
      requestedDocumentId === documentId
    ) {
      return;
    }

    requestedDocumentId = documentId;
    onLoaded({ status: 'loading', bookmarks: [] });

    loadOutline(pdfium, documentId)
      .then((cache) => {
        if (cancelled || !isCurrentLoadedDocument(pdfium, documentId)) {
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
        if (cancelled || !isCurrentLoadedDocument(pdfium, documentId)) {
          return;
        }
        console.error('[pdf-ts] outline prefetch failed after initial layout', {
          documentId,
          error,
        });
        onLoaded({ status: 'error', bookmarks: [] });
      });
  };

  const unsubscribeLayoutReady = scroll.onLayoutReady((_totalPages, initial) => {
    if (!initial) return;
    loadForDocument(documentId);
  });

  loadForDocument(documentId);

  return () => {
    cancelled = true;
    unsubscribeLayoutReady();
  };
}

function scrollToBookmark(scroll: PdfScroll, bookmark: PdfBookmarkObject) {
  const destination = getDestinationFromTarget(bookmark.target);
  if (!destination) {
    return;
  }

  const xyzZoom = destination.zoom.mode === PdfZoomMode.XYZ ? destination.zoom : undefined;
  scroll.goToPosition(
    destination.pageIndex,
    xyzZoom ? { x: xyzZoom.params.x, y: xyzZoom.params.y } : undefined,
  );
}

export function Outline({
  pdfium,
  documentId,
  scroll,
  cache,
  currentBookmarkKey,
  onCacheChange,
}: {
  pdfium: PdfRuntime;
  documentId?: string | null;
  scroll?: PdfScroll | null;
  cache: OutlineCache;
  currentBookmarkKey: string;
  onCacheChange: (cache: OutlineCache) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const retriedOnOpenRef = useRef(false);
  const [selectedBookmarkKey, setSelectedBookmarkKey] = useState(currentBookmarkKey);
  const [expandedBookmarkKeys, setExpandedBookmarkKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setSelectedBookmarkKey(currentBookmarkKey);
  }, [currentBookmarkKey]);

  useEffect(() => {
    setExpandedBookmarkKeys(new Set());
  }, [cache.bookmarks]);

  useEffect(() => {
    if (!documentId || cache.status !== 'error' || retriedOnOpenRef.current) {
      return;
    }

    retriedOnOpenRef.current = true;
    let cancelled = false;
    onCacheChange({ status: 'loading', bookmarks: [] });

    loadOutline(pdfium, documentId)
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
  }, [cache.status, documentId, onCacheChange, pdfium]);

  useEffect(() => {
    if (cache.status !== 'ready') {
      return;
    }

    scrollCurrentBookmarkIntoView(contentRef.current);
  }, [cache.status, selectedBookmarkKey]);

  const renderBody = () => {
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
          if (!scroll) return;

          const isExpanded = expandedBookmarkKeys.has(bookmarkKey);
          const destination = getDestinationFromTarget(bookmark.target);

          if (hasChildren && !isExpanded) {
            setExpandedBookmarkKeys((current) => {
              const next = new Set(current);
              next.add(bookmarkKey);
              return next;
            });
            return;
          }

          if (hasChildren && selectedBookmarkKey === bookmarkKey) {
            setExpandedBookmarkKeys((current) => {
              const next = new Set(current);
              next.delete(bookmarkKey);
              return next;
            });
            return;
          }

          if (!destination) {
            return;
          }

          setSelectedBookmarkKey(bookmarkKey);
          scrollToBookmark(scroll, bookmark);
        }}
      />
    );
  };

  return (
    <PanelContent ref={contentRef}>
      {renderBody()}
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
