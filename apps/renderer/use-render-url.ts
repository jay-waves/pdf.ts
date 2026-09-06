import { useEffect, useState } from 'react';
import type { PdfTask } from '@embedpdf/models';
import { renderImage } from './render-image';
import { recordRenderTiming } from './viewer-diagnostics';
import { writeStartupLogOnce } from '../viewer/startup-log';

type RenderStart = () => PdfTask<Blob> | null;

export function useRenderUrl(start: RenderStart, kind: 'base' | 'tile' | 'thumbnail') {
  const [image, setImage] = useState<{
    start: RenderStart;
    url: string;
    release(): void;
  }>();

  useEffect(() => {
    setImage(undefined);
    const startedAt = performance.now();
    return renderImage(start, (url, release) => {
      const elapsed = performance.now() - startedAt;
      if (kind !== 'thumbnail') recordRenderTiming(kind, elapsed);
      if (kind === 'base') {
        writeStartupLogOnce('first-raster-generated', 'Page raster generated', `${elapsed.toFixed(0)} ms`);
      }
      setImage({ start, url, release });
    }, (error) => console.error(`[pdf-ts] ${kind} raster failed`, error));
  }, [kind, start]);

  // Hide the previous generation immediately, before effect cleanup revokes it.
  return image?.start === start ? [image.url, image.release] as const : [undefined, undefined] as const;
}
