import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import { PdfErrorCode, type PdfErrorReason, type Task } from '@embedpdf/models';
import type { RenderCapability } from '@embedpdf/plugin-render';
import type { RotateCapability } from '@embedpdf/plugin-rotate';
import { RowsPhotoAlbum, type Photo } from 'react-photo-album';
import 'react-photo-album/rows.css';
import { PanelContent, PanelState } from './components';
import { getActiveDocumentId, getPluginCapability, scrollToPagePreservingViewport, type ScrollCapability } from './utils';
import styles from './thumbnails.module.css';

const THUMBNAIL_WIDTH = 150;
const THUMBNAIL_TARGET_HEIGHT = 176;
const THUMBNAIL_GAP = 10;
const THUMBNAIL_CARD_PADDING = 7;
const THUMBNAIL_CACHE_LIMIT = 64;
const THUMBNAIL_RENDER_CONCURRENCY = 2;

type DocumentPage = { index?: number; size: { width: number; height: number }; rotation?: number };
type ThumbnailPhoto = Photo & { pageIndex: number };
type ThumbnailCacheEntry = {
  state: 'queued' | 'rendering' | 'ready';
  lastUsed: number;
  task?: Task<Blob, PdfErrorReason>;
  url?: string;
};

function getTotalPages(registry: PluginRegistry | undefined, documentId: string | null, fallback: number) {
  if (fallback > 0) return fallback;

  const scroll = getPluginCapability<ScrollCapability>(registry, 'scroll');
  return documentId && scroll ? scroll.forDocument(documentId).getTotalPages() : 0;
}

function getDocumentInfo(registry: PluginRegistry, documentId: string) {
  const state = registry.getStore().getState() as {
    core: {
      documents: Record<string, {
        document?: { pages: DocumentPage[] };
        rotation?: number;
      }>;
    };
  };
  const documentState = state.core.documents[documentId];

  return {
    pages: documentState?.document?.pages ?? [],
    rotation: documentState?.rotation ?? 0,
  };
}

function getThumbnailPhoto(
  page: DocumentPage | undefined,
  pageIndex: number,
  documentRotation: number,
): ThumbnailPhoto {
  const rotated = (((page?.rotation ?? 0) + documentRotation) % 2) === 1;
  const pageWidth = rotated ? page?.size.height : page?.size.width;
  const pageHeight = rotated ? page?.size.width : page?.size.height;

  return {
    src: `pdf-thumbnail-${pageIndex + 1}`,
    width: pageWidth && pageWidth > 0 ? pageWidth : 1,
    height: pageHeight && pageHeight > 0 ? pageHeight : Math.SQRT2,
    key: String(pageIndex),
    pageIndex,
  };
}

class ThumbnailRenderCache {
  private readonly entries = new Map<number, ThumbnailCacheEntry>();
  private readonly queue: number[] = [];
  private visiblePages = new Set<number>();
  private activeRenders = 0;
  private accessTick = 0;
  private disposed = false;

  constructor(
    private readonly registry: PluginRegistry,
    private readonly documentId: string,
    private readonly pages: DocumentPage[],
    private readonly documentRotation: number,
    private readonly onChange: () => void,
  ) {}

  setVisiblePages(pageIndexes: Set<number>) {
    const wantedPages = [...pageIndexes]
      .filter((pageIndex) => this.pages[pageIndex])
      .sort((left, right) => left - right)
      .slice(0, THUMBNAIL_CACHE_LIMIT);
    this.visiblePages = new Set(wantedPages);

    for (const [pageIndex, entry] of this.entries) {
      if (!this.visiblePages.has(pageIndex) && entry.state !== 'ready') {
        this.remove(pageIndex, 'Thumbnail left the render window');
      }
    }

    for (const pageIndex of wantedPages) this.request(pageIndex);
    this.evict();
    this.pump();
  }

  getUrl(pageIndex: number) {
    return this.entries.get(pageIndex)?.url;
  }

  dispose() {
    this.disposed = true;
    for (const pageIndex of [...this.entries.keys()]) {
      this.remove(pageIndex, 'Thumbnail cache disposed');
    }
    this.queue.length = 0;
  }

