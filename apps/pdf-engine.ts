import { useEffect, useState } from 'react';
import { browserImageDataToBlobConverter } from '@embedpdf/engines/converters';
import {
  PdfEngine as PdfiumEngine,
  type FontFallbackConfig,
} from '@embedpdf/engines/pdfium';
import { RemoteExecutor } from '@embedpdf/engines/pdfium-worker-engine';
import type {
  IPdfiumExecutor,
  PdfDocumentObject,
  PdfEngine,
  PdfTask,
  Task,
} from '@embedpdf/models';
import type { PdfRenderTheme } from './pdf-render-theme';
import { getCurrentViewerTheme, getPdfRenderTheme } from './theme';

export interface PdfIncrementalRevision {
  baseSize: number;
  delta: ArrayBuffer;
}

type IncrementalBridge = {
  executor: RemoteExecutor;
};

const bridges = new WeakMap<object, IncrementalBridge>();

export function usePdfTsPdfiumEngine(options: {
  wasmUrl: string;
  fontFallback: FontFallbackConfig | null;
}) {
  const [state, setState] = useState<{
    engine: PdfEngine<Blob> | null;
    isLoading: boolean;
    error: Error | null;
  }>({ engine: null, isLoading: true, error: null });

  useEffect(() => {
    const worker = new Worker(new URL('./pdfium-worker.ts', import.meta.url), { type: 'module' });
    const executor = new RemoteExecutor(worker, options);
    const engine = new PdfiumEngine<Blob>(executor as unknown as IPdfiumExecutor, {
      imageConverter: browserImageDataToBlobConverter,
    });
    bridges.set(engine, { executor });

    const readyTask = (executor as unknown as {
      readyTask: Task<boolean, { code: number; message: string }>;
    }).readyTask;
    readyTask.wait(
      () => setPdfRenderTheme(engine, getPdfRenderTheme(getCurrentViewerTheme())).wait(
        () => setState({ engine, isLoading: false, error: null }),
        (failure) => setState({
          engine: null,
          isLoading: false,
          error: new Error(failure.reason.message),
        }),
      ),
      (failure) => setState({
        engine: null,
        isLoading: false,
        error: new Error(failure.reason.message),
      }),
    );

    return () => {
      bridges.delete(engine);
      void engine.destroy().toPromise().catch(() => worker.terminate());
    };
  }, [options.fontFallback, options.wasmUrl]);

  return state;
}

export function setPdfRenderTheme(
  engine: PdfEngine<Blob>,
  theme: PdfRenderTheme | null,
): PdfTask<boolean> {
  const bridge = bridges.get(engine);
  if (!bridge) throw new Error('This PDF engine does not support render themes.');
  return (bridge.executor as unknown as {
    send(method: string, args: unknown[]): PdfTask<boolean>;
  }).send('setRenderTheme', [theme]);
}

export function savePdfIncrementally(
  engine: PdfEngine<Blob>,
  document: PdfDocumentObject,
): PdfTask<PdfIncrementalRevision> {
  const bridge = bridges.get(engine);
  if (!bridge) {
    throw new Error('This PDF engine does not support incremental save.');
  }

  return (bridge.executor as unknown as {
    send(method: string, args: unknown[]): PdfTask<PdfIncrementalRevision>;
  }).send('saveIncremental', [document]);
}

export function isIncrementalSaveAvailable(engine: PdfEngine<Blob>) {
  return bridges.has(engine);
}
