import { SmoothScroll } from './smooth-scroll';
import {
  measureViewport, pagePointFromOffset, projectRect, viewportInterval, revealDelta,
  scrollAxes, fitScales, findPage, type Insets, type ScrollAxis,
} from './viewport-geometry';
import type { PluginRegistry } from '@embedpdf/core';
import {
  boundingRect,
  Rotation,
  type Rect,
  type PdfPageObjectWithRotatedSize,
} from '@embedpdf/models';
import {
  ScrollStrategy,
  type ScrollBehavior,
  type ScrollCapability,
} from '@embedpdf/plugin-scroll';
import type { ViewportCapability, ViewportMetrics } from '@embedpdf/plugin-viewport';
import type { RotateCapability } from '@embedpdf/plugin-rotate';
import type { ZoomCapability } from '@embedpdf/plugin-zoom';
import { normalizeReadingRegion, readingRegionRect, type ReadingRegion } from '../shared/reading-region';
import { getDocumentScrollStrategy, getPluginCapability } from '../shared/utils';

type ScrollAnchor = {
  pageNumber: number;
  pageCoordinates?: { x: number; y: number };
  viewportOffset?: { x: number; y: number };
};

/** Adapts EmbedPDF v2 scroll/viewport capabilities to ViewerStage. */
export class StageScrollAdapter {
  private viewportElement: HTMLElement | null = null;
  private settleFrame = 0;
  private readonly smallScroll = new SmoothScroll(
    () => {
      const metrics = this.viewportElement ?? this.viewportCapability?.forDocument(this.documentId).getMetrics();
      return metrics ? { left: metrics.scrollLeft, top: metrics.scrollTop, maxTop: Math.max(0, metrics.scrollHeight - metrics.clientHeight) } : null;
    },
    (top, position) => this.scrollTo(position.left, top, 'instant'),
  );
  private readonly capability: ScrollCapability | undefined;
  private readonly viewportCapability: ViewportCapability | undefined;

  constructor(
    private readonly registry: PluginRegistry,
    readonly documentId: string,
  ) {
    this.capability = getPluginCapability<ScrollCapability>(registry, 'scroll');
    this.viewportCapability = getPluginCapability<ViewportCapability>(registry, 'viewport');
  }

  attachViewport(element: HTMLElement | null) {
    this.cancelPendingNavigation();
    this.viewportElement = element;
  }

  focusViewport() {
    this.viewportElement?.focus({ preventScroll: true });
  }

  cancelPendingNavigation() {
    this.smallScroll.stop();
    this.cancelSettle();
  }

  private cancelSettle() {
    if (this.settleFrame) cancelAnimationFrame(this.settleFrame);
    this.settleFrame = 0;
  }

  getCurrentPage() {
    return this.capability?.forDocument(this.documentId).getCurrentPage() ?? 1;
  }

  getTotalPages() {
    return this.capability?.forDocument(this.documentId).getTotalPages() ?? 0;
  }

  getStrategy() {
    return getDocumentScrollStrategy(this.registry, this.documentId);
  }

  getViewportGap() {
    return this.viewportCapability?.getViewportGap() ?? 0;
  }

  getPosition() {
    const metrics = this.viewportElement ?? this.viewportCapability?.forDocument(this.documentId).getMetrics();
    return {
      scrollLeft: metrics?.scrollLeft,
      scrollTop: metrics?.scrollTop,
    };
  }

  scrollVertically(delta: number) {
    this.cancelSettle();
    this.smallScroll.move(delta);
  }

