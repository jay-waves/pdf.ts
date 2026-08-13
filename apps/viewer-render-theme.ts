import { useEffect, useState } from 'react';
import type { PdfEngine } from '@embedpdf/models';
import { setPdfRenderTheme } from './pdf-engine';
import {
  getPdfRenderTheme,
  viewerThemeStore,
} from './theme';

export function useRenderThemeVersion(engine: PdfEngine<Blob>) {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    const syncTheme = (theme: ReturnType<typeof viewerThemeStore.getState>['theme']) => {
      void setPdfRenderTheme(engine, getPdfRenderTheme(theme)).toPromise()
        .then(() => {
          if (active) setVersion((current) => current + 1);
        })
        .catch((error) => console.error('[pdf-ts] failed to update PDF render theme', error));
    };
    const unsubscribe = viewerThemeStore.subscribe((state, previous) => {
      if (state.theme !== previous.theme) syncTheme(state.theme);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [engine]);

  return version;
}
