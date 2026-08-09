import { useEffect, useState } from 'react';
import type { PdfEngine } from '@embedpdf/models';
import { setPdfRenderTheme } from './pdf-engine';
import {
  getPdfRenderTheme,
  type ViewerTheme,
  VIEWER_THEME_CHANGE_EVENT,
} from './theme';

export function useRenderThemeVersion(engine: PdfEngine<Blob>) {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    const syncTheme = (event: Event) => {
      const { theme } = (event as CustomEvent<{ theme: ViewerTheme }>).detail;
      void setPdfRenderTheme(engine, getPdfRenderTheme(theme)).toPromise()
        .then(() => {
          if (active) setVersion((current) => current + 1);
        })
        .catch((error) => console.error('[pdf-ts] failed to update PDF render theme', error));
    };
    window.addEventListener(VIEWER_THEME_CHANGE_EVENT, syncTheme);
    return () => {
      active = false;
      window.removeEventListener(VIEWER_THEME_CHANGE_EVENT, syncTheme);
    };
  }, [engine]);

  return version;
}