  /** EmbedPDF rects exclude viewport padding; all adapter rects include it. */
  private getContentRect(pageIndex: number, rect: Rect, scale?: number): Rect | null {
    const scope = this.capability?.forDocument(this.documentId);
    const positioned = scope?.getRectPositionForPage(pageIndex, rect, scale);
    if (!positioned) return null;
    const gap = this.getViewportGap();
    const metrics = this.getMetrics();
    const width = scope?.getLayout?.().totalContentSize.width;
    const zoom = scale ?? (width === undefined ? undefined : getPluginCapability<ZoomCapability>(this.registry, 'zoom')
      ?.forDocument(this.documentId).getState().currentZoomLevel);
    // Scroller uses margin:auto when its content is narrower than the viewport.
    // Plugin coordinates do not include that DOM offset.
    const centeredX = metrics && width !== undefined && zoom !== undefined
      ? Math.max(0, (metrics.clientWidth - 2 * gap - width * zoom) / 2) : 0;
    return { origin: { x: positioned.origin.x + gap + centeredX, y: positioned.origin.y + gap }, size: positioned.size };
  }

  getFitScales() {
    const metrics = this.viewportElement ?? this.viewportCapability?.forDocument(this.documentId).getMetrics();
    return metrics ? fitScales(this.capability?.forDocument(this.documentId).getSpreadPagesWithRotatedSize() ?? [],
      metrics, this.getViewportGap(), this.capability?.getPageGap() ?? 0) : null;
  }

  normalizeReadingRegion(pageIndex: number, rect: Rect) {
    const page = findPage(this.capability?.forDocument(this.documentId).getSpreadPagesWithRotatedSize() ?? [], pageIndex);
    return page ? normalizeReadingRegion(rect, page.size) : null;
  }

  private getReadingRegionRect(region: ReadingRegion, pageNumber: number, scale?: number) {
    const page = findPage(this.capability?.forDocument(this.documentId).getSpreadPagesWithRotatedSize() ?? [], pageNumber - 1);
    return page ? this.getContentRect(page.index, readingRegionRect(region, page.size), scale) : null;
  }

  fitReadingRegion(
    region: ReadingRegion,
    pageNumber: number,
  ) {
    this.cancelPendingNavigation();
    const metrics = this.getMetrics();
    const bounds = this.getReadingRegionRect(region, pageNumber, 1);
    const zoom = getPluginCapability<ZoomCapability>(this.registry, 'zoom')?.forDocument(this.documentId);
    const level = bounds && metrics
      ? fitScales([[{ rotatedSize: bounds.size }]], metrics, this.getViewportGap(), 0).page
      : null;
    if (!zoom || !level || !Number.isFinite(level)) return false;
    zoom.requestZoom(Math.min(60, Math.max(0.2, level)) + 1e-10);
    this.capability?.forDocument(this.documentId).scrollToPage({ pageNumber, behavior: 'instant' });
    // The SDK queues its own scroll writes. Align after those and React layout.
    this.afterLayout(() => {
      const bounds = this.getReadingRegionRect(region, pageNumber);
      const metrics = this.getMetrics();
      if (!bounds || !metrics) return;
      const top = bounds.origin.y + bounds.size.height / 2 - metrics.clientHeight / 2;
      this.scrollTo(Math.max(0, bounds.origin.x + bounds.size.width / 2 - metrics.clientWidth / 2),
        Math.max(0, top), 'instant');
    });
    return true;
  }

  onStrategyChange(listener: (strategy: ScrollStrategy) => void) {
    return this.capability?.onStateChange((state) => (
      listener(state.strategy ?? ScrollStrategy.Vertical)
    )) ?? (() => undefined);
  }

  onPageChange(listener: (pageNumber: number, totalPages: number) => void) {
    return this.capability?.onPageChange((event) => {
      if (event.documentId === this.documentId) listener(event.pageNumber, event.totalPages);
    }) ?? (() => undefined);
  }

  onLayoutReady(listener: (totalPages: number, initial: boolean) => void) {
    return this.capability?.onLayoutReady((event) => {
      if (event.documentId === this.documentId) listener(event.totalPages, event.isInitial);
    }) ?? (() => undefined);
  }