  private request(pageIndex: number) {
    const existing = this.entries.get(pageIndex);
    if (existing) {
      existing.lastUsed = ++this.accessTick;
      return;
    }

    this.entries.set(pageIndex, { state: 'queued', lastUsed: ++this.accessTick });
    this.queue.push(pageIndex);
  }

  private pump() {
    if (this.disposed) return;

    while (this.activeRenders < THUMBNAIL_RENDER_CONCURRENCY && this.queue.length) {
      const pageIndex = this.queue.shift()!;
      const entry = this.entries.get(pageIndex);
      const page = this.pages[pageIndex];
      if (!entry || entry.state !== 'queued' || !this.visiblePages.has(pageIndex) || !page) continue;

      const render = getPluginCapability<RenderCapability>(this.registry, 'render');
      if (!render) {
        this.entries.delete(pageIndex);
        continue;
      }

      const task = render.forDocument(this.documentId).renderPageRect({
        pageIndex: page.index ?? pageIndex,
        rect: { origin: { x: 0, y: 0 }, size: page.size },
        options: {
          scaleFactor: THUMBNAIL_WIDTH / page.size.width,
          dpr: Math.min(window.devicePixelRatio || 1, 2),
          rotation: ((page.rotation ?? 0) + this.documentRotation) % 4,
        },
      });
      entry.state = 'rendering';
      entry.task = task;
      this.activeRenders += 1;

      task.wait(
        (blob) => this.finish(pageIndex, entry, blob),
        () => this.finish(pageIndex, entry),
      );
    }
  }

  private finish(pageIndex: number, entry: ThumbnailCacheEntry, blob?: Blob) {
    this.activeRenders = Math.max(0, this.activeRenders - 1);
    if (this.disposed || this.entries.get(pageIndex) !== entry) {
      this.pump();
      return;
    }

    if (blob) {
      entry.state = 'ready';
      entry.task = undefined;
      entry.url = URL.createObjectURL(blob);
      entry.lastUsed = ++this.accessTick;
    } else {
      this.entries.delete(pageIndex);
    }
    this.evict();
    this.onChange();
    this.pump();
  }

  private evict() {
    while (this.entries.size > THUMBNAIL_CACHE_LIMIT) {
      const readyEntries = [...this.entries]
        .filter(([, entry]) => entry.state === 'ready')
        .sort((left, right) => left[1].lastUsed - right[1].lastUsed);
      const candidate = readyEntries.find(([pageIndex]) => !this.visiblePages.has(pageIndex)) ?? readyEntries[0];
      if (!candidate) break;
      this.remove(candidate[0], 'Thumbnail evicted from LRU cache');
    }
  }

  private remove(pageIndex: number, reason: string) {
    const entry = this.entries.get(pageIndex);
    if (!entry) return;
    this.entries.delete(pageIndex);
    if (entry.url) URL.revokeObjectURL(entry.url);
    entry.task?.abort({ code: PdfErrorCode.Cancelled, message: reason });
  }
}

