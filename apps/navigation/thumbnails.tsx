import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Kernel } from '@embedpdf/core';
import type { PageInfo } from '@embedpdf/core';
import { RenderToken } from '@embedpdf/plugin-render';
import { StageToken } from '@embedpdf/plugin-stage';
import { useStore } from 'zustand';
import { PanelContent, PanelState } from '../components';
import type { ViewerCommandDispatch } from '../viewer/viewer-controller';
import { renderSettingsStore } from '../renderer/render-settings';
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
  page: PageInfo | undefined,
  pageIndex: number,
  documentRotation: number,
): ThumbnailItem {
  const quarterTurn = ((page?.rotation ?? 0) + documentRotation) % 180 !== 0;
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
  registry: Kernel;
  documentId: string;
  page: PageInfo | undefined;
  item: ThumbnailItem;
  documentRotation: number;
  current: boolean;
  onSelect(): void;
}) {
  const cardRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const systemDpr = useStore(renderSettingsStore, (state) => state.systemDpr);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    return observeVisibility(card, setVisible);
  }, []);

  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!page || !visible) return;
    const render = registry.tryCapability(RenderToken, documentId);
    if (!render) return;
    const controller = new AbortController();
    let release: (() => void) | undefined;
    let active = true;
    const rotation = ((page.rotation ?? 0) + documentRotation) % 360 as 0 | 90 | 180 | 270;
    const rotatedHeight = rotation % 180 !== 0 ? page.size.width : page.size.height;
    void render.renderPage(page.ref, {
      scale: THUMBNAIL_RENDER_HEIGHT / rotatedHeight * Math.min(systemDpr, 1.5),
      rotation, signal: controller.signal,
    }).then(image => image.objectUrl()).then(image => {
      if (!active) { image.revoke(); return; }
      release = image.revoke; setUrl(image.url);
    }).catch(error => { if (active) console.error('[pdf-ts] thumbnail failed', error); });
    return () => { active = false; controller.abort(); release?.(); setUrl(undefined); };
  }, [documentId, documentRotation, page, registry, systemDpr, visible]);

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
  registry: Kernel;
  documentId: string;
  dispatch: ViewerCommandDispatch;
  pageCount: number;
  currentPageNumber: number;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const currentPageIndex = Math.min(Math.max(0, currentPageNumber - 1), pageCount - 1);
  const pages = registry.documents.listPages(documentId);
  const [documentRotation, setDocumentRotation] = useState(registry.tryCapability(StageToken, documentId)?.getViewRotation() ?? 0);
  const items = useMemo(
    () => Array.from({ length: pageCount }, (_, pageIndex) => (
      getThumbnailItem(pages[pageIndex], pageIndex, documentRotation)
    )),
    [documentRotation, pageCount, pages],
  );

  useEffect(() => {
    const rotate = registry.tryCapability(StageToken, documentId);
    if (!rotate) return;
    setDocumentRotation(rotate.getViewRotation());
    return rotate.onSettingsChanged(() => setDocumentRotation(rotate.getViewRotation()));
  }, [documentId, registry]);

  useLayoutEffect(() => {
    const root = scrollRef.current;
    const current = root?.querySelector<HTMLElement>(`[data-page-index="${currentPageIndex}"]`);
    current?.scrollIntoView({ block: 'start' });
  }, [currentPageIndex]);

  return (
    <div className={`h-full overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${styles.grid}`} ref={scrollRef}>
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
  registry: Kernel | undefined;
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
