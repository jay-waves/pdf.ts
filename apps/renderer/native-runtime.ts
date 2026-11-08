import { LocalEngine, PortableImageEncoder, type Transport, type WorkerResponse } from '@embedpdf/engine';
import { createPdfRuntime, toWrappedPdfiumModule, type PdfRuntimeModule, type Ptr } from '@embedpdf/engine-runtime';
import { WorkerHost, ensureInitialized, openFatMemoryDocument } from '@embedpdf/engine-services';
import { PdfiumFontFallbackManager } from '../fonts/font-fallback-manager';
import type { PdfFontFallbackConfig } from '../fonts/types';
import { getThemeRenderGeometry, toReverseByteOrderBitmapColor, type PdfRenderTheme } from './pdf-render-theme';

/** Small native extensions for features v3 hasn't exposed on its document API yet. */
function installTheme(runtime: PdfRuntimeModule, getTheme: () => PdfRenderTheme | null) {
  const { fn, mem } = runtime;
  const original = fn.EPDF_RenderPageBitmapWithMatrix_Start;
  const scheme = mem.alloc(16); const pause = mem.alloc(8);
  const wrapped = toWrappedPdfiumModule(runtime);
  const callback = wrapped.pdfium.addFunction(() => 0, 'ii');
  mem.poke(pause, 'i32', 1); mem.poke(pause, 'i32', callback, 4);
  fn.EPDF_RenderPageBitmapWithMatrix_Start = (bitmap, page, matrix, clip, flags, budget) => {
    const theme = getTheme(); if (!theme) return original(bitmap, page, matrix, clip, flags, budget);
    fn.FPDFBitmap_FillRect(bitmap, 0, 0, fn.FPDFBitmap_GetWidth(bitmap), fn.FPDFBitmap_GetHeight(bitmap), toReverseByteOrderBitmapColor(theme.background));
    if (theme.mode === 'background') return original(bitmap, page, matrix, clip, flags, budget);
    const values = new Float32Array(mem.readBytes(matrix, 24).buffer);
    const geometry = getThemeRenderGeometry(fn.FPDF_GetPageWidthF(page), fn.FPDF_GetPageHeightF(page), values);
    [theme.pathFill, theme.pathStroke, theme.textFill, theme.textStroke].forEach((color, i) => mem.poke(scheme, 'i32', color, i * 4));
    let status = fn.FPDF_RenderPageBitmapWithColorScheme_Start(bitmap, page, geometry.startX, geometry.startY,
      geometry.fullWidth, geometry.fullHeight, geometry.rotation, flags | 0x20, scheme, pause);
    while (status === 1) status = fn.FPDF_RenderPage_Continue(page, pause);
    return status;
  };
}
export async function createNativeRuntime(options: { wasmUrl?: string; fontFallback?: PdfFontFallbackConfig | null }, getTheme: () => PdfRenderTheme | null) {
  const runtime = await createPdfRuntime({ prefer: 'wasm', wasmUrl: options.wasmUrl }); ensureInitialized(runtime);
  installTheme(runtime, getTheme);
  const fonts = options.fontFallback ? new PdfiumFontFallbackManager(options.fontFallback, () => {}) : null;
  if (fonts) fonts.initialize(toWrappedPdfiumModule(runtime) as Parameters<typeof fonts.initialize>[0], (data, pointer) => runtime.mem.writeBytes(BigInt(pointer) as Ptr, data));
  const listeners = new Set<(value: WorkerResponse) => void>();
  const host = new WorkerHost(runtime, pack => { for (const listener of listeners) listener(pack.payload); });
  const transport: Transport = { send: pack => host.receive(pack.payload), onMessage: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    terminate: async () => { fonts?.disable(); await runtime.destroy(); } };
  const engine = LocalEngine.fromTransport({ transport, imageEncoder: { async encode(raster, options, signal) {
    if (options.format === 'bmp') return new PortableImageEncoder().encode(raster, options, signal);
    signal.throwIfAborted();
    const canvas = new OffscreenCanvas(raster.width, raster.height);
    const context = canvas.getContext('2d'); if (!context) throw new Error('Offscreen image encoding is unavailable.');
    const pixels = new Uint8ClampedArray(raster.width * raster.height * 4);
    const source = new Uint8Array(raster.data);
    for (let row = 0; row < raster.height; row++) pixels.set(source.subarray(row * raster.stride, row * raster.stride + raster.width * 4), row * raster.width * 4);
    context.putImageData(new ImageData(pixels, raster.width, raster.height), 0, 0);
    const format = options.format ?? 'png'; const mimeType = format === 'webp' ? 'image/webp' : 'image/png';
    const blob = await canvas.convertToBlob({ type: mimeType, quality: options.quality });
    signal.throwIfAborted();
    return { width: raster.width, height: raster.height, format, mimeType, source: { kind: 'bytes' as const, bytes: new Uint8Array(await blob.arrayBuffer()) } };
  } } });
  return { engine, fonts,
    protect(bytes: Uint8Array, sourcePassword: string | undefined, password: string | null) {
      const document = openFatMemoryDocument(runtime, bytes, sourcePassword);
      const length = runtime.mem.alloc(4);
      let output: Ptr | undefined;
      try {
        const success = password === null ? runtime.fn.EPDF_RemoveEncryption(document.docPtr)
          : runtime.fn.EPDF_SetEncryption(document.docPtr, password, password, 0xfffffffc);
        if (!success) throw new Error('PDFium rejected the document protection change.');
        output = runtime.fn.EPDF_SaveDocumentToOwnedBuffer(document.docPtr, 2, length);
        if (!output) throw new Error('PDFium could not save document protection.');
        return runtime.mem.readBytes(output, Number(runtime.mem.peek(length, 'i32')));
      } finally { if (output) runtime.fn.EPDF_FreeBuffer(output); runtime.mem.free(length); document.close(); }
    },
  };
}
