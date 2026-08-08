import { PdfiumNative } from '@embedpdf/engines/pdfium';
import type { FontFallbackConfig } from '@embedpdf/engines/pdfium';
import {
  PdfErrorCode,
  type PdfDocumentObject,
  type PdfErrorReason,
  type Task,
} from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import {
  toReverseByteOrderBitmapColor,
  type PdfRenderTheme,
} from './pdf-render-theme';

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

const COLOR_SCHEME_BYTES = 4 * Uint32Array.BYTES_PER_ELEMENT;
const PAUSE_STRUCT_BYTES = 2 * Uint32Array.BYTES_PER_ELEMENT;
const FPDF_RENDER_TOBECONTINUED = 1;
const FPDF_RENDER_DONE = 2;
const FPDF_CONVERT_FILL_TO_STROKE = 0x20;

type ThemeRenderResources = {
  pauseCallback: number;
  pausePtr: number;
  schemePtr: number;
};

function getThemeRenderGeometry(
  module: WrappedPdfiumModule,
  pagePtr: number,
  matrix: Float32Array,
) {
  const [a, b, c, d, e, f] = matrix;
  const pageWidth = module.FPDF_GetPageWidthF(pagePtr);
  const pageHeight = module.FPDF_GetPageHeightF(pagePtr);
  let rotation = 0;
  let scaleX = Math.abs(a);
  let scaleY = Math.abs(d);
  if (Math.abs(b) > Math.abs(a)) {
    rotation = b > 0 ? 1 : 3;
    scaleX = Math.abs(c);
    scaleY = Math.abs(b);
  } else if (a < 0) {
    rotation = 2;
  }

  const fullWidth = Math.max(1, Math.round((rotation & 1 ? pageHeight : pageWidth) * scaleX));
  const fullHeight = Math.max(1, Math.round((rotation & 1 ? pageWidth : pageHeight) * scaleY));
  let startX = Math.round(e);
  let startY = Math.round(f);
  if (rotation === 1 || rotation === 2) startX -= fullWidth;
  if (rotation === 2 || rotation === 3) startY -= fullHeight;
  return { fullHeight, fullWidth, rotation, startX, startY };
}

function createThemeRenderResources(module: WrappedPdfiumModule): ThemeRenderResources {
  const schemePtr = module.pdfium.wasmExports.malloc(COLOR_SCHEME_BYTES);
  if (!schemePtr) throw new Error('PDFium could not allocate the render color scheme.');
  const pausePtr = module.pdfium.wasmExports.malloc(PAUSE_STRUCT_BYTES);
  if (!pausePtr) {
    module.pdfium.wasmExports.free(schemePtr);
    throw new Error('PDFium could not allocate the render pause handler.');
  }
  const pauseCallback = module.pdfium.addFunction(() => 0, 'ii');
  // IFSDK_PAUSE is { version, NeedToPauseNow }. PDFium rejects the
  // progressive color-scheme API when this pointer is null.
  module.pdfium.setValue(pausePtr, 1, 'i32');
  module.pdfium.setValue(pausePtr + Uint32Array.BYTES_PER_ELEMENT, pauseCallback, 'i32');
  return { pauseCallback, pausePtr, schemePtr };
}

function installThemeRenderer(
  module: WrappedPdfiumModule,
  getTheme: () => PdfRenderTheme | null,
) {
  const original = module.FPDF_RenderPageBitmapWithMatrix.bind(module);
  const resources = createThemeRenderResources(module);
  const mutableModule = module as unknown as {
    FPDF_RenderPageBitmapWithMatrix: typeof module.FPDF_RenderPageBitmapWithMatrix;
  };
  const heap = module.pdfium as typeof module.pdfium & {
    HEAPF32: Float32Array;
    HEAPU8: Uint8Array;
  };
  mutableModule.FPDF_RenderPageBitmapWithMatrix = ((
    bitmapPtr: number,
    pagePtr: number,
    matrixPtr: number,
    _clipPtr: number,
    flags: number,
  ) => {
    const theme = getTheme();
    if (!theme) {
      original(bitmapPtr, pagePtr, matrixPtr, _clipPtr, flags);
      return;
    }

    const matrix = new Float32Array(heap.HEAPF32.buffer, matrixPtr, 6);
    const { fullHeight, fullWidth, rotation, startX, startY } = getThemeRenderGeometry(
      module,
      pagePtr,
      matrix,
    );

    module.FPDFBitmap_FillRect(
      bitmapPtr,
      0,
      0,
      module.FPDFBitmap_GetWidth(bitmapPtr),
      module.FPDFBitmap_GetHeight(bitmapPtr),
      toReverseByteOrderBitmapColor(theme.background),
    );

    if (theme.mode === 'background') {
      original(bitmapPtr, pagePtr, matrixPtr, _clipPtr, flags);
      return;
    }

    try {
      new Uint32Array(heap.HEAPU8.buffer, resources.schemePtr, 4).set([
        theme.pathFill,
        theme.pathStroke,
        theme.textFill,
        theme.textStroke,
      ]);
      let status = module.FPDF_RenderPageBitmapWithColorScheme_Start(
        bitmapPtr,
        pagePtr,
        startX,
        startY,
        fullWidth,
        fullHeight,
        rotation,
        flags | FPDF_CONVERT_FILL_TO_STROKE,
        resources.schemePtr,
        resources.pausePtr,
      );
      while (status === FPDF_RENDER_TOBECONTINUED) {
        status = module.FPDF_RenderPage_Continue(pagePtr, resources.pausePtr);
      }
      if (status !== FPDF_RENDER_DONE) {
        throw new Error(`PDFium themed render failed with status ${status}.`);
      }
    } finally {
      module.FPDF_RenderPage_Close(pagePtr);
    }
  }) as typeof module.FPDF_RenderPageBitmapWithMatrix;
}

const workerScope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};
const activeTasks = new Map<string, Task<unknown, PdfErrorReason, unknown>>();
const originalSizes = new Map<string, number>();
let native: PdfiumNative | null = null;
let renderTheme: PdfRenderTheme | null = null;

function taskError(message: string, code = PdfErrorCode.Unknown) {
  return {
    type: 'reject' as const,
    reason: { code, message },
  };
}

function respond(id: string, message: Record<string, unknown>, transfer: Transferable[] = []) {
  workerScope.postMessage({ id, ...message }, transfer);
}

function getResultTransfer(value: unknown): Transferable[] {
  if (value instanceof ArrayBuffer) return [value];
  const data = typeof value === 'object' && value
    ? (value as { data?: unknown }).data
    : undefined;
  if (ArrayBuffer.isView(data)
    && data.buffer instanceof ArrayBuffer
    && data.byteOffset === 0
    && data.byteLength === data.buffer.byteLength) {
    return [data.buffer];
  }
  return [];
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
    if (request.method === 'setRenderTheme') {
      renderTheme = (request.args[0] ?? null) as PdfRenderTheme | null;
      respond(request.id, { type: 'result', data: true });
      return;
    }

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
          respond(request.id, { type: 'result', data: value }, getResultTransfer(value));
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
      installThemeRenderer(module, () => renderTheme);
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
