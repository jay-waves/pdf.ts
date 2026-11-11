/**
 * Translate one-based application pages and saved reading positions to native
 * page indexes and viewpoints. Delegate geometry, anchors and animation to Stage;
 * renderer adapters must not import ViewerStage or feature UI.
 */
import type { Kernel } from '@embedpdf/core';
import type { Rect } from '@embedpdf/core-geometry';
import { StageToken, type StageCapability, type ScrollBehaviorKind, type Viewpoint } from '@embedpdf/plugin-stage';
import { StageToken as StageHostToken } from '@embedpdf/plugin-stage/contract/host';
import { normalizeReadingRegion, readingRegionRect, type ReadingRegion } from '../shared/reading-region';
import type { Insets } from './viewport-geometry';

export type ScrollAnchor = {
  pageNumber: number;
  pageCoordinates?: { x: number; y: number };
  viewportOffset?: { x: number; y: number };
  viewpoint?: Viewpoint;
};

/** Application navigation policy over v3's single coordinate system. */
export class StageScrollAdapter {
  private viewport: HTMLElement | null = null;
  constructor(private readonly kernel: Kernel, readonly documentId: string) {}
  get capability() { return this.kernel.tryCapability(StageToken, this.documentId); }
  private get host() { return this.kernel.tryCapability(StageHostToken, this.documentId); }
  attachViewport(element: HTMLElement | null) { this.cancelPendingNavigation(); this.viewport = element; }
  focusViewport() { this.viewport?.focus({ preventScroll: true }); }
  cancelPendingNavigation() { this.capability?.stopMotion(); }
  getCurrentPage() { return (this.capability?.getCurrentPageIndex() ?? 0) + 1; }
  getTotalPages() { return this.capability?.getPageCount() ?? 0; }
  getStrategy() { return this.capability?.getSettings().layout === 'horizontal' ? 'horizontal' as const : 'vertical' as const; }
  getPosition() {
    const metrics = this.host?.getScrollMetrics();
    return { scrollLeft: metrics?.scrollLeft, scrollTop: metrics?.scrollTop };
  }
  scrollVertically(delta: number) { this.capability?.scrollBy({ top: delta, behavior: 'smooth' }); }
  getFitScales() {
    const stage = this.capability;
    if (!stage) return null;
    const size = stage.getViewportSize();
    const pages = stage.listCurrentItemPages();
    if (!pages.length || !size.width || !size.height) return null;
    const settings = stage.getSettings();
    const padding = typeof settings.padding === 'number'
      ? { left: settings.padding, right: settings.padding, top: settings.padding, bottom: settings.padding }
      : settings.padding;
    const gap = typeof settings.gap === 'number' ? settings.gap : settings.gap.px / stage.getZoomLevel();
    const sizes = pages.map(page => {
      const box = stage.getPageBox(page.ref);
      return box ? { width: box.width, height: box.height } : page.size;
    });
    const width = (size.width - padding.left - padding.right) / (sizes.reduce((n, p) => n + p.width, 0) + gap * (sizes.length - 1));
    const height = (size.height - padding.top - padding.bottom) / Math.max(...sizes.map(p => p.height));
    return { width, height, page: Math.min(width, height) };
  }
  normalizeReadingRegion(pageIndex: number, rect: Rect) {
    const page = this.kernel.documents.listPages(this.documentId)[pageIndex];
    return page ? normalizeReadingRegion(rect, page.size) : null;
  }
  fitReadingRegion(region: ReadingRegion, pageNumber: number) {
    const stage = this.capability;
    const page = this.kernel.documents.listPages(this.documentId)[pageNumber - 1];
    if (!page || !stage) return false;
    stage.reveal(pageNumber - 1, { rect: readingRegionRect(region, page.size), zoom: 'fit', align: { x: 'center', y: 'center' }, behavior: 'instant' });
    return true;
  }
  onStrategyChange(listener: (strategy: 'vertical' | 'horizontal') => void) {
    return this.capability?.onSettingsChanged(() => listener(this.getStrategy())) ?? (() => {});
  }
  onPageChange(listener: (pageNumber: number, totalPages: number) => void) {
    return this.capability?.onPageChanged(() => listener(this.getCurrentPage(), this.getTotalPages())) ?? (() => {});
  }
  onLayoutReady(listener: (totalPages: number, initial: boolean) => void) {
    let initialized = false;
    let disposed = false;
    let current: StageCapability | null = null;
    let offViewport = () => {};
    const notify = () => {
      if (disposed) return;
      const total = this.getTotalPages();
      if (!total || !this.capability?.getViewportSize().width) return;
      listener(total, !initialized); initialized = true;
    };
    const connect = () => {
      const capability = this.capability;
      if (capability === current) return;
      offViewport();
      current = capability;
      offViewport = capability?.onViewportChanged(notify) ?? (() => {});
      queueMicrotask(notify);
    };
    // History can be installed before Stage exists. Subscribe when it becomes
    // available instead of permanently missing the first ready viewport.
    const offRegistry = this.kernel.subscribe?.(connect) ?? (() => {});
    connect();
    return () => { disposed = true; offRegistry(); offViewport(); };
  }
  reveal(pageIndex: number, rects: Rect[], { behavior = 'smooth', insets = {} }: { behavior?: ScrollBehaviorKind; insets?: Insets } = {}) {
    const stage = this.capability;
    if (!stage || !rects.length) return false;
    const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
    const rect = { x, y, width: Math.max(...rects.map(r => r.x + r.width)) - x, height: Math.max(...rects.map(r => r.y + r.height)) - y };
    const viewport = stage.getViewportSize();
    const margin = Math.max(insets.top ?? 12, Math.min(64, viewport.height * .08));
    stage.reveal(pageIndex, { rect, zoom: 'keep', align: { y: Math.min(.8, Math.max(.35, margin / Math.max(1, viewport.height))) }, behavior });
    return true;
  }
  goToPage(pageNumber: number, behavior: ScrollBehaviorKind = 'instant') {
    const stage = this.capability;
    if (!stage) return false;
    stage.goToPage(pageNumber - 1, { behavior }); return true;
  }
  preserveView(update: () => void, _focus?: { vx: number; vy: number }) {
    // Native v3 zoom and settings changes preserve the anchor in the same transaction.
    this.cancelPendingNavigation(); update();
  }
  getAnchor(focus?: { vx: number; vy: number }): ScrollAnchor | null {
    const stage = this.capability;
    if (!stage || !stage.getPageCount()) return null;
    const pageIndex = stage.getCurrentPageIndex();
    const point = stage.viewportToPage(pageIndex, focus ? { x: focus.vx, y: focus.vy } : { x: 0, y: 0 });
    return { pageNumber: pageIndex + 1, viewpoint: stage.getViewpoint(), ...(point ? { pageCoordinates: point } : {}), ...(focus ? { viewportOffset: { x: focus.vx, y: focus.vy } } : {}) };
  }
  restoreAnchor(anchor: ScrollAnchor | null) {
    const stage = this.capability;
    if (!stage || !anchor) return;
    this.cancelPendingNavigation();
    if (anchor.viewpoint) stage.goToPage(anchor.pageNumber - 1, { viewpoint: anchor.viewpoint, behavior: 'instant' });
    else if (anchor.pageCoordinates) stage.reveal(anchor.pageNumber - 1, { rect: { ...anchor.pageCoordinates, width: 0, height: 0 }, align: { x: 'start', y: 'start' }, behavior: 'instant' });
    else stage.goToPage(anchor.pageNumber - 1, { behavior: 'instant' });
  }
  getViewportCenter() {
    const size = this.capability?.getViewportSize();
    return size ? { vx: size.width / 2, vy: size.height / 2 } : undefined;
  }
}
