import { useEffect, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import { browserImageDataToBlobConverter } from '@embedpdf/engines/converters';
import { PdfEngine as PdfiumEngine } from '@embedpdf/engines/pdfium';
import { RemoteExecutor } from '@embedpdf/engines/pdfium-worker-engine';
import type {
  ImageConversionTypes,
  PdfDocumentObject,
  PdfEngine,
  PdfTask,
  Task,
} from '@embedpdf/models';
import type { PdfRenderTheme } from './pdf-render-theme';
import type { PdfFontDiagnostic, PdfFontFallbackConfig } from '../fonts';
import { getPdfRenderTheme, viewerThemeStore } from '../theme/theme';
import {
  failStartupLog,
  writeStartupInfo,
  writeStartupLog,
  writeStartupLogOnce,
  type StartupLogLevel,
} from '../viewer/startup-log';

interface PdfIncrementalRevision {
  baseSize: number;
  delta: ArrayBuffer;
}

interface RemoteExecutorInternals {
  readyTask: Task<boolean, { code: number; message: string }>;
  send<T>(method: string, args: unknown[]): PdfTask<T>;
}

const executors = new WeakMap<PdfEngine<Blob>, RemoteExecutorInternals>();

/**
 * Project-owned access to the live PDFium engine and the viewer's sole PDF.
 * The React engine hook remains the sole owner of the worker and engine
 * lifetime; consumers borrow the document handle from EmbedPDF's core state.
 */
export class PdfRuntime {
  private registry: PluginRegistry | null = null;

  constructor(readonly engine: PdfEngine<Blob>) {}

  bindRegistry(registry: PluginRegistry) {
    this.registry = registry;
    return () => {
      // A stale registry cleanup must not detach a newer binding.
      if (this.registry === registry) this.registry = null;
    };
  }

  getDocument(documentId: string) {
    return this.registry?.getStore().getState().core.documents[documentId]?.document ?? null;
  }

  withDocument<T>(
    documentId: string,
    operation: (engine: PdfEngine<Blob>, document: PdfDocumentObject) => T,
  ): T {
    const document = this.getDocument(documentId);
    if (!document) {
      throw new Error(`PDFium document is not available: ${documentId}.`);
    }
    return operation(this.engine, document);
  }

  getFontDiagnostics(): Promise<PdfFontDiagnostic[]> {
    const executor = executors.get(this.engine);
    return executor
      ? executor.send<PdfFontDiagnostic[]>('getFontDiagnostics', []).toPromise()
      : Promise.resolve([]);
  }
}

export function usePdfRuntime(options: {
  wasmUrl: string;
  fontFallback: PdfFontFallbackConfig | null;
  defaultImageType: ImageConversionTypes;
}) {
  const [state, setState] = useState<{
    pdfium: PdfRuntime | null;
    isLoading: boolean;
    error: Error | null;
  }>({ pdfium: null, isLoading: true, error: null });

  useEffect(() => {
    writeStartupLogOnce('pdf-worker', 'Starting PDF worker');
    const worker = new Worker(new URL('./pdfium-worker', import.meta.url), { type: 'module' });
    const handleStartupLog = (event: MessageEvent<unknown>) => {
      const message = event.data as {
        type?: string;
        level?: StartupLogLevel;
        message?: string;
        detail?: string;
      };
      if (message.type !== 'startupLog' || !message.message) return;
      writeStartupLog(message.level ?? 'info', message.message, message.detail);
    };
    worker.addEventListener('message', handleStartupLog);
    const executor = new RemoteExecutor(worker, options);
    const internals = executor as unknown as RemoteExecutorInternals;
    const engine = new PdfiumEngine<Blob>(executor, {
      imageConverter: (getImageData, imageType, quality) => browserImageDataToBlobConverter(
        getImageData,
        imageType ?? options.defaultImageType,
        quality,
      ),
    });
    const pdfium = new PdfRuntime(engine);
    executors.set(engine, internals);

    const { readyTask } = internals;
    let active = true;
    const fail: Parameters<typeof readyTask.wait>[1] = (failure) => {
      if (!active) return;
      failStartupLog('Unable to initialize PDF engine', failure.reason.message);
      setState({
        pdfium: null,
        isLoading: false,
        error: new Error(failure.reason.message),
      });
    };
    const finish = () => {
      if (active) {
        writeStartupInfo('PDF engine ready');
        setState({ pdfium, isLoading: false, error: null });
      }
    };

    readyTask.wait(
      () => setPdfRenderTheme(engine, getPdfRenderTheme(viewerThemeStore.getState().theme)).wait(finish, fail),
      fail,
    );

    return () => {
      active = false;
      worker.removeEventListener('message', handleStartupLog);
      executors.delete(engine);
      void engine.destroy().toPromise().catch(() => worker.terminate());
    };
  }, [options.defaultImageType, options.fontFallback, options.wasmUrl]);

  return state;
}

export function setPdfRenderTheme(
  engine: PdfEngine<Blob>,
  theme: PdfRenderTheme | null,
): PdfTask<boolean> {
  const executor = executors.get(engine);
  if (!executor) throw new Error('This PDF engine does not support render themes.');
  return executor.send<boolean>('setRenderTheme', [theme]);
}

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

export function savePdfIncrementally(
  engine: PdfEngine<Blob>,
  document: PdfDocumentObject,
): PdfTask<PdfIncrementalRevision> {
  const executor = executors.get(engine);
  if (!executor) {
    throw new Error('This PDF engine does not support incremental save.');
  }

  return executor.send<PdfIncrementalRevision>('saveIncremental', [document]);
}
