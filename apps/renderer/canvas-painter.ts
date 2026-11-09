import type { PageRenderRaster } from '@embedpdf/engine-core/runtime';

/** Raw RGBA -> canvas: no image file, Blob, object URL or decoder. */
export function paintRaster(canvas: HTMLCanvasElement, raster: Pick<PageRenderRaster, 'data' | 'width' | 'height' | 'stride'>) {
  const rowBytes = raster.width * 4;
  let pixels: Uint8ClampedArray<ArrayBuffer>;
  if (raster.stride === rowBytes) pixels = new Uint8ClampedArray(raster.data, 0, rowBytes * raster.height);
  else {
    pixels = new Uint8ClampedArray(rowBytes * raster.height);
    const source = new Uint8Array(raster.data);
    for (let y = 0; y < raster.height; y++) pixels.set(source.subarray(y * raster.stride, y * raster.stride + rowBytes), y * rowBytes);
  }
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable.');
  if (canvas.width !== raster.width) canvas.width = raster.width;
  if (canvas.height !== raster.height) canvas.height = raster.height;
  context.putImageData(new ImageData(pixels, raster.width, raster.height), 0, 0);
  canvas.dataset.painted = 'true';
  canvas.dataset.paintVersion = String(Number(canvas.dataset.paintVersion ?? 0) + 1);
}

/** Keep retention until a presentation opportunity; cancel the report on unmount. */
export function afterCanvasPaint(callback: () => void) {
  let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(callback); });
  return () => cancelAnimationFrame(frame);
}
export function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = canvas.height = 0;
  delete canvas.dataset.painted;
}
