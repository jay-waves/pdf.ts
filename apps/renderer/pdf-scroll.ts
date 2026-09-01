import type { PluginRegistry } from '@embedpdf/core';
import {
  boundingRect,
  Rotation,
  type Position,
  type Rect,
  type Size,
} from '@embedpdf/models';
import {
  ScrollStrategy,
  type ScrollBehavior,
  type ScrollCapability,
} from '@embedpdf/plugin-scroll';
import type { ViewportCapability, ViewportMetrics } from '@embedpdf/plugin-viewport';
import type { RotateCapability } from '@embedpdf/plugin-rotate';
import { getDocumentScrollStrategy, getPluginCapability, isEditableTarget } from '../shared/utils';
import type { ViewerInputSource } from '../viewer/viewer-activity';

const SIDE_BUTTON_LONG_PRESS_MS = 450;
const TARGET_INSET = 12;
const COMFORT_RATIO = 0.08;
const MIN_COMFORT_PX = 24;
const MAX_COMFORT_PX = 64;
const LANDING_RATIO = 0.35;
const FORWARD_ENTRY_RATIO = 0.82;
const BACKWARD_ENTRY_RATIO = 0.18;

type Insets = Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;
type ScrollAnchor = {
  pageNumber: number;
  pageCoordinates?: { x: number; y: number };
};

function landingPosition(
  vertical: boolean,
  viewportSize: number,
  beforeInset: number,
  afterInset: number,
) {
  const comfort = Math.min(MAX_COMFORT_PX, Math.max(MIN_COMFORT_PX, viewportSize * COMFORT_RATIO));
  return Math.min(
    viewportSize - afterInset - comfort,
    Math.max(beforeInset + comfort, viewportSize * (vertical ? LANDING_RATIO : 0.5)),
  );
}

function restorePagePosition(
  position: Position,
  pageSize: Size,
  rotation: Rotation,
  scale: number,
): Position {
  const x = position.x / scale;
  const y = position.y / scale;

  switch (rotation) {
    case Rotation.Degree90: return { x: y, y: pageSize.height - x };
    case Rotation.Degree180: return { x: pageSize.width - x, y: pageSize.height - y };
    case Rotation.Degree270: return { x: pageSize.width - y, y: x };
    default: return { x, y };
  }
}