function ThumbnailFlow({
  registry,
  documentId,
  pageCount,
  currentPageNumber,
  onClose,
}: {
  registry: PluginRegistry;
  documentId: string;
  pageCount: number;
  currentPageNumber: number;
  onClose: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const currentPageIndex = Math.min(Math.max(0, currentPageNumber - 1), pageCount - 1);
  const [, setRotationRevision] = useState(0);
  const { pages, rotation: documentRotation } = getDocumentInfo(registry, documentId);
  const photos = useMemo(
    () => Array.from(
      { length: pageCount },
      (_, pageIndex) => getThumbnailPhoto(pages[pageIndex], pageIndex, documentRotation),
    ),
    [documentRotation, pageCount, pages],
  );
  const [, setCacheRevision] = useState(0);
  const cache = useMemo(
    () => new ThumbnailRenderCache(registry, documentId, pages, documentRotation, () => setCacheRevision((value) => value + 1)),
    [documentId, documentRotation, pages, registry],
  );

  useEffect(() => () => cache.dispose(), [cache]);
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const visiblePages = new Set<number>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const pageIndex = Number((entry.target as HTMLElement).dataset.thumbnailPageIndex);
        if (!Number.isInteger(pageIndex)) continue;
        if (entry.isIntersecting) visiblePages.add(pageIndex);
        else visiblePages.delete(pageIndex);
      }
      cache.setVisiblePages(visiblePages);
    }, { root, rootMargin: '320px 0px' });
    const observeThumbnails = () => {
      root.querySelectorAll<HTMLElement>('[data-thumbnail-page-index]').forEach((element) => {
        observer.observe(element);
      });
    };
    observeThumbnails();
    const mutationObserver = new MutationObserver(observeThumbnails);
    mutationObserver.observe(root, { childList: true, subtree: true });

    return () => {
      mutationObserver.disconnect();
      observer.disconnect();
    };
  }, [cache]);
  useEffect(() => {
    const rotate = getPluginCapability<RotateCapability>(registry, 'rotate');
    return rotate?.forDocument(documentId).onRotateChange(() => setRotationRevision((value) => value + 1));
  }, [documentId, registry]);

  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    let frame = 0;
    let attempts = 0;
    const scrollToCurrentThumbnail = () => {
      const current = root.querySelector<HTMLElement>(
        `[data-thumbnail-page-index="${currentPageIndex}"]`,
      );
      if (current) {
        root.scrollTop += current.getBoundingClientRect().top - root.getBoundingClientRect().top;
      } else if (attempts < 10) {
        attempts += 1;
        frame = requestAnimationFrame(scrollToCurrentThumbnail);
      }
    };
    scrollToCurrentThumbnail();
    return () => cancelAnimationFrame(frame);
  }, [currentPageIndex, photos]);

  return (
    <div className="h-full overflow-y-auto" ref={scrollRef}>
      <RowsPhotoAlbum<ThumbnailPhoto>
        photos={photos}
        spacing={THUMBNAIL_GAP}
        padding={THUMBNAIL_CARD_PADDING}
        targetRowHeight={THUMBNAIL_TARGET_HEIGHT}
        componentsProps={{
          track: { style: { justifyContent: 'flex-start', gap: THUMBNAIL_GAP } },
        }}
        onClick={({ photo }) => {
          scrollToPagePreservingViewport(registry, photo.pageIndex + 1);
          onClose();
        }}
        render={{
          photo: ({ onClick }, { photo, height }) => {
            const pageNumber = photo.pageIndex + 1;
            const thumbnailUrl = cache.getUrl(photo.pageIndex);
            const frameHeight = Math.min(height, THUMBNAIL_TARGET_HEIGHT);
            const frameWidth = frameHeight * photo.width / photo.height;
            return (
              <button
                type="button"
                className={`${styles.card} group`}
                data-thumbnail-page-index={photo.pageIndex}
                data-current={pageNumber === currentPageNumber ? 'true' : undefined}
                aria-label={`Page ${pageNumber}`}
                style={{ width: frameWidth + THUMBNAIL_CARD_PADDING * 2 }}
                onClick={onClick}
              >
                <span
                  className="block w-full overflow-hidden rounded border border-border-subtle bg-input"
                  style={{ aspectRatio: photo.width / photo.height }}
                >
                  {thumbnailUrl ? (
                    <img
                      src={thumbnailUrl}
                      alt=""
                      draggable={false}
                      className="size-full object-contain"
                    />
                  ) : null}
                </span>
                <span className="mt-1 block text-muted tabular-nums group-data-[current=true]:text-accent">{pageNumber}</span>
              </button>
            );
          },
        }}
      />
    </div>
  );
}

export function Thumbnails({
  registry,
  open,
  totalPages,
  currentPageNumber,
  onClose,
}: {
  registry: PluginRegistry | undefined;
  open: boolean;
  totalPages: number;
  currentPageNumber: number;
  onClose: () => void;
}) {
  const documentId = registry ? getActiveDocumentId(registry) : null;
  const pageCount = getTotalPages(registry, documentId, totalPages);

  return (
    <PanelContent overflow="hidden" hidden={!open}>
      {open && registry && documentId && pageCount > 0 ? (
        <ThumbnailFlow
          registry={registry}
          documentId={documentId}
          pageCount={pageCount}
          currentPageNumber={currentPageNumber}
          onClose={onClose}
        />
      ) : open ? (
        <PanelState>No pages available.</PanelState>
      ) : null}
    </PanelContent>
  );
}
