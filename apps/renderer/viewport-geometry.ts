import { restorePosition, transformSize, type Position, type Rotation, type Size, type Rect } from '@embedpdf/models';
import type { ViewportInputMetrics, ViewportMetrics } from '@embedpdf/plugin-viewport';

export type Insets = Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;
export type Interval = { start: number; size: number };

export const scrollAxes = {
  vertical: {
    coordinate: 'y', extent: 'height', offset: 'scrollTop', length: 'clientHeight',
    before: 'top', after: 'bottom', align: 'alignY', landing: 0.35,
  },
  horizontal: {
    coordinate: 'x', extent: 'width', offset: 'scrollLeft', length: 'clientWidth',
    before: 'left', after: 'right', align: 'alignX', landing: 0.5,
  },
} as const;
export type ScrollAxis = typeof scrollAxes[keyof typeof scrollAxes];

/** Measure DOM geometry together; callers keep this snapshot for one operation. */
export function measureViewport(element: HTMLElement): ViewportMetrics {
  const metrics = {
    width: element.offsetWidth, height: element.offsetHeight,
    scrollLeft: element.scrollLeft, scrollTop: element.scrollTop,
    clientWidth: element.clientWidth, clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight,
    clientLeft: element.clientLeft, clientTop: element.clientTop,
  };
  return {
    ...metrics,
    relativePosition: {
      x: metrics.scrollWidth <= metrics.clientWidth ? 0 : metrics.scrollLeft / (metrics.scrollWidth - metrics.clientWidth),
      y: metrics.scrollHeight <= metrics.clientHeight ? 0 : metrics.scrollTop / (metrics.scrollHeight - metrics.clientHeight),
    },
  };
}

/** Client coordinates become viewport coordinates inside the element's border. */
export function clientPointToViewport(element: HTMLElement, clientX: number, clientY: number) {
  const bounds = element.getBoundingClientRect();
  return {
    vx: Math.max(0, Math.min(element.clientWidth, clientX - bounds.left - element.clientLeft)),
    vy: Math.max(0, Math.min(element.clientHeight, clientY - bounds.top - element.clientTop)),
  };
}

/** Offset is measured from the rotated page's top-left, in CSS pixels. */
export function pagePointFromOffset(offset: Position, size: Size, rotation: Rotation, scale: number) {
  // restorePosition expects the transformed container dimensions.
  return restorePosition(transformSize(size, rotation, scale), offset, rotation, scale);
}

export function projectRect(rect: Rect, axis: ScrollAxis): Interval {
  return { start: rect.origin[axis.coordinate], size: rect.size[axis.extent] };
}

export function viewportInterval(metrics: Pick<ViewportInputMetrics, 'scrollLeft' | 'scrollTop' | 'clientWidth' | 'clientHeight'>,
  axis: ScrollAxis, insets: Insets = {}) {
  const start = metrics[axis.offset];
  const size = metrics[axis.length];
  const before = Math.min(size, Math.max(0, insets[axis.before] ?? 12));
  const after = Math.min(size - before, Math.max(0, insets[axis.after] ?? 12));
  const available = size - before - after;
  const comfort = Math.min(64, Math.max(24, size * 0.08), available / 3);
  return {
    start, size, end: start + size, comfort,
    visibleStart: start + before, visibleEnd: start + size - after,
    landing: Math.min(size - after - comfort, Math.max(before + comfort, size * axis.landing)),
  };
}

export function revealDelta(target: Interval, view: ReturnType<typeof viewportInterval>) {
  if (target.start < view.visibleStart) return target.start - view.visibleStart - view.comfort;
  if (target.start + target.size > view.visibleEnd) return target.start + target.size - view.visibleEnd + view.comfort;
  return 0;
}

/** Shared fit policy for zoom detents and horizontal layout, using unscaled pages. */
export function fitScales(
  spreads: readonly (readonly { rotatedSize: Size }[])[],
  viewport: Pick<ViewportInputMetrics, 'clientWidth' | 'clientHeight'>,
  viewportGap: number,
  pageGap: number,
) {
  let width = 0;
  let height = 0;
  for (const spread of spreads) {
    let spreadWidth = 0;
    for (const [index, page] of spread.entries()) {
      spreadWidth += page.rotatedSize.width + (index ? pageGap : 0);
      height = Math.max(height, page.rotatedSize.height);
    }
    width = Math.max(width, spreadWidth);
  }
  const fit = (available: number, content: number) => available > 0 && content > 0 ? available / content : 0;
  const fitWidth = fit(viewport.clientWidth - 2 * viewportGap, width);
  const fitHeight = fit(viewport.clientHeight - 2 * viewportGap, height);
  return { width: fitWidth, height: fitHeight, page: Math.min(fitWidth, fitHeight) };
}

/** Avoid flattening all spreads just to locate one page. */
export function findPage<T extends { index: number }>(spreads: readonly (readonly T[])[], index: number): T | undefined {
  for (const spread of spreads) {
    const page = spread.find((item) => item.index === index);
    if (page) return page;
  }
}
