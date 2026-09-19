import type { PluginRegistry } from '@embedpdf/core';
import { ScrollStrategy, type ScrollBehavior, type ScrollCapability } from '@embedpdf/plugin-scroll';
import { SpreadMode, type SpreadCapability } from '@embedpdf/plugin-spread';
import type { ViewportCapability } from '@embedpdf/plugin-viewport';
import { ZoomMode, type ZoomCapability } from '@embedpdf/plugin-zoom';
import type { PdfScroll } from '../renderer/pdf-scroll';
import { getPluginCapability } from '../shared/utils';

export type PageView = Readonly<{
  mode: 'reading' | 'presentation';
  pageNumber: number;
  totalPages: number;
  strategy: ScrollStrategy;
  spread: SpreadMode;
}>;

export const EMPTY_PAGE_VIEW: PageView = {
  mode: 'reading', pageNumber: 1, totalPages: 0,
  strategy: ScrollStrategy.Vertical, spread: SpreadMode.None,
};

/** Owns view transitions. PdfScroll owns viewport geometry; plugins own layout. */
export class PageController {
  private state: PageView = EMPTY_PAGE_VIEW;
  private listeners = new Set<() => void>();
  private cleanup: Array<() => void> = [];
  private transitioning = false;

  constructor(private registry: PluginRegistry, readonly scroll: PdfScroll) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(patch: Partial<PageView>) {
    const next = { ...this.state, ...patch };
    if ((Object.keys(next) as Array<keyof PageView>).every((key) => next[key] === this.state[key])) return;
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }

  private get spread() {
    return getPluginCapability<SpreadCapability>(this.registry, 'spread')?.forDocument(this.scroll.documentId);
  }

  install() {
    const sync = () => {
      if (this.transitioning) return;
      this.publish({
        totalPages: this.scroll.getTotalPages(),
        ...(this.state.mode === 'reading' ? { pageNumber: this.scroll.getCurrentPage() } : {}),
        strategy: this.scroll.getStrategy(),
        spread: this.spread?.getSpreadMode() ?? SpreadMode.None,
      });
    };
    this.cleanup = [
      this.scroll.onPageChange(sync), this.scroll.onLayoutReady(sync),
      this.scroll.onStrategyChange(sync), this.spread?.onSpreadChange(sync) ?? (() => {}),
    ];
    sync();
    return () => { this.cleanup.splice(0).forEach((dispose) => dispose()); };
  }

  goToPage(pageNumber: number, behavior: ScrollBehavior = 'instant') {
    if (!this.state.totalPages || !Number.isFinite(pageNumber)) return;
    const target = Math.min(this.state.totalPages, Math.max(1, Math.trunc(pageNumber)));
    // Update synchronously so several inputs in one React frame accumulate.
    this.publish({ pageNumber: target });
    if (this.state.mode === 'reading') this.scroll.goToPage(target, behavior);
  }

  movePages(delta: number) {
    if (this.state.mode !== 'presentation') {
      this.goToPage(this.state.pageNumber + delta, 'smooth');
      return;
    }
    if (this.state.pageNumber > this.state.totalPages) {
      if (delta < 0) this.publish({ pageNumber: Math.max(1, this.state.totalPages - 1) });
      return;
    }
    if (delta > 0 && this.state.pageNumber === this.state.totalPages) {
      this.publish({ pageNumber: this.state.totalPages + 1 });
      return;
    }
    this.goToPage(this.state.pageNumber + delta, 'smooth');
  }

  setPresentation(enabled: boolean) {
    if (enabled === (this.state.mode === 'presentation') || !this.state.totalPages) return;
    this.scroll.cancelPendingNavigation();
    if (enabled) {
      this.publish({ mode: 'presentation', pageNumber: this.scroll.getCurrentPage() });
    } else {
      const page = Math.min(this.state.totalPages, this.state.pageNumber);
      this.publish({ mode: 'reading' });
      this.scroll.goToPage(page);
    }
  }

  setStrategy(strategy: ScrollStrategy) {
    this.applyLayout(strategy, this.state.spread);
  }

  toggleSpread() {
    const spread = this.state.spread === SpreadMode.None ? SpreadMode.Odd : SpreadMode.None;
    this.applyLayout(spread === SpreadMode.None ? this.state.strategy : ScrollStrategy.Vertical, spread);
  }

  /** Toolbar and history restoration use the same layout invariants and zoom policy. */
  applyLayout(strategy: ScrollStrategy, spread: SpreadMode) {
    if (this.state.mode !== 'reading') return;
    if (strategy === ScrollStrategy.Horizontal) spread = SpreadMode.None;
    this.transitioning = true;
    try {
      this.scroll.preserveView(() => {
        this.spread?.setSpreadMode(spread);
        getPluginCapability<ScrollCapability>(this.registry, 'scroll')
          ?.setScrollStrategy(strategy, this.scroll.documentId);
        const zoom = getPluginCapability<ZoomCapability>(this.registry, 'zoom')?.forDocument(this.scroll.documentId);
        if (strategy === ScrollStrategy.Horizontal) {
          const viewport = getPluginCapability<ViewportCapability>(this.registry, 'viewport');
          const pages = getPluginCapability<ScrollCapability>(this.registry, 'scroll')
            ?.forDocument(this.scroll.documentId).getSpreadPagesWithRotatedSize().flat() ?? [];
          const height = pages.reduce((max, page) => Math.max(max, page.rotatedSize.height), 0);
          const available = (viewport?.forDocument(this.scroll.documentId).getMetrics().clientHeight ?? 0)
            - 2 * (viewport?.getViewportGap() ?? 0);
          if (available > 0 && height > 0) zoom?.requestZoom(available / height);
        } else if (spread !== SpreadMode.None) zoom?.requestZoom(ZoomMode.FitWidth);
      });
    } finally {
      this.transitioning = false;
      this.publish({ strategy: this.scroll.getStrategy(), spread: this.spread?.getSpreadMode() ?? SpreadMode.None });
    }
  }
}
