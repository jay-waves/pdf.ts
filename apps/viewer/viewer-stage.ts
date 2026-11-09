/**
 * Application navigation and reading/presentation state over EmbedPDF StageToken.
 * Native Stage owns layout, projection, rotation and bounded scrolling. Reading-area
 * selection is a temporary interaction tool: fit its page-space rectangle without
 * creating annotations or dirtying the PDF.
 */
import type { Kernel } from '@embedpdf/core';
import type { Rect } from '@embedpdf/core-geometry';
import { StageToken, type ScrollBehaviorKind } from '@embedpdf/plugin-stage';
import { InteractionToken, samplePointOn, type PointerSample } from '@embedpdf/plugin-interaction/contract/host';
import { READING_REGION_MODE, type ReadingRegion } from '../shared/reading-region';
import { StageScrollAdapter } from '../renderer/stage-scroll-adapter';

export const ScrollStrategy = { Vertical: 'vertical', Horizontal: 'horizontal' } as const;
export type ScrollStrategy = typeof ScrollStrategy[keyof typeof ScrollStrategy];
export const SpreadMode = { None: 'none', Odd: 'odd', Even: 'even' } as const;
export type SpreadMode = typeof SpreadMode[keyof typeof SpreadMode];
export const ZoomMode = { FitPage: 'fit-page', FitWidth: 'fit-width' } as const;
export type ZoomLevel = number | typeof ZoomMode[keyof typeof ZoomMode];
type ScrollBehavior = ScrollBehaviorKind;

export type StageSnapshot = Readonly<{
  mode: 'reading' | 'presentation';
  pageNumber: number;
  totalPages: number;
  strategy: ScrollStrategy;
  spread: SpreadMode;
  selectingRegion: boolean;
}>;

export type RegionPreview = Readonly<{ pageIndex: number; rect: Rect }> | null;

export const EMPTY_STAGE_SNAPSHOT: StageSnapshot = {
  mode: 'reading', pageNumber: 1, totalPages: 0,
  strategy: ScrollStrategy.Vertical, spread: SpreadMode.None,
  selectingRegion: false,
};

/**
 * Owns the viewer's spatial state and navigation vocabulary.
 * The native v3 stage remains the source of truth for layout and zoom;
 * this stage provides one lifecycle and one coherent snapshot to the app.
 */
export class ViewerStage {
  private state: StageSnapshot = EMPTY_STAGE_SNAPSHOT;
  private listeners = new Set<() => void>();
  private regionPreview: RegionPreview = null;
  private regionListeners = new Set<() => void>();
  private cleanup: Array<() => void> = [];
  private transitioning = false;

  private readonly scroll: StageScrollAdapter;

