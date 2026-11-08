import { useEffect, useRef } from 'react';
import { RenderLayer as NativeRenderLayer, usePictureState } from '@embedpdf/react/render';
import { usePage } from '@embedpdf/react/runtime';
import { completeStartupLog, writeStartupLogOnce } from '../viewer/startup-log';

/** v3 owns the retained base/tile planes and their cancellation and URL lifetime. */
export function RenderLayer({ tiles = true }: {
  documentId?: string; pageIndex?: number; dpr?: number; baseScale?: number; tiles?: boolean;
}) {
  const page = usePage();
  const picture = usePictureState();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    writeStartupLogOnce('first-raster', 'Rendering first visible page', `page ${page.pageIndex + 1}`);
    // Keep our stable DOM hooks for paint readiness and raster diagnostics.
    const mark = () => root.current?.querySelector('img')?.classList.add('pdf-page-render-image');
    mark();
    const observer = new MutationObserver(mark);
    if (root.current) observer.observe(root.current, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [page.pageIndex]);
  useEffect(() => {
    if (picture.status === 'ready') completeStartupLog('First page ready', `page ${page.pageIndex + 1}`);
  }, [page.pageIndex, picture.status]);
  return <div ref={root} className="pdf-native-render-layer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}><NativeRenderLayer tiles={tiles} /></div>;
}
