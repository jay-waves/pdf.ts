import { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { FontFallbackConfig } from '@embedpdf/engines/pdfium';
import {
  PdfErrorCode,
  type PdfDocumentObject,
  type PdfErrorReason,
  type Task,
} from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';

type WorkerRequest =
  | {
      id: string;
      type: 'execute';
      method: string;
      args: unknown[];
    }
  | {
      id: string;
      type: 'wasmInit';
      wasmUrl: string;
      fontFallback: FontFallbackConfig | null;
    };

type NativeInternals = {
  pdfiumModule: WrappedPdfiumModule;
  cache: {
    getContext(documentId: string): { filePtr: number; docPtr: number } | undefined;
  };
};

const workerScope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};
const activeTasks = new Map<string, Task<unknown, PdfErrorReason, unknown>>();
const originalSizes = new Map<string, number>();
let native: PdfiumNative | null = null;

function taskError(message: string, code = PdfErrorCode.Unknown) {
  return {
    type: 'reject' as const,
    reason: { code, message },
  };
}

function respond(id: string, message: Record<string, unknown>, transfer: Transferable[] = []) {
  workerScope.postMessage({ id, ...message }, transfer);
}

function saveIncremental(document: PdfDocumentObject) {
  if (!native) throw new Error('PDFium is not initialized.');

  const internals = native as unknown as NativeInternals;
  const context = internals.cache.getContext(document.id);
  const originalSize = originalSizes.get(document.id);
  if (!context || originalSize === undefined) {
    throw new Error('The original PDF buffer is unavailable for incremental save.');
  }

  const module = internals.pdfiumModule;
  const writerPtr = module.PDFiumExt_OpenFileWriter();
  if (!writerPtr) throw new Error('PDFium could not create an incremental writer.');

  let dataPtr = 0;
  try {
    // FPDF_INCREMENTAL = 1. PDFium writes a complete file whose prefix must
    // remain byte-for-byte identical to the source PDF.
    if (!module.FPDF_SaveAsCopy(context.docPtr, writerPtr, 1)) {
      throw new Error('PDFium rejected incremental save for this document.');
    }
    const size = module.PDFiumExt_GetFileWriterSize(writerPtr);
    if (size <= originalSize) {
      throw new Error('PDFium did not produce an incremental PDF revision.');
    }

    dataPtr = module.pdfium.wasmExports.malloc(size);
    if (!dataPtr) throw new Error('PDFium could not allocate the saved PDF buffer.');
    module.PDFiumExt_GetFileWriterData(writerPtr, dataPtr, size);

    const heap = (module.pdfium as typeof module.pdfium & { HEAPU8: Uint8Array }).HEAPU8;
    const output = heap.subarray(dataPtr, dataPtr + size);
    const source = heap.subarray(context.filePtr, context.filePtr + originalSize);
    for (let offset = 0; offset < originalSize; offset++) {
      if (output[offset] !== source[offset]) {
        throw new Error('PDFium rewrote the PDF prefix; a full save is required.');
      }
    }

    return {
      baseSize: originalSize,
      delta: output.slice(originalSize).buffer,
    };
  } finally {
    if (dataPtr) module.pdfium.wasmExports.free(dataPtr);
    module.PDFiumExt_CloseFileWriter(writerPtr);
  }
}

function execute(request: Extract<WorkerRequest, { type: 'execute' }>) {
  if (!native) {
    respond(request.id, { type: 'error', error: taskError(
      'PDFium is not initialized.',
      PdfErrorCode.NotReady,
    ) });
    return;
  }

  try {
    if (request.method === 'openDocumentBuffer') {
      const file = request.args[0] as { id: string; content: ArrayBuffer };
      originalSizes.set(file.id, file.content.byteLength);
    }

    const result = request.method === 'saveIncremental'
      ? saveIncremental(request.args[0] as PdfDocumentObject)
      : (native as unknown as Record<string, (...args: unknown[]) => unknown>)[request.method]?.(
          ...request.args,
        );

    if (!result) {
      throw new Error(`PDFium method ${request.method} is unavailable.`);
    }
    if (typeof result === 'object' && 'wait' in result) {
      const task = result as Task<unknown, PdfErrorReason, unknown>;
      activeTasks.set(request.id, task);
      task.onProgress((progress) => {
        workerScope.postMessage({ id: request.id, type: 'progress', progress });
      });
      task.wait(
        (value) => {
          const transfer = value instanceof ArrayBuffer ? [value] : [];
          respond(request.id, { type: 'result', data: value }, transfer);
          activeTasks.delete(request.id);
        },
        (error) => {
          respond(request.id, { type: 'error', error });
          activeTasks.delete(request.id);
        },
      );
      return;
    }

    const delta = (
      typeof result === 'object'
      && result
      && 'delta' in result
      && result.delta instanceof ArrayBuffer
    ) ? result.delta : undefined;
    respond(request.id, { type: 'result', data: result }, delta ? [delta] : []);
  } catch (error) {
    respond(request.id, {
      type: 'error',
      error: taskError(error instanceof Error ? error.message : String(error)),
    });
  }
}

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request.type === 'execute') {
    execute(request);
    return;
  }

  void (async () => {
    try {
      const response = await fetch(request.wasmUrl);
      if (!response.ok) throw new Error(`Could not load PDFium (${response.status}).`);
      const module = await init({ wasmBinary: await response.arrayBuffer() });
      native = new PdfiumNative(module, {
        fontFallback: request.fontFallback === null ? undefined : request.fontFallback,
      });
      workerScope.postMessage({ id: request.id, type: 'ready' });
    } catch (error) {
      respond(request.id, {
        type: 'error',
        error: taskError(
          error instanceof Error ? error.message : String(error),
          PdfErrorCode.Initialization,
        ),
      });
    }
  })();
};
