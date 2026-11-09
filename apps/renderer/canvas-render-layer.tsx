import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useCapability, usePage, useSelector } from '@embedpdf/react/runtime';
import { RenderToken, type OpenPictureReport, type TilePaintPlan, type TilePaintSource, type ViewDemand } from '@embedpdf/plugin-render/contract/host';
import type { PageRef } from '@embedpdf/core';
import { afterCanvasPaint, paintRaster, releaseCanvas } from './canvas-painter';

const EMPTY_PLAN: TilePaintPlan = { engaged: false, paint: [], fetching: [], stamp: '' };
const fill = { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' } as const;

/** Presentation only. The SDK owns keys, scheduling, deduplication, LRU and retention. */
export function CanvasRenderLayer({ tiles = true, overlays }: { tiles?: boolean; overlays: boolean }) {
  const page = usePage();
  const render = useCapability(RenderToken);
  const canvas = useRef<HTMLCanvasElement>(null);
  const report = useRef<OpenPictureReport | null>(null);
  const layers = useMemo(() => overlays ? { includeAnnotations: false, includeFormFields: false } : {}, [overlays]);
  const settings = useSelector(RenderToken, api => api.getPaintSettings());
  const key = useSelector(RenderToken, api => api.getSourceKey(page.ref, { scale: page.transform.renderScale, ...layers }));
  useLayoutEffect(() => {
    const opened = render.reportPicture(page.view, page.ref);
    report.current = opened;
    const surface = canvas.current!;
    return () => { opened.close(); report.current = null; releaseCanvas(surface); };
  }, [render, page.view, page.ref]);
  useEffect(() => {
    const controller = new AbortController();
    let cancelPresentation: (() => void) | undefined;
    void render.renderSource(page.ref, { scale: page.transform.renderScale, view: page.view, ...layers, signal: controller.signal }).then(raster => {
      if (controller.signal.aborted) return;
      if (!('data' in raster)) throw new Error('Canvas renderer requires the raw-pixel render transport.');
      paintRaster(canvas.current!, raster);
      cancelPresentation = afterCanvasPaint(() => report.current?.shown());
    }).catch(error => { if (!controller.signal.aborted) report.current?.failed(error); });
    // Keep the old backdrop until the new version arrives; no empty frame during zoom.
    return () => { controller.abort(); cancelPresentation?.(); };
  }, [render, page.ref, page.view, key, layers]);
  return <>
    <canvas ref={canvas} data-plane="base" aria-hidden="true" style={fill} />
    {tiles && settings.tiles && <CanvasTiles overlays={overlays} />}
  </>;
}

function CanvasTiles({ overlays }: { overlays: boolean }) {
  const page = usePage();
  const render = useCapability(RenderToken);
  const [view, setView] = useState<ViewDemand | null>(null);
  // Acquire in an effect, not useMemo: abandoned/StrictMode renders must not leak a view reference.
  useLayoutEffect(() => {
    const opened = render.createViewDemand(page.view);
    setView(opened);
    return () => opened.destroy();
  }, [render, page.view]);
  useLayoutEffect(() => {
    view?.setDemand(page.ref, page.getViewDemand?.() ?? { desiredDeviceWidth: page.transform.deviceWidth },
      overlays ? { includeAnnotations: false, includeFormFields: false } : {});
  });
  const plan = useSelector(RenderToken, () => view?.getPlan(page.ref) ?? EMPTY_PLAN);
  useEffect(() => () => view?.release(page.ref), [view, page.ref]);
  const scale = page.transform.viewScale;
  return <div data-canvas-tiles data-fetching={plan.fetching.length} style={{ ...fill, isolation: 'isolate' }}>
    {view && plan.paint.map(source => <CanvasTile key={source.key} source={source} view={view} page={page.ref} scale={scale} />)}
  </div>;
}

function CanvasTile({ source, view, page, scale }: { source: TilePaintSource; view: ViewDemand; page: PageRef; scale: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const surface = canvas.current!;
    if (!('data' in source.handle)) throw new Error('Canvas tile requires raw pixels.');
    paintRaster(surface, source.handle);
    let presented = false;
    const cancel = afterCanvasPaint(() => { presented = true; view.markPainted(page, source.key); });
    return () => {
      cancel();
      if (presented) view.markUnpainted(page, source.key);
      releaseCanvas(surface);
    };
  }, [source.handle, source.key, view, page]);
  return <canvas ref={canvas} data-plane="tile" data-tile-key={source.key} data-tile-scale={source.scale} aria-hidden="true"
    style={{ position: 'absolute', pointerEvents: 'none', left: source.rect.x * scale, top: source.rect.y * scale,
      width: source.rect.width * scale, height: source.rect.height * scale, zIndex: source.z }} />;
}
