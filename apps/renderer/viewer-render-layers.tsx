import { useDocumentState } from '@embedpdf/core/react';
import { useRenderCapability } from '@embedpdf/plugin-render/react';
import { useTilingCapability, type Tile } from '@embedpdf/plugin-tiling/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ImgHTMLAttributes,
} from 'react';
import { useRenderUrl } from './use-render-url';
import { completeStartupLog, writeStartupLogOnce } from '../viewer/startup-log';
import { viewerActivity } from '../viewer/viewer-activity';

const ZOOM_TILE_SETTLE_MS = 120;

function BaseRasterPlane({
  documentId,
  pageIndex,
  scale,
  dpr,
  style,
  onLoad,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & {
  documentId: string;
  pageIndex: number;
  scale: number;
  dpr: number;
}) {
  const { provides: render } = useRenderCapability();
  const documentState = useDocumentState(documentId);
  const refreshVersion = documentState?.pageRefreshVersions[pageIndex] ?? 0;
  const start = useCallback(
    () => render?.forDocument(documentId).renderPage({
      pageIndex,
      options: { scaleFactor: scale, dpr },
    }) ?? null,
    [documentId, dpr, pageIndex, refreshVersion, render, scale],
  );
  const [imageUrl, releaseImage] = useRenderUrl(start, 'base');

  useEffect(() => {
    writeStartupLogOnce(
      'first-raster',
      'Rendering first visible page',
      `page ${pageIndex + 1} · DPR ${dpr}`,
    );
  }, [dpr, pageIndex]);

  if (!imageUrl) return null;
  return (
    <img
      {...props}
      src={imageUrl}
      style={{ width: '100%', height: '100%', ...style }}
      onLoad={(event) => {
        releaseImage?.();
        onLoad?.(event);
        completeStartupLog('First page ready', `page ${pageIndex + 1}`);
      }}
    />
  );
}

function TileImage({
  documentId,
  pageIndex,
  tile,
  dpr,
  scale,
  onReady,
}: {
  documentId: string;
  pageIndex: number;
  tile: Tile;
  dpr: number;
  scale: number;
  onReady(): void;
}) {
  const { provides: tiling } = useTilingCapability();
  const scope = useMemo(
    () => tiling?.forDocument(documentId),
    [documentId, tiling],
  );
  const relativeScale = scale / tile.srcScale;
  const start = useCallback(
    () => scope?.renderTile({ pageIndex, tile, dpr }) ?? null,
    // Tile identity is stable by id; depending on the whole object would
    // restart rendering when the tiling plugin republishes equivalent tiles.
    [dpr, pageIndex, scope, tile.id],
  );
  const [imageUrl, releaseImage] = useRenderUrl(start, 'tile');

  if (!imageUrl) return null;
  return (
    <img
      src={imageUrl}
      alt=""
      draggable={false}
      onLoad={() => {
        releaseImage?.();
        onReady();
      }}
      style={{
        position: 'absolute',
        left: tile.screenRect.origin.x * relativeScale,
        top: tile.screenRect.origin.y * relativeScale,
        width: tile.screenRect.size.width * relativeScale,
        height: tile.screenRect.size.height * relativeScale,
        display: 'block',
      }}
    />
  );
}

function TilePlane({
  documentId,
  pageIndex,
  dpr,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  documentId: string;
  pageIndex: number;
  dpr: number;
}) {
  const documentState = useDocumentState(documentId);
  const scale = documentState?.scale ?? 1;
  const refresh = documentState?.pageRefreshVersions[pageIndex] ?? 0;
  const rotation = (documentState?.rotation ?? 0)
    + (documentState?.document?.pages[pageIndex]?.rotation ?? 0);

  return <SettledTilePlane
    {...props}
    key={`${documentId}-${pageIndex}-${dpr}-${refresh}-${rotation}`}
    documentId={documentId}
    pageIndex={pageIndex}
    dpr={dpr}
    scale={scale}
  />;
}

/**
 * The page raster is one layer with two planes: an always-available full-page
 * base and an optional high-resolution tile plane. Consumers choose the layer;
 * the render strategy and stacking stay internal.
 */
export function RenderLayer({
  documentId,
  pageIndex,
  dpr,
  baseScale,
  tiles = true,
}: {
  documentId: string;
  pageIndex: number;
  dpr: number;
  baseScale: number;
  tiles?: boolean;
}) {
  return (
    <>
      <BaseRasterPlane
        documentId={documentId}
        pageIndex={pageIndex}
        scale={baseScale}
        dpr={dpr}
        className="pdf-page-render-image"
        draggable={false}
        style={{ pointerEvents: 'none' }}
      />
      {tiles ? (
        <TilePlane
          documentId={documentId}
          pageIndex={pageIndex}
          dpr={dpr}
          className="pdf-page-tiling-layer"
        />
      ) : null}
    </>
  );
}

type TileBatch = { id: string; tiles: Tile[] };

function SettledTilePlane({ documentId, pageIndex, dpr, scale, ...props }: {
  documentId: string;
  pageIndex: number;
  dpr: number;
  scale: number;
} & HTMLAttributes<HTMLDivElement>) {
  const { provides: tiling } = useTilingCapability();
  // Keep one complete batch beneath the newest batch until every image loads.
  const [batches, setBatches] = useState<{ front?: TileBatch; pending?: TileBatch }>({});
  const loaded = useRef(new Set<string>());
  const tiles = useMemo(() => [...new Map(
    [...(batches.front?.tiles ?? []), ...(batches.pending?.tiles ?? [])]
      .map((tile) => [tile.id, tile]),
  ).values()], [batches]);
  const promote = useCallback(() => {
    setBatches((current) => current.pending?.tiles.every((tile) => loaded.current.has(tile.id))
      ? { front: current.pending }
      : current);
  }, []);

  useEffect(() => {
    const retained = new Set(tiles.map((tile) => tile.id));
    for (const id of loaded.current) if (!retained.has(id)) loaded.current.delete(id);
    // A scroll may request only tiles that are already loaded.
    promote();
  }, [tiles, promote]);

  useEffect(() => {
    if (!tiling) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let latest: Tile[] = [];
    let lastScale: number | undefined;
    const publish = () => {
      clearTimeout(timer);
      timer = undefined;
      const batch = { id: latest.map((tile) => tile.id).join('|'), tiles: latest };
      setBatches((current) => {
        if (!batch.tiles.length) return current.front || current.pending ? {} : current;
        if ((current.pending ?? current.front)?.id === batch.id) return current;
        if (current.front?.id === batch.id) return { front: current.front };
        return { front: current.front, pending: batch };
      });
    };
    const unsubscribe = tiling.onTileRendering((event) => {
      if (event.documentId !== documentId) return;
      latest = event.tiles[pageIndex] ?? [];
      const nextScale = latest[0]?.srcScale;
      if (nextScale !== undefined && lastScale !== undefined && nextScale !== lastScale) {
        clearTimeout(timer);
        timer = setTimeout(publish, ZOOM_TILE_SETTLE_MS);
        // Retire unfinished work at the old scale; the complete batch stays.
        setBatches((current) => current.pending ? { front: current.front } : current);
      } else if (!timer) {
        // Scrolling already has a throttle in the tiling plugin.
        publish();
      }
      lastScale = nextScale ?? lastScale;
    });
    const unsubscribeActivity = viewerActivity.onEvent((event) => {
      if (event.phase === 'end' && event.path.includes('Zoom') && timer) publish();
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
      unsubscribeActivity();
    };
  }, [documentId, pageIndex, tiling]);

  return (
    <div {...props}>
      {tiles.map((tile) => (
        <TileImage
          key={tile.id}
          tile={tile}
          documentId={documentId}
          pageIndex={pageIndex}
          dpr={dpr}
          scale={scale}
          onReady={() => {
            loaded.current.add(tile.id);
            promote();
          }}
        />
      ))}
    </div>
  );
}
