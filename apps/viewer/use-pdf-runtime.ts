import { useEffect, useState } from 'react';
import type { Engine } from '@embedpdf/engine-core/runtime';
import { createSharedPdfEngine, getSharedDocumentClient } from '../engine/shared-document-client';
import { PdfRuntime } from '../engine/pdf-runtime';
import type { PdfFontFallbackConfig } from '../fonts/types';
import { getPdfRenderTheme, viewerThemeStore } from '../theme/theme';
import { failStartupLog, writeStartupLogOnce } from './startup-log';

export function usePdfRuntime(options: { wasmUrl?: string; fontFallback?: PdfFontFallbackConfig | null } = {}) {
  const [state, setState] = useState<{ pdfium: PdfRuntime | null; isLoading: boolean; error: Error | null }>({ pdfium: null, isLoading: true, error: null });
  useEffect(() => {
    writeStartupLogOnce('pdf-worker', 'Starting PDF worker');
    const { engine, client } = createSharedPdfEngine({ wasmUrl: options.wasmUrl, fontFallback: options.fontFallback, defaultFallbackFonts: false });
    let active = true;
    void client.ready.then(async () => {
      await client.setRenderTheme(getPdfRenderTheme(viewerThemeStore.getState().theme));
      if (active) setState({ pdfium: new PdfRuntime(engine), isLoading: false, error: null });
    }).catch(error => {
      failStartupLog('Unable to start PDF worker', String(error));
      if (active) setState({ pdfium: null, isLoading: false, error });
    });
    return () => {
      active = false;
      void engine.destroy().catch(error => console.error('[pdf-ts] PDF engine cleanup failed', error));
    };
  }, [options.wasmUrl, options.fontFallback]);
  return state;
}

export function useRenderThemeVersion(engine: Engine) {
  const [version, setVersion] = useState(0);
  useEffect(() => viewerThemeStore.subscribe((state, previous) => {
    if (state.theme === previous.theme) return;
    void getSharedDocumentClient(engine)!.setRenderTheme(getPdfRenderTheme(state.theme))
      .then(() => setVersion(value => value + 1))
      .catch(error => console.error('[pdf-ts] PDF theme failed', error));
  }), [engine]);
  return version;
}
