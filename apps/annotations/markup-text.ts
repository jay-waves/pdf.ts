import { sliceText, type DocumentHandle, type TextLayout, type TextRange } from '@embedpdf/engine-core/runtime';
import type { Rect } from '@embedpdf/core-geometry';

/** Keep disjoint marked ranges disjoint; never copy unmarked characters between them. */
export function markedTextRanges(layout: Pick<TextLayout, 'charCount' | 'charQuad'>, rects: readonly Rect[]): TextRange[] {
  const ranges: TextRange[] = [];
  for (let index = 0; index < layout.charCount; index++) {
    const quad = layout.charQuad(index);
    if (!quad) continue;
    const points = [quad.upperLeft, quad.upperRight, quad.lowerLeft, quad.lowerRight];
    const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y));
    const right = Math.max(...points.map(point => point.x)), bottom = Math.max(...points.map(point => point.y));
    if (!rects.some(rect => rect.x < right && rect.x + rect.width > x && rect.y < bottom && rect.y + rect.height > y)) continue;
    const previous = ranges.at(-1);
    if (previous && previous.start + previous.count === index) previous.count++;
    else ranges.push({ start: index, count: 1 });
  }
  return ranges;
}

export async function readMarkupPage(page: ReturnType<DocumentHandle['page']>, signal?: AbortSignal) {
  const text = page.text.get(), layout = page.text.layout();
  const abort = () => { text.abort(); layout.abort(); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const [snapshot, geometry] = await Promise.all([text, layout]);
    return (rects: readonly Rect[]) => markedTextRanges(geometry, rects).map(range => sliceText(snapshot, range)).join(' ');
  } catch (error) { abort(); throw error; }
  finally { signal?.removeEventListener('abort', abort); }
}
