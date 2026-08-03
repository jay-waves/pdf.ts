import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import { PdfErrorCode, type PdfErrorReason, type Task } from '@embedpdf/models';
import type { RenderCapability } from '@embedpdf/plugin-render';
import type { RotateCapability } from '@embedpdf/plugin-rotate';
import { PanelContent, PanelState } from './components';
import { getActiveDocumentId, getPluginCapability, scrollToPagePreservingViewport, type ScrollCapability } from './utils';
import styles from './thumbnails.module.css';

const THUMBNAIL_RENDER_HEIGHT = 112;
const THUMBNAIL_RENDER_CONCURRENCY = 2;

type DocumentPage = { index?: number; size: { width: number; height: number }; rotation?: number };
type ThumbnailItem = { pageIndex: number; aspectRatio: number };
type ThumbnailRenderEntry = {
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

function getThumbnailItem(
  page: DocumentPage | undefined,
  pageIndex: number,
  documentRotation: number,
): ThumbnailItem {
  const quarterTurn = ((page?.rotation ?? 0) + documentRotation) % 2 === 1;
  const width = quarterTurn ? page?.size.height : page?.size.width;
  const height = quarterTurn ? page?.size.width : page?.size.height;
  return {
    pageIndex,
    aspectRatio: width && height && width > 0 && height > 0 ? width / height : 1 / Math.SQRT2,
  };
}

class ThumbnailRenderWindow {
  private readonly entries = new Map<number, ThumbnailRenderEntry>();
  private readonly queue: number[] = [];
  private visiblePages = new Set<number>();
  private activeRenders = 0;
  private disposed = false;

  constructor(
    private readonly registry: PluginRegistry,
    private readonly documentId: string,
    private readonly pages: DocumentPage[],
    private readonly documentRotation: number,
    private readonly onChange: () => void,
  ) {}

  setVisiblePages(pageIndexes: Set<number>) {
    this.visiblePages = new Set(
      [...pageIndexes].filter((pageIndex) => this.pages[pageIndex]),
    );

    for (const pageIndex of this.entries.keys()) {
      if (!this.visiblePages.has(pageIndex)) this.remove(pageIndex, 'Thumbnail left the render window');
    }

    for (const pageIndex of this.visiblePages) this.request(pageIndex);
    this.pump();
  }

  getUrl(pageIndex: number) {
    return this.entries.get(pageIndex)?.url;
  }

  dispose() {
    this.disposed = true;
    for (const pageIndex of this.entries.keys()) {
      this.remove(pageIndex, 'Thumbnail cache disposed');
    }
    this.queue.length = 0;
  }

  private request(pageIndex: number) {
    if (this.entries.has(pageIndex)) return;

    this.entries.set(pageIndex, {});
    this.queue.push(pageIndex);
  }

  private pump() {
    if (this.disposed) return;

    while (this.activeRenders < THUMBNAIL_RENDER_CONCURRENCY && this.queue.length) {
      const pageIndex = this.queue.shift()!;
      const entry = this.entries.get(pageIndex);
      const page = this.pages[pageIndex];
      if (!entry || entry.task || entry.url || !this.visiblePages.has(pageIndex) || !page) continue;

      const render = getPluginCapability<RenderCapability>(this.registry, 'render');
      if (!render) {
        this.entries.delete(pageIndex);
        continue;
      }

      const rotation = ((page.rotation ?? 0) + this.documentRotation) % 4;
      const rotatedHeight = rotation % 2 === 1 ? page.size.width : page.size.height;
      const task = render.forDocument(this.documentId).renderPageRect({
        pageIndex: page.index ?? pageIndex,
        rect: { origin: { x: 0, y: 0 }, size: page.size },
        options: {
          scaleFactor: THUMBNAIL_RENDER_HEIGHT / rotatedHeight,
          dpr: Math.min(window.devicePixelRatio || 1, 1.5),
          rotation,
        },
      });
      entry.task = task;
      this.activeRenders += 1;

      task.wait(
        (blob) => this.finish(pageIndex, entry, blob),
        () => this.finish(pageIndex, entry),
      );
    }
  }

  private finish(pageIndex: number, entry: ThumbnailRenderEntry, blob?: Blob) {
    this.activeRenders = Math.max(0, this.activeRenders - 1);
    if (this.disposed || this.entries.get(pageIndex) !== entry) {
      this.pump();
      return;
    }

    if (blob) {
      entry.task = undefined;
      entry.url = URL.createObjectURL(blob);
    } else {
      this.entries.delete(pageIndex);
    }
    this.onChange();
    this.pump();
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
  const [rotationRevision, setRotationRevision] = useState(0);
  const { pages, rotation: documentRotation } = getDocumentInfo(registry, documentId);
  const items = useMemo(
    () => Array.from(
      { length: pageCount },
      (_, pageIndex) => getThumbnailItem(pages[pageIndex], pageIndex, documentRotation),
    ),
    [documentRotation, pageCount, pages, rotationRevision],
  );
  const [, setRenderRevision] = useState(0);
  const renderWindow = useMemo(
    () => new ThumbnailRenderWindow(registry, documentId, pages, documentRotation, () => setRenderRevision((value) => value + 1)),
    [documentId, documentRotation, pages, registry, rotationRevision],
  );

  useEffect(() => () => renderWindow.dispose(), [renderWindow]);
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
      renderWindow.setVisiblePages(visiblePages);
    }, { root, rootMargin: `${root.clientHeight}px 0px` });
    root.querySelectorAll<HTMLElement>('[data-thumbnail-page-index]').forEach((element) => {
      observer.observe(element);
    });

    return () => observer.disconnect();
  }, [renderWindow]);
  useEffect(() => {
    const rotate = getPluginCapability<RotateCapability>(registry, 'rotate');
    return rotate?.forDocument(documentId).onRotateChange(() => setRotationRevision((value) => value + 1));
  }, [documentId, registry]);

  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const current = root.querySelector<HTMLElement>(
      `[data-thumbnail-page-index="${currentPageIndex}"]`,
    );
    if (current) {
      root.scrollTop += current.getBoundingClientRect().top - root.getBoundingClientRect().top;
    }
  }, [currentPageIndex]);

  return (
    <div className="h-full overflow-y-auto" ref={scrollRef}>
      <div className={styles.grid}>
        {items.map(({ pageIndex, aspectRatio }) => {
          const pageNumber = pageIndex + 1;
          const thumbnailUrl = renderWindow.getUrl(pageIndex);
          return (
            <button
              key={pageIndex}
              type="button"
              className={`${styles.card} group`}
              data-thumbnail-page-index={pageIndex}
              data-current={pageNumber === currentPageNumber ? 'true' : undefined}
              aria-label={`Page ${pageNumber}`}
              onClick={() => {
                scrollToPagePreservingViewport(registry, pageNumber);
                onClose();
              }}
            >
              <span className={styles.frame} style={{ aspectRatio }}>
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
        })}
      </div>
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