  reveal(
    pageIndex: number,
    rects: Rect[],
    {
      behavior = 'smooth',
      insets = {},
    }: {
      behavior?: ScrollBehavior;
      insets?: Insets;
    } = {},
  ) {
    const scope = this.capability?.forDocument(this.documentId);
    const pdfRect = boundingRect(rects);
    const metrics = this.getMetrics();
    if (!scope || !pdfRect || !metrics) return false;

    this.cancelPendingNavigation();

    const axis = scrollAxes[this.getStrategy()];
    const view = viewportInterval(metrics, axis, insets);
    const positionRect = (rect: Rect) => {
      const positioned = this.getContentRect(pageIndex, rect);
      return positioned ? projectRect(positioned, axis) : null;
    };
    let target = positionRect(pdfRect);
    const page = findPage(scope.getSpreadPagesWithRotatedSize(), pageIndex);
    const pageInterval = page ? positionRect({ origin: { x: 0, y: 0 }, size: page.size }) : null;
    const pageIntersectsViewport = pageInterval
      && pageInterval.start < view.end && pageInterval.start + pageInterval.size > view.start;

    if (!target || !pageIntersectsViewport) {
      const alignment = !target || !pageInterval
        ? Math.min(90, (axis.landing + view.comfort / Math.max(1, view.size)) * 100)
        : (pageInterval.start >= view.end ? 82 : 18);
      // Jump into the destination page before animating the short final approach.
      scope.scrollToPage({
        pageNumber: pageIndex + 1,
        pageCoordinates: {
          x: pdfRect.origin.x + pdfRect.size.width / 2,
          y: pdfRect.origin.y + pdfRect.size.height / 2,
        },
        behavior: 'instant',
        alignX: 50, alignY: 50, [axis.align]: alignment,
      });
      this.scheduleSettle(pageIndex, pdfRect, axis, insets, behavior);
      return true;
    }

    if (target.size > view.visibleEnd - view.visibleStart - view.comfort * 2) {
      target = positionRect(rects[0]) ?? target;
    }
    return this.scrollAlongAxis(axis, metrics, revealDelta(target, view), behavior);
  }

  private scrollAlongAxis(axis: ScrollAxis, metrics: ViewportMetrics, delta: number, behavior: ScrollBehavior) {
    if (Math.abs(delta) <= 0.5) return false;
    const position = { x: metrics.scrollLeft, y: metrics.scrollTop };
    position[axis.coordinate] = Math.max(0, position[axis.coordinate] + delta);
    this.scrollTo(position.x, position.y, behavior);
    return true;
  }

  private scheduleSettle(
    pageIndex: number,
    rect: Rect,
    axis: ScrollAxis,
    insets: Insets,
    behavior: ScrollBehavior,
  ) {
    this.afterLayout(() => {
      const positioned = this.getContentRect(pageIndex, rect);
      const metrics = this.getMetrics();
      if (!positioned || !metrics) return;
      const view = viewportInterval(metrics, axis, insets);
      const target = projectRect(positioned, axis);
      this.scrollAlongAxis(axis, metrics, target.start + target.size / 2 - view.start - view.landing, behavior);
    });
  }

  private afterLayout(update: () => void) {
    let remainingFrames = 2;
    const waitForLayout = () => {
      if (--remainingFrames > 0) {
        this.settleFrame = requestAnimationFrame(waitForLayout);
        return;
      }
      this.settleFrame = 0;
      update();
    };
    this.settleFrame = requestAnimationFrame(waitForLayout);
  }

  goToPage(pageNumber: number, behavior: ScrollBehavior = 'instant') {
    this.cancelPendingNavigation();
    const scope = this.capability?.forDocument(this.documentId);
    if (!scope) return false;

    const targetPageNumber = Math.min(Math.max(1, pageNumber), scope.getTotalPages());
    const metrics = this.getMetrics();
    const currentPageNumber = metrics
      ? scope.getMetrics(metrics).currentPage
      : scope.getCurrentPage();
    if (targetPageNumber === currentPageNumber && !scope.getPageChangeState().isChanging) return false;

    const spreads = scope.getSpreadPagesWithRotatedSize();
    const currentPage = findPage(spreads, currentPageNumber - 1);
    const targetPage = findPage(spreads, targetPageNumber - 1);
    const pageCoordinates = currentPage && targetPage && metrics
      ? this.getPageCoordinates(metrics, currentPage, targetPage) : undefined;

    scope.scrollToPage({ pageNumber: targetPageNumber, pageCoordinates, behavior });
    return true;
  }

