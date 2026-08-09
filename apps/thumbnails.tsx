import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import { PdfErrorCode } from '@embedpdf/models';
import type { RenderCapability } from '@embedpdf/plugin-render';
import type { RotateCapability } from '@embedpdf/plugin-rotate';
import { PanelContent, PanelState } from './components';
import { scrollToPagePreservingViewport } from './page-navigation';
import {
  getActiveDocumentId,
  getPluginCapability,
  type ScrollCapability,
} from './utils';
import styles from './thumbnails.module.css';

const THUMBNAIL_RENDER_HEIGHT = 112;

type DocumentPage = { index?: number; size: { width: number; height: number }; rotation?: number };
type ThumbnailItem = { pageIndex: number; aspectRatio: number };
const visibilityCallbacks = new Map<Element, (visible: boolean) => void>();
let visibilityObserver: IntersectionObserver | undefined;

function observeVisibility(element: Element, onChange: (visible: boolean) => void) {
  visibilityCallbacks.set(element, onChange);
  visibilityObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      visibilityCallbacks.get(entry.target)?.(entry.isIntersecting);
    }
  }, { rootMargin: '100% 0px' });
  visibilityObserver.observe(element);
  return () => {
    visibilityObserver?.unobserve(element);
    visibilityCallbacks.delete(element);
    if (!visibilityCallbacks.size) {
      visibilityObserver?.disconnect();
      visibilityObserver = undefined;
    }
  };
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

function ThumbnailCard({
  registry,
  documentId,
  page,
  item,
  documentRotation,
  current,
  onSelect,
}: {
  registry: PluginRegistry;
  documentId: string;
  page: DocumentPage | undefined;
  item: ThumbnailItem;
  documentRotation: number;
  current: boolean;
  onSelect(): void;
}) {
  const cardRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    return observeVisibility(card, setVisible);
  }, []);

  useEffect(() => {
    if (!page || !visible) return;
    const render = getPluginCapability<RenderCapability>(registry, 'render');
    if (!render) return;
    let objectUrl: string | undefined;
    const rotation = ((page.rotation ?? 0) + documentRotation) % 4;
    const rotatedHeight = rotation % 2 === 1 ? page.size.width : page.size.height;
    const task = render.forDocument(documentId).renderPageRect({
      pageIndex: page.index ?? item.pageIndex,
      rect: { origin: { x: 0, y: 0 }, size: page.size },
      options: {
        scaleFactor: THUMBNAIL_RENDER_HEIGHT / rotatedHeight,
        dpr: Math.min(window.devicePixelRatio || 1, 1.5),
        rotation,
      },
    });
    task.wait((blob) => {
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }, () => {});

    return () => {
      task.abort({
        code: PdfErrorCode.Cancelled,
        message: 'Thumbnail left the virtual window',
      });
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId, documentRotation, item.pageIndex, page, registry, visible]);

  const pageNumber = item.pageIndex + 1;
  return (
    <button
      ref={cardRef}
      type="button"
      className={`${styles.card} group`}
      data-page-index={item.pageIndex}
      data-current={current ? 'true' : undefined}
      aria-label={`Page ${pageNumber}`}
      onClick={onSelect}
    >
      <span className={styles.frame} style={{ aspectRatio: item.aspectRatio }}>
        {visible && url ? (
          <img
            src={url}
            alt=""
            draggable={false}
            className="size-full object-contain"
          />
        ) : null}
      </span>
      <span className="mt-1 block text-muted tabular-nums group-data-[current=true]:text-accent">{pageNumber}</span>
    </button>
  );
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
  const documentInfo = getDocumentInfo(registry, documentId);
  const pages = documentInfo.pages;
  const [documentRotation, setDocumentRotation] = useState(documentInfo.rotation);
  const items = useMemo(
    () => Array.from(
      { length: pageCount },
      (_, pageIndex) => getThumbnailItem(pages[pageIndex], pageIndex, documentRotation),
    ),
    [documentRotation, pageCount, pages],
  );

  useEffect(() => {
    const rotate = getPluginCapability<RotateCapability>(registry, 'rotate');
    const scope = rotate?.forDocument(documentId);
    if (!scope) return;
    setDocumentRotation(scope.getRotation());
    return scope.onRotateChange((rotation) => setDocumentRotation(rotation));
  }, [documentId, registry]);

  useLayoutEffect(() => {
    const root = scrollRef.current;
    const current = root?.querySelector<HTMLElement>(`[data-page-index="${currentPageIndex}"]`);
    current?.scrollIntoView({ block: 'start' });
  }, [currentPageIndex]);

  return (
    <div className="h-full overflow-y-auto" ref={scrollRef}>
      <div className={styles.grid}>
        {items.map((item) => (
          <ThumbnailCard
            key={item.pageIndex}
            registry={registry}
            documentId={documentId}
            page={pages[item.pageIndex]}
            item={item}
            documentRotation={documentRotation}
            current={item.pageIndex === currentPageIndex}
            onSelect={() => {
              scrollToPagePreservingViewport(registry, item.pageIndex + 1);
              onClose();
            }}
          />
        ))}
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
  const scroll = getPluginCapability<ScrollCapability>(registry, 'scroll');
  const pageCount = totalPages || (documentId && scroll
    ? scroll.forDocument(documentId).getTotalPages()
    : 0);

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
