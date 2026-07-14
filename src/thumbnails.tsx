import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { PluginRegistry } from '@embedpdf/core';
import { PdfErrorCode, type PdfErrorReason, type Task } from '@embedpdf/models';
import type { RenderCapability } from '@embedpdf/plugin-render';
import type { RotateCapability } from '@embedpdf/plugin-rotate';
import { getActiveDocumentId, type ScrollCapability } from './utils';

const THUMBNAILS_PER_GROUP = 4;
const THUMBNAIL_WIDTH = 150;
const THUMBNAIL_OBSERVER_MARGIN = '320px 0px';
const THUMBNAIL_CACHE_LIMIT = 32;
const THUMBNAIL_RENDER_CONCURRENCY = 2;

type DocumentPage = { index?: number; size: { width: number; height: number }; rotation?: number };
type ThumbnailMeta = { pageIndex: number; width: number; height: number };
type ThumbnailCacheEntry = {
  state: 'queued' | 'rendering' | 'ready';
  lastUsed: number;
  task?: Task<Blob, PdfErrorReason>;
  url?: string;
};

function getTotalPages(registry: PluginRegistry | undefined, documentId: string | null, fallback: number) {
  if (fallback > 0) return fallback;

  const scroll = registry?.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
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

function getThumbnailMeta(pageIndex: number, page: DocumentPage | undefined, documentRotation: number): ThumbnailMeta {
  const rotated = (((page?.rotation ?? 0) + documentRotation) % 2) === 1;
  const pageWidth = rotated ? page?.size.height : page?.size.width;
  const pageHeight = rotated ? page?.size.width : page?.size.height;
  const height = pageWidth && pageHeight
    ? Math.round(THUMBNAIL_WIDTH * pageHeight / pageWidth)
    : Math.round(THUMBNAIL_WIDTH * Math.SQRT2);

  return {
    pageIndex,
    width: THUMBNAIL_WIDTH,
    height,
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

      const render = this.registry.getPlugin('render')?.provides?.() as RenderCapability | undefined;
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

function scrollToPage(registry: PluginRegistry, pageNumber: number) {
  const documentId = getActiveDocumentId(registry);
  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  if (!documentId || !scroll) return;

  scroll.forDocument(documentId).scrollToPage({ pageNumber, behavior: 'smooth' });
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
  const currentPageIndex = Math.min(Math.max(0, currentPageNumber - 1), Math.max(0, pageCount - 1));
  const initialRowStart = Math.floor(currentPageIndex / THUMBNAILS_PER_GROUP) * THUMBNAILS_PER_GROUP;
  const [visiblePages, setVisiblePages] = useState<Set<number>>(() => new Set(
    Array.from(
      { length: Math.min(THUMBNAILS_PER_GROUP, pageCount - initialRowStart) },
      (_, index) => initialRowStart + index,
    ),
  ));
  const [, setRotationRevision] = useState(0);
  const { pages, rotation: documentRotation } = getDocumentInfo(registry, documentId);
  const metas = useMemo(
    () => Array.from({ length: pageCount }, (_, pageIndex) => getThumbnailMeta(pageIndex, pages[pageIndex], documentRotation)),
    [documentRotation, pageCount, pages],
  );
  const [, setCacheRevision] = useState(0);
  const cache = useMemo(
    () => new ThumbnailRenderCache(registry, documentId, pages, documentRotation, () => setCacheRevision((value) => value + 1)),
    [documentId, documentRotation, pages, registry],
  );

  useEffect(() => () => cache.dispose(), [cache]);
  useEffect(() => cache.setVisiblePages(visiblePages), [cache, visiblePages]);
  useEffect(() => {
    const rotate = registry.getPlugin('rotate')?.provides?.() as RotateCapability | undefined;
    return rotate?.forDocument(documentId).onRotateChange(() => setRotationRevision((value) => value + 1));
  }, [documentId, registry]);

  useLayoutEffect(() => {
    const root = scrollRef.current;
    const current = root?.querySelector<HTMLElement>(`[data-thumbnail-page-index="${currentPageIndex}"]`);
    if (root && current) root.scrollTop = current.offsetTop - root.offsetTop;
  }, [currentPageIndex]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    const observer = new IntersectionObserver((entries) => {
      setVisiblePages((previous) => {
        const next = new Set(previous);
        let changed = false;

        for (const entry of entries) {
          const pageIndex = Number((entry.target as HTMLElement).dataset.thumbnailPageIndex);
          if (!Number.isInteger(pageIndex)) continue;

          if (entry.isIntersecting && !next.has(pageIndex)) {
            next.add(pageIndex);
            changed = true;
          } else if (!entry.isIntersecting && next.delete(pageIndex)) {
            changed = true;
          }
        }

        return changed ? next : previous;
      });
    }, { root, rootMargin: THUMBNAIL_OBSERVER_MARGIN });

    root.querySelectorAll<HTMLElement>('[data-thumbnail-page-index]').forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="shnctl-thumbnail-scroll" ref={scrollRef}>
      <div className="shnctl-thumbnail-grid">
        {metas.map((meta, pageIndex) => {
          const pageNumber = pageIndex + 1;

          return (
            <button
              key={pageIndex}
              type="button"
              className="shnctl-action shnctl-thumbnail"
              data-thumbnail-page-index={pageIndex}
              data-current={pageNumber === currentPageNumber ? 'true' : undefined}
              aria-label={`Page ${pageNumber}`}
              onClick={() => {
                scrollToPage(registry, pageNumber);
                onClose();
              }}
            >
              <span className="shnctl-thumbnail-frame" style={{ height: Math.min(meta.height, 220) }}>
                {cache.getUrl(pageIndex) ? (
                  <img
                    src={cache.getUrl(pageIndex)}
                    draggable={false}
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                ) : null}
              </span>
              <span className="shnctl-thumbnail-label">{pageNumber}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ShnctlThumbnails({
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
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="shnctl-overlay" />
        <Dialog.Content className="shnctl-panel shnctl-thumbnail-panel" aria-describedby={undefined}>
          <Dialog.Title className="shnctl-visually-hidden">PDF Thumbnails</Dialog.Title>
          <div className="shnctl-content shnctl-thumbnail-content">
            {registry && documentId && pageCount > 0 ? (
              <ThumbnailFlow
                registry={registry}
                documentId={documentId}
                pageCount={pageCount}
                currentPageNumber={currentPageNumber}
                onClose={onClose}
              />
            ) : (
              <div className="shnctl-state">No pages available.</div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
