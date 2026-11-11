/**
 * The SDK owns the base/tile plan; Canvas only presents its raw pixels. This viewer wrapper reports startup and exposes a raster container
 * for replacement paint checks; the render plan remains the single authority.
 */
import { CanvasRenderLayer } from '../renderer/canvas-render-layer';
import { useEffect } from 'react';
import { usePictureState } from '@embedpdf/react/render';
import { usePage } from '@embedpdf/react/runtime';
import { completeStartupLog, writeStartupLogOnce } from './startup-log';

/** v3 owns the retained base/tile planes and their cancellation and raster lifetime. */
export function RenderLayer({ layers = 'overlays' }: {
  layers?: 'overlays' | 'flattened';
}) {
  const page = usePage();
  const picture = usePictureState();
  useEffect(() => {
    writeStartupLogOnce('first-raster', 'Rendering first visible page', `page ${page.pageIndex + 1}`);
  }, [page.pageIndex]);
  useEffect(() => {
    if (picture.status === 'ready') completeStartupLog('First page ready', `page ${page.pageIndex + 1}`);
  }, [page.pageIndex, picture.status]);
  return <div className="pdf-native-render-layer" data-pdf-picture-layers={layers} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}><CanvasRenderLayer overlays={layers === 'overlays'} /></div>;
}