  constructor(
    private readonly registry: Kernel,
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

  // Pointer movement is local to the preview; navigation subscribers stay idle.
  getRegionPreview = () => this.regionPreview;
  subscribeRegionPreview = (listener: () => void) => {
    this.regionListeners.add(listener);
    return () => { this.regionListeners.delete(listener); };
  };

  private publishRegionPreview(next: RegionPreview) {
    const previous = this.regionPreview;
    if (previous === next || (previous && next && previous.pageIndex === next.pageIndex
      && previous.rect.x === next.rect.x && previous.rect.y === next.rect.y
      && previous.rect.width === next.rect.width && previous.rect.height === next.rect.height)) return;
    this.regionPreview = next;
    this.regionListeners.forEach(listener => listener());
  }

  private publish(patch: Partial<StageSnapshot>) {
    const next = { ...this.state, ...patch };
    if ((Object.keys(next) as Array<keyof StageSnapshot>).every((key) => next[key] === this.state[key])) return;
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }

  private get spread() {
    return this.registry.tryCapability(StageToken, this.documentId);
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
    this.preserveZoom(() => this.spread?.zoomTo(typeof level === 'number' ? level : { mode: level }));
  }

  preserveZoom(update: () => void, focus = this.scroll.getViewportCenter()) {
    this.scroll.preserveView(update, focus);
  }

  stepZoom(direction: -1 | 1) {
    const zoom = this.spread;
    this.preserveZoom(() => direction > 0 ? zoom?.zoomIn() : zoom?.zoomOut());
  }

  rotate() {
    const rotate = this.spread;
    if (!rotate) return;
    if (this.state.mode === 'presentation') return rotate.rotateViewBy(90);
    this.transitioning = true;
    try {
      this.scroll.preserveView(() => rotate.rotateViewBy(90), this.scroll.getViewportCenter());
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
    const interaction = this.registry.tryCapability(InteractionToken, this.documentId);
    if (!interaction) return;
    this.scroll.cancelPendingNavigation();
    this.publish({ selectingRegion: true });
    interaction.activateTool(READING_REGION_MODE);
    this.focusViewportAfterAction();
  }

  cancelRegionSelection() {
    this.publishRegionPreview(null);
    this.publish({ selectingRegion: false });
    const scope = this.registry.tryCapability(InteractionToken, this.documentId);
    if (scope?.getActiveToolId() === READING_REGION_MODE) scope.activateDefaultTool();
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
    let current: ReturnType<Kernel['tryCapability']> = null;
    let dispose = () => {};
    const connect = () => {
      const ready = this.registry.tryCapability(StageToken, this.documentId);
      if (ready === current) return;
      dispose(); current = ready;
      dispose = ready ? this.installReady() : () => {};
    };
    const unsubscribe = this.registry.subscribe?.(connect) ?? (() => {});
    connect();
    return () => { unsubscribe(); dispose(); };
  }

  private installReady() {
    const interaction = this.registry.tryCapability(InteractionToken, this.documentId);
    let origin: { pageIndex: number; x: number; y: number } | null = null;
    const preview = (event: PointerSample) => {
      if (!origin) return null;
      const page = this.registry.documents.listPages(this.documentId)[origin.pageIndex];
      const point = page && samplePointOn(event, page.ref);
      if (!page || !point) return null;
      const x = Math.max(0, Math.min(page.size.width, point.x));
      const y = Math.max(0, Math.min(page.size.height, point.y));
      return { pageIndex: origin.pageIndex, rect: { x: Math.min(origin.x, x), y: Math.min(origin.y, y), width: Math.abs(x - origin.x), height: Math.abs(y - origin.y) } };
    };
    const unregisterRegionTool = interaction?.registerTool({
      id: READING_REGION_MODE, cursor: 'crosshair', touch: 'draw',
    });
    const unregisterRegionHandler = interaction?.registerHandler({
      id: READING_REGION_MODE, priority: 100, enabledFor: tool => tool.id === READING_REGION_MODE,
      onPointerDown: event => {
        const pageIndex = this.registry.documents.listPages(this.documentId).findIndex(p => p.ref.objectNumber === event.page?.ref.objectNumber);
        if (!this.state.selectingRegion || pageIndex < 0) return false;
        if (!event.page) return false;
        origin = { pageIndex, ...event.page.point }; return true;
      },
      onPointerMove: event => this.publishRegionPreview(this.state.selectingRegion ? preview(event) : null),
      onPointerCancel: () => { origin = null; this.publishRegionPreview(null); },
      onPointerUp: event => {
        const region = preview(event); origin = null;
        this.publishRegionPreview(null);
        if (region && Math.min(region.rect.width, region.rect.height) * (this.spread?.getZoomLevel() ?? 1) >= 5) this.completeRegionSelection(region.pageIndex, region.rect);
      },
    });
    const sync = () => {
      if (this.transitioning) return;
      this.publish({
        totalPages: this.scroll.getTotalPages(),
        ...(this.state.mode === 'reading' ? { pageNumber: this.scroll.getCurrentPage() } : {}),
        strategy: this.scroll.getStrategy(),
        spread: this.spread?.getSettings().spread ?? SpreadMode.None,
      });
    };
    this.cleanup = [
      this.scroll.onPageChange(sync), this.scroll.onLayoutReady(sync),
      this.scroll.onStrategyChange(sync), this.spread?.onSettingsChanged(sync) ?? (() => {}),
      interaction?.onToolChanged(({ toolId }) => {
        if (toolId !== READING_REGION_MODE) {
          origin = null;
          if (this.state.selectingRegion) this.cancelRegionSelection();
        }
      }) ?? (() => {}),
    ];
    sync();
    return () => {
      this.cancelRegionSelection();
      this.scroll.cancelPendingNavigation();
      this.cleanup.splice(0).forEach((dispose) => dispose());
      unregisterRegionHandler?.();
      unregisterRegionTool?.();
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
        this.spread?.updateSettings({ spread, layout: strategy });
        const zoom = this.spread;
        if (strategy === ScrollStrategy.Horizontal) {
          const fit = this.getFitScales();
          if (fit && fit.height > 0) zoom?.zoomTo(fit.height);
        } else if (spread !== SpreadMode.None) zoom?.zoomTo({ mode: ZoomMode.FitWidth });
      });
    } finally {
      this.transitioning = false;
      this.publish({ strategy: this.scroll.getStrategy(), spread: this.spread?.getSettings().spread ?? SpreadMode.None });
    }
  }
}
