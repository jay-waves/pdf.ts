import type { PluginRegistry } from '@embedpdf/core';
import { ScrollStrategy, type ScrollBehavior, type ScrollCapability } from '@embedpdf/plugin-scroll';
import { SpreadMode, type SpreadCapability } from '@embedpdf/plugin-spread';
import { ZoomMode, type ZoomCapability, type ZoomLevel } from '@embedpdf/plugin-zoom';
import type { InteractionManagerCapability } from '@embedpdf/plugin-interaction-manager';
import type { RotateCapability } from '@embedpdf/plugin-rotate';
import { READING_REGION_MODE, type ReadingRegion } from '../shared/reading-region';
import { StageScrollAdapter } from '../renderer/stage-scroll-adapter';
import type { Rect } from '@embedpdf/models';
import { getPluginCapability } from '../shared/utils';

export type StageSnapshot = Readonly<{
  mode: 'reading' | 'presentation';
  pageNumber: number;
  totalPages: number;
  strategy: ScrollStrategy;
  spread: SpreadMode;
  selectingRegion: boolean;
}>;

export const EMPTY_STAGE_SNAPSHOT: StageSnapshot = {
  mode: 'reading', pageNumber: 1, totalPages: 0,
  strategy: ScrollStrategy.Vertical, spread: SpreadMode.None,
  selectingRegion: false,
};

/**
 * Owns the viewer's spatial state and navigation vocabulary.
 * EmbedPDF v2 capabilities remain the source of truth for layout and zoom;
 * this stage provides one lifecycle and one coherent snapshot to the app.
 */
export class ViewerStage {
  private state: StageSnapshot = EMPTY_STAGE_SNAPSHOT;
  private listeners = new Set<() => void>();
  private cleanup: Array<() => void> = [];
  private transitioning = false;

  private readonly scroll: StageScrollAdapter;

  constructor(
    private readonly registry: PluginRegistry,
    readonly documentId: string,
    scroll = new StageScrollAdapter(registry, documentId),
  ) {
    this.scroll = scroll;
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(patch: Partial<StageSnapshot>) {
    const next = { ...this.state, ...patch };
    if ((Object.keys(next) as Array<keyof StageSnapshot>).every((key) => next[key] === this.state[key])) return;
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }

  private get spread() {
    return getPluginCapability<SpreadCapability>(this.registry, 'spread')?.forDocument(this.scroll.documentId);
  }

  attachSurface(element: HTMLElement | null) {
    this.scroll.attachViewport(element);
  }

  focusViewportAfterAction() {
    const focus = () => {
      // A command may have opened a dialog, menu or search field in this frame.
      if (typeof document !== 'undefined') {
        if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]')) return;
        if (document.activeElement?.matches('input, textarea, select, [contenteditable]')) return;
      }
      if (this.state.mode === 'reading') this.scroll.focusViewport();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focus);
    else focus();
  }

  cancelPendingNavigation() {
    this.scroll.cancelPendingNavigation();
  }

  getPosition() {
    return this.scroll.getPosition();
  }

  scrollVertically(delta: number) {
    if (this.state.mode === 'reading') this.scroll.scrollVertically(delta);
  }

  getFitScales() {
    return this.scroll.getFitScales();
  }

  setZoom(level: ZoomLevel) {
    if (this.state.mode !== 'reading') return;
    this.scroll.cancelPendingNavigation();
    this.preserveZoom(() => getPluginCapability<ZoomCapability>(this.registry, 'zoom')?.forDocument(this.documentId).requestZoom(level));
  }

  preserveZoom(update: () => void, focus = this.scroll.getViewportCenter()) {
    this.scroll.preserveView(update, focus);
  }

  stepZoom(direction: -1 | 1) {
    const zoom = getPluginCapability<ZoomCapability>(this.registry, 'zoom')?.forDocument(this.documentId);
    this.preserveZoom(() => direction > 0 ? zoom?.zoomIn() : zoom?.zoomOut());
  }

