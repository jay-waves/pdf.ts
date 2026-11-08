import { useEffect, useState } from 'react';
import type { DocumentHandle, Engine } from '@embedpdf/engine-core/runtime';
import { createSharedPdfEngine, getSharedDocumentClient, getRuntimeDocument } from './shared-document-client';
import type { PdfFontDiagnostic, PdfFontFallbackConfig } from '../fonts/types';
import type { PdfRenderTheme } from './pdf-render-theme';
import { getPdfRenderTheme, viewerThemeStore } from '../theme/theme';
import { failStartupLog, writeStartupLogOnce } from '../viewer/startup-log';
export { getRuntimeDocument } from './shared-document-client';

/** The application borrows native v3 document handles; no old engine facade. */
export class PdfRuntime {
  constructor(readonly engine: Engine) {}
  getDocument(id: string) { return getRuntimeDocument(this.engine, id); }
  withDocument<T>(id: string, operation: (document: DocumentHandle) => T): T {
    const document = this.getDocument(id); if (!document) throw new Error(`PDF document is not available: ${id}`);
    return operation(document);
  }
  async getFontDiagnostics(): Promise<PdfFontDiagnostic[]> { return getSharedDocumentClient(this.engine)?.getFontDiagnostics() ?? []; }
}
export function usePdfRuntime(options: { wasmUrl?: string; fontFallback?: PdfFontFallbackConfig | null } = {}) {
  const [state, setState] = useState<{ pdfium: PdfRuntime | null; isLoading: boolean; error: Error | null }>({ pdfium: null, isLoading: true, error: null });
  useEffect(() => {
    writeStartupLogOnce('pdf-worker', 'Starting PDF worker');
    const { engine, client } = createSharedPdfEngine({ wasmUrl: options.wasmUrl, fontFallback: options.fontFallback, defaultFallbackFonts: false });
    let active = true;
    void client.ready.then(async () => { await client.setRenderTheme(getPdfRenderTheme(viewerThemeStore.getState().theme)); if (active) setState({ pdfium: new PdfRuntime(engine), isLoading: false, error: null }); }).catch(error => {
      failStartupLog('Unable to start PDF worker', String(error));
      if (active) setState({ pdfium: null, isLoading: false, error });
    });
    return () => { active = false; void engine.destroy().catch(error => console.error('[pdf-ts] PDF engine cleanup failed', error)); };
  }, [options.wasmUrl, options.fontFallback]);
  return state;
}
export async function setPdfRenderTheme(engine: Engine, theme: PdfRenderTheme | null) {
  return getSharedDocumentClient(engine)!.setRenderTheme(theme);
}
export function useRenderThemeVersion(engine: Engine) {
  const [version, setVersion] = useState(0);
  useEffect(() => viewerThemeStore.subscribe((state, previous) => {
    if (state.theme !== previous.theme) void setPdfRenderTheme(engine, getPdfRenderTheme(state.theme)).then(() => setVersion(value => value + 1)).catch(error => console.error('[pdf-ts] PDF theme failed', error));
  }), [engine]);
  return version;
}
