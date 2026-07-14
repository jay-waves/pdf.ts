import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { PluginRegistry } from '@embedpdf/core';
import type { ThumbMeta } from '@embedpdf/plugin-thumbnail';
import { ThumbImg } from '@embedpdf/plugin-thumbnail/react';
import { getActiveDocumentId, type ScrollCapability } from './utils';

const THUMBNAILS_PER_GROUP = 4;
const THUMBNAIL_WIDTH = 150;
const THUMBNAIL_LABEL_HEIGHT = 30;
const THUMBNAIL_OBSERVER_MARGIN = '320px 0px';

type DocumentPage = { size: { width: number; height: number }; rotation?: number };

function getTotalPages(registry: PluginRegistry | undefined, documentId: string | null, fallback: number) {
  if (fallback > 0) return fallback;

  const scroll = registry?.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  return documentId && scroll ? scroll.forDocument(documentId).getTotalPages() : 0;
}

function getDocumentPages(registry: PluginRegistry, documentId: string): DocumentPage[] {
  const state = registry.getStore().getState() as {
    core: {
      documents: Record<string, {
        document?: { pages: DocumentPage[] };
      }>;
    };
  };

  return state.core.documents[documentId]?.document?.pages ?? [];
}

function getThumbnailMeta(pageIndex: number, page?: DocumentPage): ThumbMeta {
  const rotated = ((page?.rotation ?? 0) % 2) === 1;
  const pageWidth = rotated ? page?.size.height : page?.size.width;
  const pageHeight = rotated ? page?.size.width : page?.size.height;
  const height = pageWidth && pageHeight
    ? Math.round(THUMBNAIL_WIDTH * pageHeight / pageWidth)
    : Math.round(THUMBNAIL_WIDTH * Math.SQRT2);

  return {
    pageIndex,
    width: THUMBNAIL_WIDTH,
    height,
    wrapperHeight: height + THUMBNAIL_LABEL_HEIGHT,
    top: 0,
    labelHeight: THUMBNAIL_LABEL_HEIGHT,
    padding: 0,
  };
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
  const pages = getDocumentPages(registry, documentId);
  const metas = useMemo(
    () => Array.from({ length: pageCount }, (_, pageIndex) => getThumbnailMeta(pageIndex, pages[pageIndex])),
    [pageCount, pages],
  );

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
                {visiblePages.has(pageIndex) ? (
                  <ThumbImg
                    documentId={documentId}
                    meta={meta}
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
