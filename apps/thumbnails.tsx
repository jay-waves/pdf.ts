import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import { PdfErrorCode, type PdfPageObject } from '@embedpdf/models';
import type { RenderCapability } from '@embedpdf/plugin-render';
import type { RotateCapability } from '@embedpdf/plugin-rotate';
import { PanelContent, PanelState } from './components';
import type { ViewerCommandDispatch } from './viewer-controller';
import { getDocumentScope } from './utils';
import { getSystemDpr } from './viewer-diagnostics';
import { getDocumentState } from './viewer-document';
import styles from './thumbnails.module.css';

const THUMBNAIL_RENDER_HEIGHT = 112;

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

function getThumbnailItem(
  page: PdfPageObject | undefined,
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
  page: PdfPageObject | undefined;
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
    const render = getDocumentScope<RenderCapability>(registry, 'render', documentId);
    if (!render) return;
    let objectUrl: string | undefined;
    let active = true;
    const rotation = ((page.rotation ?? 0) + documentRotation) % 4;
    const rotatedHeight = rotation % 2 === 1 ? page.size.width : page.size.height;
    const task = render.renderPageRect({
      pageIndex: page.index ?? item.pageIndex,
      rect: { origin: { x: 0, y: 0 }, size: page.size },
      options: {
        scaleFactor: THUMBNAIL_RENDER_HEIGHT / rotatedHeight,
        dpr: Math.min(getSystemDpr(), 1.5),
        rotation,
      },
    });
    task.wait((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }, () => {});

    return () => {
      active = false;
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
  dispatch,
  pageCount,
  currentPageNumber,
}: {
  registry: PluginRegistry;
  documentId: string;
  dispatch: ViewerCommandDispatch;
  pageCount: number;
  currentPageNumber: number;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const currentPageIndex = Math.min(Math.max(0, currentPageNumber - 1), pageCount - 1);
  const documentState = getDocumentState(registry, documentId);
  const pages = documentState?.document?.pages ?? [];
  const [documentRotation, setDocumentRotation] = useState(documentState?.rotation ?? 0);
  const items = useMemo(
    () => Array.from(
      { length: pageCount },
      (_, pageIndex) => getThumbnailItem(pages[pageIndex], pageIndex, documentRotation),
    ),
    [documentRotation, pageCount, pages],
  );

  useEffect(() => {
    const rotate = getDocumentScope<RotateCapability>(registry, 'rotate', documentId);
    if (!rotate) return;
    setDocumentRotation(rotate.getRotation());
    return rotate.onRotateChange((rotation) => setDocumentRotation(rotation));
  }, [documentId, registry]);

  useLayoutEffect(() => {
    const root = scrollRef.current;
    const current = root?.querySelector<HTMLElement>(`[data-page-index="${currentPageIndex}"]`);
    current?.scrollIntoView({ block: 'start' });
  }, [currentPageIndex]);

  return (
    <div className={`h-full overflow-y-auto ${styles.grid}`} ref={scrollRef}>
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
              dispatch({ type: 'navigation/go-to-page', pageNumber: item.pageIndex + 1 });
              dispatch({ type: 'ui/close-overlay' });
            }}
          />
        ))}
    </div>
  );
}

export function Thumbnails({
  registry,
  documentId,
  dispatch,
  totalPages,
  currentPageNumber,
}: {
  registry: PluginRegistry | undefined;
  documentId?: string | null;
  dispatch: ViewerCommandDispatch;
  totalPages: number;
  currentPageNumber: number;
}) {
  return (
    <PanelContent overflow="hidden">
      {registry && documentId && totalPages > 0 ? (
        <ThumbnailFlow
          registry={registry}
          documentId={documentId}
          dispatch={dispatch}
          pageCount={totalPages}
          currentPageNumber={currentPageNumber}
        />
      ) : (
        <PanelState>No pages available.</PanelState>
      )}
    </PanelContent>
  );
}
