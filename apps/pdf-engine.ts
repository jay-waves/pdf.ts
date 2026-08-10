import { useEffect, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import { browserImageDataToBlobConverter } from '@embedpdf/engines/converters';
import {
  PdfEngine as PdfiumEngine,
  type FontFallbackConfig,
} from '@embedpdf/engines/pdfium';
import { RemoteExecutor } from '@embedpdf/engines/pdfium-worker-engine';
import type {
  ImageConversionTypes,
  IPdfiumExecutor,
  PdfDocumentObject,
  PdfEngine,
  PdfTask,
  Task,
} from '@embedpdf/models';
import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import type { PdfRenderTheme } from './pdf-render-theme';
import { getCurrentViewerTheme, getPdfRenderTheme } from './theme';

interface PdfIncrementalRevision {
  baseSize: number;
  delta: ArrayBuffer;
}

const executors = new WeakMap<PdfEngine<Blob>, RemoteExecutor>();

/**
 * Project-owned access to the live PDFium engine and the documents managed by
 * EmbedPDF. The React engine hook remains the sole owner of the worker and
 * engine lifetime; consumers borrow document handles through this capability
 * and must never open, close, or destroy them directly.
 */
export class PdfiumCapability {
  private documents: DocumentManagerCapability | null = null;

  constructor(readonly engine: PdfEngine<Blob>) {}

  bindRegistry(registry: PluginRegistry) {
    const documents = registry.getPlugin('document-manager')?.provides?.() as
      | DocumentManagerCapability
      | undefined;
    if (!documents) {
      throw new Error('The PDFium capability requires the document-manager plugin.');
    }

    this.documents = documents;
    return () => {
      // A stale registry cleanup must not detach a newer binding.
      if (this.documents === documents) this.documents = null;
    };
  }

  getActiveDocumentId() {
    return this.documents?.getActiveDocumentId() ?? null;
  }

  getDocument(documentId?: string | null) {
    const id = documentId ?? this.getActiveDocumentId();
    return id ? this.documents?.getDocument(id) ?? null : null;
  }

  withDocument<T>(
    documentId: string | null | undefined,
    operation: (engine: PdfEngine<Blob>, document: PdfDocumentObject) => T,
  ): T {
    const document = this.getDocument(documentId);
    if (!document) {
      throw new Error(`PDFium document is not available${documentId ? `: ${documentId}` : ''}.`);
    }
    return operation(this.engine, document);
  }
}

export function usePdfTsPdfiumEngine(options: {
  wasmUrl: string;
  fontFallback: FontFallbackConfig | null;
  defaultImageType: ImageConversionTypes;
}) {
  const [state, setState] = useState<{
    pdfium: PdfiumCapability | null;
    isLoading: boolean;
    error: Error | null;
  }>({ pdfium: null, isLoading: true, error: null });

  useEffect(() => {
    const worker = new Worker(new URL('./pdfium-worker.ts', import.meta.url), { type: 'module' });
    const executor = new RemoteExecutor(worker, options);
    const engine = new PdfiumEngine<Blob>(executor as unknown as IPdfiumExecutor, {
      imageConverter: (getImageData, imageType, quality) => browserImageDataToBlobConverter(
        getImageData,
        imageType ?? options.defaultImageType,
        quality,
      ),
    });
    const pdfium = new PdfiumCapability(engine);
    executors.set(engine, executor);

    const readyTask = (executor as unknown as {
      readyTask: Task<boolean, { code: number; message: string }>;
    }).readyTask;
    let active = true;
    const fail: Parameters<typeof readyTask.wait>[1] = (failure) => {
      if (!active) return;
      setState({
        pdfium: null,
        isLoading: false,
        error: new Error(failure.reason.message),
      });
    };
    const finish = () => {
      if (active) setState({ pdfium, isLoading: false, error: null });
    };

    readyTask.wait(
      () => setPdfRenderTheme(engine, getPdfRenderTheme(getCurrentViewerTheme())).wait(finish, fail),
      fail,
    );

    return () => {
      active = false;
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
  return (executor as unknown as {
    send(method: string, args: unknown[]): PdfTask<boolean>;
  }).send('setRenderTheme', [theme]);
}

export function savePdfIncrementally(
  engine: PdfEngine<Blob>,
  document: PdfDocumentObject,
): PdfTask<PdfIncrementalRevision> {
  const executor = executors.get(engine);
  if (!executor) {
    throw new Error('This PDF engine does not support incremental save.');
  }

  return (executor as unknown as {
    send(method: string, args: unknown[]): PdfTask<PdfIncrementalRevision>;
  }).send('saveIncremental', [document]);
}
