import { useEffect } from 'react';
import { RenderLayer as NativeRenderLayer, usePictureState } from '@embedpdf/react/render';
import { usePage } from '@embedpdf/react/runtime';
import { completeStartupLog, writeStartupLogOnce } from '../viewer/startup-log';

/** v3 owns the retained base/tile planes and their cancellation and URL lifetime. */
export function RenderLayer({ tiles = true }: {
  tiles?: boolean;
}) {
  const page = usePage();
  const picture = usePictureState();
  useEffect(() => {
    writeStartupLogOnce('first-raster', 'Rendering first visible page', `page ${page.pageIndex + 1}`);
  }, [page.pageIndex]);
  useEffect(() => {
    if (picture.status === 'ready') completeStartupLog('First page ready', `page ${page.pageIndex + 1}`);
  }, [page.pageIndex, picture.status]);
  return <div className="pdf-native-render-layer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}><NativeRenderLayer tiles={tiles} /></div>;
}
