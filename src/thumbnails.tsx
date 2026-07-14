import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { PluginRegistry } from '@embedpdf/core';
import { getActiveDocumentId, type ScrollCapability } from './utils';

type ThumbnailState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  url?: string;
};

type ThumbnailCapability = {
  forDocument(documentId: string): {
    renderThumb(pageIndex: number, dpr: number): {
      toPromise(): Promise<Blob>;
    };
  };
};

function getTotalPages(registry: PluginRegistry | undefined, documentId: string | null, fallback: number) {
  if (fallback > 0) {
    return fallback;
  }

  const scroll = registry?.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  return documentId && scroll ? scroll.forDocument(documentId).getTotalPages() : 0;
}

function scrollToPage(registry: PluginRegistry, pageNumber: number) {
  const documentId = getActiveDocumentId(registry);
  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;

  if (!documentId || !scroll) {
    return;
  }

  scroll.forDocument(documentId).scrollToPage({
    pageNumber,
    behavior: 'smooth',
  });
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
  const pageCount = useMemo(() => getTotalPages(registry, documentId, totalPages), [documentId, registry, totalPages]);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [thumbnails, setThumbnails] = useState<ThumbnailState[]>([]);

  useEffect(() => {
    if (!open || !registry || !documentId || pageCount <= 0) {
      setThumbnails([]);
      return;
    }

    const thumbnail = registry.getPlugin('thumbnail')?.provides?.() as ThumbnailCapability | undefined;
    if (!thumbnail) {
      setThumbnails(Array.from({ length: pageCount }, () => ({ status: 'error' })));
      return;
    }

    let cancelled = false;
    let observer: IntersectionObserver | undefined;
    let frame = 0;
    let activeRenders = 0;
    const maxActiveRenders = 2;
    const requestedPageIndexes = new Set<number>();
    const renderQueue: number[] = [];
    const urls = new Map<number, string>();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const scope = thumbnail.forDocument(documentId);

    setThumbnails(Array.from({ length: pageCount }, () => ({ status: 'idle' })));

    const renderPage = async (pageIndex: number) => {
      activeRenders += 1;

      try {
        const blob = await scope.renderThumb(pageIndex, dpr).toPromise();
        if (cancelled) {
          return;
        }

        const url = URL.createObjectURL(blob);
        urls.set(pageIndex, url);
        setThumbnails((items) => {
          const nextItems = [...items];
          nextItems[pageIndex] = { status: 'ready', url };
          return nextItems;
        });
      } catch {
        if (!cancelled) {
          setThumbnails((items) => {
            const nextItems = [...items];
            nextItems[pageIndex] = { status: 'error' };
            return nextItems;
          });
        }
      } finally {
        activeRenders -= 1;
        pumpQueue();
      }
    };

    const enqueuePage = (pageIndex: number) => {
      if (pageIndex < 0 || pageIndex >= pageCount || requestedPageIndexes.has(pageIndex)) {
        return;
      }

      requestedPageIndexes.add(pageIndex);
      renderQueue.push(pageIndex);
      setThumbnails((items) => {
        const nextItems = [...items];
        nextItems[pageIndex] = { status: 'loading' };
        return nextItems;
      });
      pumpQueue();
    };

    function pumpQueue() {
      if (cancelled) {
        return;
      }

      while (activeRenders < maxActiveRenders && renderQueue.length) {
        const pageIndex = renderQueue.shift();
        if (pageIndex !== undefined) {
          void renderPage(pageIndex);
        }
      }
    }

    frame = requestAnimationFrame(() => {
      const root = contentRef.current;
      if (!root || cancelled) {
        return;
      }

      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) {
              continue;
            }

            const pageIndex = Number((entry.target as HTMLElement).dataset.thumbnailPageIndex);
            if (Number.isInteger(pageIndex)) {
              enqueuePage(pageIndex);
              observer?.unobserve(entry.target);
            }
          }
        },
        {
          root,
          rootMargin: '480px 0px',
        },
      );

      for (const item of root.querySelectorAll<HTMLElement>('[data-thumbnail-page-index]')) {
        observer.observe(item);
      }
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      for (const url of urls.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, [documentId, open, pageCount, registry]);

  const body = useMemo(() => {
    if (!registry || pageCount <= 0) {
      return <div className="shnctl-state">No pages available.</div>;
    }

    return (
      <ol className="shnctl-thumbnail-grid">
        {Array.from({ length: pageCount }, (_, pageIndex) => {
          const thumbnail = thumbnails[pageIndex] ?? { status: 'idle' };
          const pageNumber = pageIndex + 1;

          return (
            <li key={pageNumber} className="shnctl-thumbnail-item" data-thumbnail-page-index={pageIndex}>
              <button
                type="button"
                className="shnctl-thumbnail"
                data-current={pageNumber === currentPageNumber ? 'true' : undefined}
                onClick={() => {
                  scrollToPage(registry, pageNumber);
                  onClose();
                }}
              >
                <span className="shnctl-thumbnail-frame">
                  {thumbnail.status === 'ready' && thumbnail.url ? (
                    <img src={thumbnail.url} alt={`Page ${pageNumber}`} />
                  ) : (
                    <span className="shnctl-thumbnail-placeholder">{thumbnail.status === 'error' ? 'Failed' : thumbnail.status === 'loading' ? 'Loading' : ''}</span>
                  )}
                </span>
                <span className="shnctl-thumbnail-label">{pageNumber}</span>
              </button>
            </li>
          );
        })}
      </ol>
    );
  }, [currentPageNumber, onClose, pageCount, registry, thumbnails]);

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="shnctl-overlay" />
        <Dialog.Content className="shnctl-panel" aria-describedby={undefined}>
          <Dialog.Title className="shnctl-visually-hidden">PDF Thumbnails</Dialog.Title>
          <div className="shnctl-content" ref={contentRef}>{body}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