  rotate() {
    const rotate = getPluginCapability<RotateCapability>(this.registry, 'rotate')?.forDocument(this.documentId);
    if (!rotate) return;
    if (this.state.mode === 'presentation') return rotate.rotateForward();
    this.transitioning = true;
    try {
      this.scroll.preserveView(() => rotate.rotateForward(), this.scroll.getViewportCenter());
    } finally {
      this.transitioning = false;
    }
  }

  private fitReadingRegion(region: ReadingRegion, pageNumber: number) {
    this.scroll.fitReadingRegion(region, pageNumber);
  }

  beginRegionSelection() {
    if (this.state.mode !== 'reading') return;
    if (this.state.selectingRegion) return this.cancelRegionSelection();
    const interaction = getPluginCapability<InteractionManagerCapability>(this.registry, 'interaction-manager');
    if (!interaction) return;
    this.scroll.cancelPendingNavigation();
    this.publish({ selectingRegion: true });
    interaction.forDocument(this.documentId).activate(READING_REGION_MODE);
    this.focusViewportAfterAction();
  }

  cancelRegionSelection() {
    this.publish({ selectingRegion: false });
    const scope = getPluginCapability<InteractionManagerCapability>(this.registry, 'interaction-manager')?.forDocument(this.documentId);
    if (scope?.getActiveMode() === READING_REGION_MODE) scope.activateDefaultMode();
  }

  completeRegionSelection(pageIndex: number, rect: Rect) {
    if (!this.state.selectingRegion) return;
    const region = this.scroll.normalizeReadingRegion(pageIndex, rect);
    if (!region) return;
    this.publish({ pageNumber: pageIndex + 1 });
    this.cancelRegionSelection();
    this.fitReadingRegion(region, pageIndex + 1);
  }

  captureReadingPosition() {
    return this.scroll.getAnchor();
  }

  restoreReadingPosition(position: ReturnType<StageScrollAdapter['getAnchor']>) {
    this.scroll.cancelPendingNavigation();
    this.scroll.restoreAnchor(position);
  }

  getCurrentPage() {
    return this.scroll.getCurrentPage();
  }

  onLayoutReady(listener: (totalPages: number, initial: boolean) => void) {
    return this.scroll.onLayoutReady(listener);
  }

  onStrategyChange(listener: (strategy: ScrollStrategy) => void) {
    return this.scroll.onStrategyChange(listener);
  }

  reveal(pageIndex: number, rects: Rect[], options?: Parameters<StageScrollAdapter['reveal']>[2]) {
    return this.scroll.reveal(pageIndex, rects, options);
  }

  install() {
    const interaction = getPluginCapability<InteractionManagerCapability>(this.registry, 'interaction-manager');
    interaction?.registerMode({ id: READING_REGION_MODE, scope: 'page', exclusive: true, cursor: 'crosshair' });
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
      interaction?.forDocument(this.documentId).onModeChange((mode) => {
        if (mode !== READING_REGION_MODE && this.state.selectingRegion) this.publish({ selectingRegion: false });
      }) ?? (() => {}),
    ];
    sync();
    return () => {
      this.cancelRegionSelection();
      this.scroll.cancelPendingNavigation();
      this.cleanup.splice(0).forEach((dispose) => dispose());
    };
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
    this.cancelRegionSelection();
    if (enabled) {
      this.publish({ mode: 'presentation', pageNumber: this.scroll.getCurrentPage() });
    } else {
      const page = Math.min(this.state.totalPages, this.state.pageNumber);
      this.publish({ mode: 'reading' });
      this.goToPage(page);
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
          const fit = this.getFitScales();
          if (fit && fit.height > 0) zoom?.requestZoom(fit.height);
        } else if (spread !== SpreadMode.None) zoom?.requestZoom(ZoomMode.FitWidth);
      });
    } finally {
      this.transitioning = false;
      this.publish({ strategy: this.scroll.getStrategy(), spread: this.spread?.getSpreadMode() ?? SpreadMode.None });
    }
  }
}