export class PdfScroll {
  private viewportElement: HTMLElement | null = null;
  private settleFrame = 0;
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
    if (!element && this.settleFrame) cancelAnimationFrame(this.settleFrame);
    this.settleFrame = 0;
    this.viewportElement = element;
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
    const metrics = this.getMetrics();
    return {
      scrollLeft: metrics?.scrollLeft,
      scrollTop: metrics?.scrollTop,
    };
  }

  getRectPosition(pageIndex: number, rect: Rect) {
    return this.capability?.forDocument(this.documentId).getRectPositionForPage(pageIndex, rect) ?? null;
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

    if (this.settleFrame) cancelAnimationFrame(this.settleFrame);
    this.settleFrame = 0;

    const gap = this.getViewportGap();
    const positionRect = (rect: Rect) => {
      const positioned = scope.getRectPositionForPage(pageIndex, rect);
      return positioned ? {
        ...positioned,
        origin: {
          x: positioned.origin.x + gap,
          y: positioned.origin.y + gap,
        },
      } : null;
    };
    let target = positionRect(pdfRect);
    const vertical = this.getStrategy() !== ScrollStrategy.Horizontal;
    const beforeInset = vertical ? (insets.top ?? TARGET_INSET) : (insets.left ?? TARGET_INSET);
    const afterInset = vertical ? (insets.bottom ?? TARGET_INSET) : (insets.right ?? TARGET_INSET);
    const viewportStart = vertical ? metrics.scrollTop : metrics.scrollLeft;
    const viewportSize = vertical ? metrics.clientHeight : metrics.clientWidth;
    const viewportEnd = viewportStart + viewportSize;
    const page = scope.getSpreadPagesWithRotatedSize().flat().find((item) => item.index === pageIndex);
    const pageRect = page ? positionRect({ origin: { x: 0, y: 0 }, size: page.size }) : null;
    const pageStart = pageRect && (vertical ? pageRect.origin.y : pageRect.origin.x);
    const pageEnd = pageRect && pageStart !== null
      ? pageStart + (vertical ? pageRect.size.height : pageRect.size.width)
      : null;
    const pageIntersectsViewport = pageStart !== null
      && pageEnd !== null
      && pageStart < viewportEnd
      && pageEnd > viewportStart;

    if (!target || pageStart === null || pageEnd === null) {
      const targetCenter = {
        x: pdfRect.origin.x + pdfRect.size.width / 2,
        y: pdfRect.origin.y + pdfRect.size.height / 2,
      };
      const comfort = Math.min(MAX_COMFORT_PX, Math.max(MIN_COMFORT_PX, viewportSize * COMFORT_RATIO));
      const landing = vertical ? LANDING_RATIO : 0.5;
      const initialAlignment = Math.min(90, (landing + comfort / Math.max(1, viewportSize)) * 100);

      scope.scrollToPage({
        pageNumber: pageIndex + 1,
        pageCoordinates: targetCenter,
        behavior: 'instant',
        alignX: vertical ? 50 : initialAlignment,
        alignY: vertical ? initialAlignment : 50,
      });
      this.scheduleSettle(pageIndex, rects, vertical, insets, behavior);
      return true;
    }

    if (!pageIntersectsViewport) {
      const targetCenter = {
        x: pdfRect.origin.x + pdfRect.size.width / 2,
        y: pdfRect.origin.y + pdfRect.size.height / 2,
      };
      const forward = pageStart >= viewportEnd;
      const entryAlignment = (forward ? FORWARD_ENTRY_RATIO : BACKWARD_ENTRY_RATIO) * 100;

      // Keep the target visible during the virtual jump, then provide a short
      // directional scroll within its own viewport instead of showing an
      // unrelated preceding page.
      scope.scrollToPage({
        pageNumber: pageIndex + 1,
        pageCoordinates: targetCenter,
        behavior: 'instant',
        alignX: vertical ? 50 : entryAlignment,
        alignY: vertical ? entryAlignment : 50,
      });

      this.scheduleSettle(pageIndex, rects, vertical, insets, behavior);
      return true;
    }

    const targetStart = () => vertical ? target!.origin.y : target!.origin.x;
    const targetSize = () => vertical ? target!.size.height : target!.size.width;
    const availableSize = Math.max(0, viewportSize - beforeInset - afterInset);
    const comfort = Math.min(
      MAX_COMFORT_PX,
      Math.max(MIN_COMFORT_PX, viewportSize * COMFORT_RATIO),
      availableSize / 3,
    );

    if (targetSize() > availableSize - comfort * 2) target = positionRect(rects[0]) ?? target;

    const visibleStart = viewportStart + beforeInset;
    const visibleEnd = viewportStart + viewportSize - afterInset;
    const targetEnd = targetStart() + targetSize();
    let delta = 0;
    if (targetStart() < visibleStart) delta = targetStart() - visibleStart - comfort;
    else if (targetEnd > visibleEnd) delta = targetEnd - visibleEnd + comfort;
    if (Math.abs(delta) <= 0.5) return false;

    this.scrollTo(
      vertical ? metrics.scrollLeft : Math.max(0, metrics.scrollLeft + delta),
      vertical ? Math.max(0, metrics.scrollTop + delta) : metrics.scrollTop,
      behavior,
    );
    return true;
  }

  private scheduleSettle(
    pageIndex: number,
    rects: Rect[],
    vertical: boolean,
    insets: Insets,
    behavior: ScrollBehavior,
  ) {
    let remainingFrames = 2;
    const waitForLayout = () => {
      if (--remainingFrames > 0) {
        this.settleFrame = requestAnimationFrame(waitForLayout);
        return;
      }
      this.settleFrame = 0;
      const target = boundingRect(rects);
      const positioned = target && this.getRectPosition(pageIndex, target);
      const metrics = this.getMetrics();
      if (!positioned || !metrics) return;

      const gap = this.getViewportGap();
      const viewportStart = vertical ? metrics.scrollTop : metrics.scrollLeft;
      const viewportSize = vertical ? metrics.clientHeight : metrics.clientWidth;
      const beforeInset = vertical ? (insets.top ?? TARGET_INSET) : (insets.left ?? TARGET_INSET);
      const afterInset = vertical ? (insets.bottom ?? TARGET_INSET) : (insets.right ?? TARGET_INSET);
      const desiredPosition = landingPosition(vertical, viewportSize, beforeInset, afterInset);
      const targetCenter = (vertical ? positioned.origin.y : positioned.origin.x)
        + gap
        + (vertical ? positioned.size.height : positioned.size.width) / 2;
      const delta = targetCenter - (viewportStart + desiredPosition);
      if (Math.abs(delta) <= 0.5) return;

      this.scrollTo(
        vertical ? metrics.scrollLeft : Math.max(0, metrics.scrollLeft + delta),
        vertical ? Math.max(0, metrics.scrollTop + delta) : metrics.scrollTop,
        behavior,
      );
    };
    this.settleFrame = requestAnimationFrame(waitForLayout);
  }

  goToPage(pageNumber: number, behavior: ScrollBehavior = 'instant') {
    const scope = this.capability?.forDocument(this.documentId);
    if (!scope) return false;

    const targetPageNumber = Math.min(Math.max(1, pageNumber), scope.getTotalPages());
    const metrics = this.getMetrics();
    const currentPageNumber = metrics
      ? scope.getMetrics(metrics).currentPage
      : scope.getCurrentPage();
    if (targetPageNumber === currentPageNumber && !scope.getPageChangeState().isChanging) return false;

    const pages = scope.getSpreadPagesWithRotatedSize().flat();
    const currentPage = pages.find((page) => page.index === currentPageNumber - 1);
    const targetPage = pages.find((page) => page.index === targetPageNumber - 1);
    if (!currentPage || !targetPage || !metrics) {
      scope.scrollToPage({ pageNumber: targetPageNumber, behavior });
      return true;
    }

    const currentRect = scope.getRectPositionForPage(currentPage.index, {
      origin: { x: 0, y: 0 },
      size: currentPage.size,
    });
    if (!currentRect) {
      scope.scrollToPage({ pageNumber: targetPageNumber, behavior });
      return true;
    }

    const scale = currentPage.rotatedSize.width
      ? currentRect.size.width / currentPage.rotatedSize.width
      : currentRect.size.height / currentPage.rotatedSize.height;
    if (!Number.isFinite(scale) || scale <= 0) {
      scope.scrollToPage({ pageNumber: targetPageNumber, behavior });
      return true;
    }

    const targetRotation = (targetPage.rotation + this.getDocumentRotation()) % 4 as Rotation;
    const pageCoordinates = restorePagePosition({
      x: metrics.scrollLeft - currentRect.origin.x - this.getViewportGap(),
      y: metrics.scrollTop - currentRect.origin.y - this.getViewportGap(),
    }, targetPage.size, targetRotation, scale);

    scope.scrollToPage({ pageNumber: targetPageNumber, pageCoordinates, behavior });
    return true;
  }

  goToPosition(
    pageIndex: number,
    pageCoordinates?: { x: number; y: number },
    behavior: ScrollBehavior = 'instant',
  ) {
    const scope = this.capability?.forDocument(this.documentId);
    if (!scope) return false;
    scope.scrollToPage({ pageNumber: pageIndex + 1, pageCoordinates, behavior });
    return true;
  }

  movePages(delta: number, behavior: ScrollBehavior = 'smooth') {
    return this.goToPage(this.getCurrentPage() + delta, behavior);
  }

  setStrategy(strategy: ScrollStrategy) {
    const anchor = this.getAnchor();
    this.capability?.setScrollStrategy(strategy, this.documentId);
    this.restoreAnchor(anchor);
  }

  preserveView(update: () => void) {
    const anchor = this.getAnchor();
    update();
    this.restoreAnchor(anchor);
  }

  restorePage(pageNumber: number) {
    this.capability?.forDocument(this.documentId).scrollToPage({
      pageNumber,
      behavior: 'instant',
    });
  }

  installNavigationInput(onNavigate: (delta: number, source: ViewerInputSource) => void) {
    let sideButtonPress: { button: 3 | 4; startedAt: number } | null = null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isEditableTarget(event.target)) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      event.stopPropagation();
      onNavigate(event.key === 'ArrowLeft' ? -1 : 1, 'Keyboard');
    };
    const stopSideButtonEvent = (event: MouseEvent | PointerEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onSideButtonDown = (event: MouseEvent) => {
      stopSideButtonEvent(event);
      if (event.button === 3 || event.button === 4) {
        sideButtonPress = { button: event.button, startedAt: performance.now() };
      }
    };
    const onSideButtonUp = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const duration = sideButtonPress?.button === event.button
        ? performance.now() - sideButtonPress.startedAt
        : 0;
      sideButtonPress = null;
      onNavigate(
        (event.button === 3 ? -1 : 1) * (duration >= SIDE_BUTTON_LONG_PRESS_MS ? 2 : 1),
        'Mouse',
      );
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!(event.buttons & 24)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const clearSideButtonPress = () => {
      sideButtonPress = null;
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('mousedown', onSideButtonDown, { capture: true });
    window.addEventListener('mouseup', onSideButtonUp, { capture: true });
    window.addEventListener('pointermove', onPointerMove, { capture: true });
    window.addEventListener('auxclick', stopSideButtonEvent, { capture: true });
    window.addEventListener('blur', clearSideButtonPress);
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('mousedown', onSideButtonDown, { capture: true });
      window.removeEventListener('mouseup', onSideButtonUp, { capture: true });
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      window.removeEventListener('auxclick', stopSideButtonEvent, { capture: true });
      window.removeEventListener('blur', clearSideButtonPress);
    };
  }

  private getMetrics(): ViewportMetrics | null {
    const stored = this.viewportCapability?.forDocument(this.documentId).getMetrics();
    const element = this.viewportElement;
    if (!stored) return null;
    if (!element) return stored;
    return {
      ...stored,
      width: element.offsetWidth,
      height: element.offsetHeight,
      scrollTop: element.scrollTop,
      scrollLeft: element.scrollLeft,
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
      clientLeft: element.clientLeft,
      clientTop: element.clientTop,
    };
  }

  private scrollTo(x: number, y: number, behavior: ScrollBehavior) {
    if (this.viewportElement) {
      this.viewportElement.scrollTo({ left: x, top: y, behavior });
      return;
    }
    this.viewportCapability?.forDocument(this.documentId).scrollTo({ x, y, behavior });
  }

  private getAnchor(): ScrollAnchor | null {
    const scope = this.capability?.forDocument(this.documentId);
    const metrics = this.getMetrics();
    if (!scope || !metrics) return null;
    const scrollMetrics = scope.getMetrics(metrics);
    const pageNumber = scrollMetrics.currentPage;
    const pageMetric = scrollMetrics.pageVisibilityMetrics.find((item) => item.pageNumber === pageNumber)
      ?? scrollMetrics.pageVisibilityMetrics[0];
    return {
      pageNumber,
      pageCoordinates: pageMetric ? {
        x: pageMetric.original.pageX,
        y: pageMetric.original.pageY - this.getViewportGap() / (pageMetric.scaled.scale || 1),
      } : undefined,
    };
  }

  private restoreAnchor(anchor: ScrollAnchor | null) {
    if (!anchor) return;
    this.capability?.forDocument(this.documentId).scrollToPage({
      pageNumber: anchor.pageNumber,
      pageCoordinates: anchor.pageCoordinates,
      behavior: 'instant',
    });
  }

  private getDocumentRotation() {
    return getPluginCapability<RotateCapability>(this.registry, 'rotate')
      ?.forDocument(this.documentId).getRotation() ?? Rotation.Degree0;
  }
}
