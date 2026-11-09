import { createTextLayout, createPageImageHandle, type PageImageResult, type PageRenderTransform, type PageRenderMatrix } from '@embedpdf/engine-core/runtime';
// Only buffers freshly allocated by our encoder are owned by the RPC response.
// Never detach arbitrary SDK results, caches, or caller-provided inputs.
const responseBuffers = new WeakSet<ArrayBuffer>();
export function ownEngineResponseBuffer(buffer: ArrayBuffer) { responseBuffers.add(buffer); }
export function engineResultTransfers(value: unknown): ArrayBuffer[] {
  const transfers = new Set<ArrayBuffer>();
  const seen = new WeakSet<object>();
  function visit(item: unknown) {
    if (item === null || typeof item !== 'object' || seen.has(item)) return;
    seen.add(item);
    const buffer = item instanceof ArrayBuffer ? item : ArrayBuffer.isView(item) ? item.buffer : undefined;
    if (buffer) {
      if (buffer instanceof ArrayBuffer && responseBuffers.has(buffer)) transfers.add(buffer);
      return;
    }
    if (item instanceof Blob) return;
    for (const child of Object.values(item)) visit(child);
  }
  visit(value);
  return [...transfers];
}

/** Public v3 results may carry local convenience methods. Only their data crosses ports. */
export function encodeEngineResult(value: any): any {
  if (value === null || typeof value !== 'object' || value instanceof ArrayBuffer || ArrayBuffer.isView(value) || value instanceof Blob) return value;
  if (Array.isArray(value)) return value.map(encodeEngineResult);
  if (typeof value.charAt === 'function' && typeof value.segments === 'function' && Array.isArray(value.runs)) return { __pdfTsTextLayout: true, runs: encodeEngineResult(value.runs) };
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'function') {
      if (['objectUrl', 'blob', 'pageToPixels', 'pixelsToPage'].includes(key)) continue;
      throw new Error(`Unsupported engine result method: ${key}`);
    }
    result[key] = encodeEngineResult(item);
  }
  return result;
}
function transformValue(value: any, m: PageRenderMatrix): any {
  if ('upperLeft' in value) return Object.fromEntries(Object.entries(value).map(([key, point]) => [key, transformValue(point, m)]));
  const point = (x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
  if (!('width' in value)) return point(value.x, value.y);
  const corners = [point(value.x, value.y), point(value.x + value.width, value.y), point(value.x, value.y + value.height), point(value.x + value.width, value.y + value.height)];
  const x = Math.min(...corners.map(p => p.x)), y = Math.min(...corners.map(p => p.y));
  return { x, y, width: Math.max(...corners.map(p => p.x)) - x, height: Math.max(...corners.map(p => p.y)) - y };
}
export function decodeEngineResult(value: any): any {
  if (value === null || typeof value !== 'object' || value instanceof ArrayBuffer || ArrayBuffer.isView(value) || value instanceof Blob) return value;
  if (Array.isArray(value)) return value.map(decodeEngineResult);
  const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeEngineResult(item)])) as any;
  if (result.__pdfTsTextLayout === true && Array.isArray(result.runs)) return createTextLayout({ runs: result.runs });
  if (Array.isArray(result.matrix) && result.matrix.length === 6 && typeof result.width === 'number') {
    const m = result.matrix as PageRenderMatrix; const det = m[0] * m[3] - m[1] * m[2];
    const inverse: PageRenderMatrix = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
      (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
    return { ...result, pageToPixels: (p: any) => transformValue(p, m), pixelsToPage: (p: any) => transformValue(p, inverse) } satisfies PageRenderTransform;
  }
  if (result.source && result.mimeType && typeof result.width === 'number') {
    const image = result as PageImageResult;
    return Object.assign(createPageImageHandle(image, { blob: async signal => image.source.kind === 'bytes'
      ? new Blob([image.source.bytes as Uint8Array<ArrayBuffer>], { type: image.mimeType }) : (await fetch(image.source.url, { signal })).blob() }), result);
  }
  return result;
}
