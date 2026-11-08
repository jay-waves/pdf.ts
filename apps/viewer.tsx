/**
 * Application entry: install page-wide services and mount ViewerBootstrap.
 * Startup/resource ownership lives in viewer-bootstrap; viewer-app composes
 * feature UI; use-document-replacement owns staged reload, cancellation and commit.
 */
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import pdfiumWasmUrl from '@embedpdf/engine-runtime-wasm32/embedpdf.wasm?url';
import './viewer.css';
import { initializeViewerTheme } from './theme/theme';
import { TooltipProvider } from './components';
import { installErrorDiagnostics } from './renderer/viewer-diagnostics';
import { installRenderDprMonitor } from './renderer/render-settings';
import { beginStartupLog, describeStartupUrl, writeStartupInfo } from './viewer/startup-log';
import { ViewerBootstrap } from './viewer/viewer-bootstrap';

const BUNDLED_PDFIUM_WASM_URL = new URL(pdfiumWasmUrl, import.meta.url).href;

beginStartupLog(`PDF.ts ${__PDF_TS_BUILD_INFO__}`);
writeStartupInfo(
  'Viewer script loaded',
  `${window.location.origin}${window.location.pathname}; ${navigator.onLine ? 'online' : 'offline'}`,
);
writeStartupInfo('PDFium WASM asset resolved', describeStartupUrl(BUNDLED_PDFIUM_WASM_URL));

const disposeTheme = initializeViewerTheme();
const disposeDiagnostics = installErrorDiagnostics();
const disposeDpr = installRenderDprMonitor();
writeStartupInfo('Viewer environment ready', navigator.platform || 'Web');

function ViewerLifecycle() {
  useEffect(() => () => {
    disposeDpr();
    disposeDiagnostics();
    disposeTheme();
  }, []);

  return (
    <TooltipProvider>
      <ViewerBootstrap wasmUrl={BUNDLED_PDFIUM_WASM_URL} />
    </TooltipProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <ViewerLifecycle />,
);