  preserveView(update: () => void, focus?: { vx: number; vy: number }) {
    this.cancelPendingNavigation();
    const anchor = this.getAnchor(focus);
    update();
    this.restoreAnchor(anchor);
    // SDK scroll writes and React's new page dimensions settle asynchronously.
    this.afterLayout(() => this.restoreAnchor(anchor));
  }

  private getMetrics(): ViewportMetrics | null {
    return this.viewportElement ? measureViewport(this.viewportElement)
      : this.viewportCapability?.forDocument(this.documentId).getMetrics() ?? null;
  }

  private getPageCoordinates(metrics: ViewportMetrics, source: PdfPageObjectWithRotatedSize,
    target = source) {
    const rect = this.getContentRect(source.index, { origin: { x: 0, y: 0 }, size: source.size });
    if (!rect) return undefined;
    const scale = source.rotatedSize.width
      ? rect.size.width / source.rotatedSize.width : rect.size.height / source.rotatedSize.height;
    if (!Number.isFinite(scale) || scale <= 0) return undefined;
    // Preserve the visual offset when changing pages, and the PDF point when
    // restoring this page after a layout/rotation change.
    return pagePointFromOffset({ x: metrics.scrollLeft - rect.origin.x, y: metrics.scrollTop - rect.origin.y },
      target.size, (target.rotation + this.getDocumentRotation()) % 4 as Rotation, scale);
  }

  private scrollTo(x: number, y: number, behavior: ScrollBehavior) {
    if (this.viewportElement) {
      this.viewportElement.scrollTo({ left: x, top: y, behavior });
      return;
    }
    this.viewportCapability?.forDocument(this.documentId).scrollTo({ x, y, behavior });
  }

  getAnchor(focus?: { vx: number; vy: number }): ScrollAnchor | null {
    const scope = this.capability?.forDocument(this.documentId);
    const metrics = this.getMetrics();
    if (!scope || !metrics) return null;
    const scrollMetrics = scope.getMetrics(metrics);
    const pageNumber = scrollMetrics.currentPage;
    const page = findPage(scope.getSpreadPagesWithRotatedSize(), pageNumber - 1);
    const pointMetrics = focus ? { ...metrics, scrollLeft: metrics.scrollLeft + focus.vx,
      scrollTop: metrics.scrollTop + focus.vy } : metrics;
    return { pageNumber, pageCoordinates: page ? this.getPageCoordinates(pointMetrics, page) : undefined,
      ...(focus ? { viewportOffset: { x: focus.vx, y: focus.vy } } : {}) };
  }

  restoreAnchor(anchor: ScrollAnchor | null) {
    this.cancelPendingNavigation();
    if (!anchor) return;
    if (anchor.viewportOffset && anchor.pageCoordinates) {
      const rect = this.getContentRect(Math.min(anchor.pageNumber, this.getTotalPages()) - 1,
        { origin: anchor.pageCoordinates, size: { width: 0, height: 0 } });
      if (rect) {
        this.scrollTo(Math.max(0, rect.origin.x - anchor.viewportOffset.x),
          Math.max(0, rect.origin.y - anchor.viewportOffset.y), 'instant');
        return;
      }
    }
    this.capability?.forDocument(this.documentId).scrollToPage({
      pageNumber: Math.min(anchor.pageNumber, this.getTotalPages()),
      pageCoordinates: anchor.pageCoordinates,
      behavior: 'instant',
    });
  }

  getViewportCenter() {
    const metrics = this.getMetrics();
    return metrics ? { vx: metrics.clientWidth / 2, vy: metrics.clientHeight / 2 } : undefined;
  }

  private getDocumentRotation() {
    return getPluginCapability<RotateCapability>(this.registry, 'rotate')
      ?.forDocument(this.documentId).getRotation() ?? Rotation.Degree0;
  }
}
