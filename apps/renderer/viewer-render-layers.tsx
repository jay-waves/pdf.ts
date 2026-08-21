import { useDocumentState } from '@embedpdf/core/react';
import { PdfErrorCode, type PdfTask } from '@embedpdf/models';
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
import { recordRenderTiming } from './viewer-diagnostics';
import { completeStartupLog, writeStartupLogOnce } from '../viewer/startup-log';

function useRenderUrl(
  start: () => PdfTask<Blob> | null,
  kind: 'base' | 'tile',
  cancelMessage: string,
) {
  const [url, setUrl] = useState<string>();
  const urlRef = useRef<string | null>(null);
  const revoke = useCallback(() => {
    if (!urlRef.current) return;
    URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);

  useEffect(() => {
    setUrl(undefined);
    revoke();
    const task = start();
    if (!task) return;

    const startedAt = performance.now();
    let active = true;
    let settled = false;
    task.wait((blob) => {
      settled = true;
      if (!active) return;
      const elapsed = performance.now() - startedAt;
      recordRenderTiming(kind, elapsed);
      if (kind === 'base') {
        writeStartupLogOnce('first-raster-generated', 'Page raster generated', `${elapsed.toFixed(0)} ms`);
      }
      const nextUrl = URL.createObjectURL(blob);
      urlRef.current = nextUrl;
      setUrl(nextUrl);
    }, () => {
      settled = true;
    });

    return () => {
      active = false;
      revoke();
      if (!settled) task.abort({ code: PdfErrorCode.Cancelled, message: cancelMessage });
    };
  }, [cancelMessage, kind, revoke, start]);

  return [url, revoke] as const;
}

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
  const [imageUrl, releaseImage] = useRenderUrl(start, 'base', 'Raster layer changed');

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
        releaseImage();
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
  const [imageUrl, releaseImage] = useRenderUrl(start, 'tile', 'Tile layer changed');

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
