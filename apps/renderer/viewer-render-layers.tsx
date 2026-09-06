import { useDocumentState } from '@embedpdf/core/react';
import { useRenderCapability } from '@embedpdf/plugin-render/react';
import { useTilingCapability, type Tile } from '@embedpdf/plugin-tiling/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type HTMLAttributes,
  type ImgHTMLAttributes,
} from 'react';
import { useRenderUrl } from './use-render-url';
import { completeStartupLog, writeStartupLogOnce } from '../viewer/startup-log';

export function RasterLayer({
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
}: {
  documentId: string;
  pageIndex: number;
  tile: Tile;
  dpr: number;
  scale: number;
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
      onLoad={releaseImage}
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

export function TileLayer({
  documentId,
  pageIndex,
  dpr,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  documentId: string;
  pageIndex: number;
  dpr: number;
}) {
  const { provides: tiling } = useTilingCapability();
  const documentState = useDocumentState(documentId);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const scale = documentState?.scale ?? 1;

  useEffect(() => {
    if (!tiling) return;
    return tiling.onTileRendering((event) => {
      if (event.documentId === documentId) setTiles(event.tiles[pageIndex] ?? []);
    });
  }, [documentId, pageIndex, tiling]);

  return (
    <div {...props}>
      {tiles.map((tile) => (
        <TileImage
          key={`${tile.id}-${dpr}`}
          documentId={documentId}
          pageIndex={pageIndex}
          tile={tile}
          dpr={dpr}
          scale={scale}
        />
      ))}
    </div>
  );
}
