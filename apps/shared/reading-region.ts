import type { Rect, Size } from '@embedpdf/core-geometry';

/** Unrotated page fractions, shared by every page in a document. */
export type ReadingRegion = Readonly<{ left: number; top: number; right: number; bottom: number }>;
export const READING_REGION_MODE = 'reading-region';

export function isReadingRegion(value: unknown): value is ReadingRegion {
  if (!value || typeof value !== 'object') return false;
  const { left, top, right, bottom } = value as ReadingRegion;
  return [left, top, right, bottom].every(Number.isFinite)
    && left >= 0 && top >= 0 && right <= 1 && bottom <= 1 && right > left && bottom > top;
}

export function normalizeReadingRegion(rect: Rect, size: Size): ReadingRegion | null {
  if (![size.width, size.height, rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    || !(size.width > 0 && size.height > 0)) return null;
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const region = {
    left: clamp(rect.x / size.width), top: clamp(rect.y / size.height),
    right: clamp((rect.x + rect.width) / size.width),
    bottom: clamp((rect.y + rect.height) / size.height),
  };
  return isReadingRegion(region) ? region : null;
}

export function readingRegionRect(region: ReadingRegion, size: Size): Rect {
  return {
    x: region.left * size.width, y: region.top * size.height,
    width: (region.right - region.left) * size.width, height: (region.bottom - region.top) * size.height,
  };
}
