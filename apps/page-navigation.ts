import type { PluginRegistry } from '@embedpdf/core';
import {
  Rotation,
  type Position,
  type Size,
} from '@embedpdf/models';
import type { RotateCapability } from '@embedpdf/plugin-rotate';
import type { ScrollCapability } from '@embedpdf/plugin-scroll';
import type { ViewportCapability } from '@embedpdf/plugin-viewport';
import {
  getActiveDocumentId,
  getPluginCapability,
  isEditableTarget,
} from './utils';

const SIDE_BUTTON_LONG_PRESS_MS = 450;

interface ScrollAnchor {
  documentId: string;
  pageNumber: number;
  pageCoordinates?: { x: number; y: number };
}

export function getCurrentScrollAnchor(registry: PluginRegistry): ScrollAnchor | null {
  const documentId = getActiveDocumentId(registry);
  const scroll = getPluginCapability<ScrollCapability>(registry, 'scroll');

  if (!documentId || !scroll) return null;

  const scrollScope = scroll.forDocument(documentId);
  const pageNumber = scrollScope.getCurrentPage();
  const metrics = scrollScope.getMetrics();
  const pageMetric =
    metrics.pageVisibilityMetrics.find((metric) => metric.pageNumber === pageNumber) ??
    metrics.pageVisibilityMetrics[0];
  const viewport = getPluginCapability<ViewportCapability>(registry, 'viewport');

  return {
    documentId,
    pageNumber,
    pageCoordinates: pageMetric
      ? {
          x: pageMetric.original.pageX,
          y: pageMetric.original.pageY - (viewport?.getViewportGap() ?? 0) / (pageMetric.scaled.scale || 1),
        }
      : undefined,
  };
}

export function restoreScrollAnchor(registry: PluginRegistry, anchor: ScrollAnchor | null) {
  if (!anchor || getActiveDocumentId(registry) !== anchor.documentId) return;

  const scroll = getPluginCapability<ScrollCapability>(registry, 'scroll');
  scroll?.forDocument(anchor.documentId).scrollToPage({
    pageNumber: anchor.pageNumber,
    pageCoordinates: anchor.pageCoordinates,
    behavior: 'instant',
  });
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

export function scrollToPagePreservingViewport(
  registry: PluginRegistry,
  pageNumber: number,
  behavior: ScrollBehavior = 'instant',
) {
  const documentId = getActiveDocumentId(registry);
  const scroll = getPluginCapability<ScrollCapability>(registry, 'scroll');
  const viewport = getPluginCapability<ViewportCapability>(registry, 'viewport');
  const rotate = getPluginCapability<RotateCapability>(registry, 'rotate');
  if (!documentId || !scroll) return false;

  const scrollScope = scroll.forDocument(documentId);
  const targetPageNumber = Math.min(Math.max(1, pageNumber), scrollScope.getTotalPages());
  const viewportScope = viewport?.forDocument(documentId);
  const viewportMetrics = viewportScope?.getMetrics();
  const currentPageNumber = viewportMetrics
    ? scrollScope.getMetrics(viewportMetrics).currentPage
    : scrollScope.getCurrentPage();
  if (targetPageNumber === currentPageNumber && !scrollScope.getPageChangeState().isChanging) {
    return false;
  }

  const pages = scrollScope.getSpreadPagesWithRotatedSize().flat();
  const currentPage = pages.find((page) => page.index === currentPageNumber - 1);
  const targetPage = pages.find((page) => page.index === targetPageNumber - 1);
  if (!currentPage || !targetPage || !viewportMetrics) {
    scrollScope.scrollToPage({ pageNumber: targetPageNumber, behavior });
    return true;
  }

  const currentRect = scrollScope.getRectPositionForPage(currentPage.index, {
    origin: { x: 0, y: 0 },
    size: currentPage.size,
  });
  if (!currentRect) {
    scrollScope.scrollToPage({ pageNumber: targetPageNumber, behavior });
    return true;
  }

  const scale = currentPage.rotatedSize.width
    ? currentRect.size.width / currentPage.rotatedSize.width
    : currentRect.size.height / currentPage.rotatedSize.height;
  if (!Number.isFinite(scale) || scale <= 0) {
    scrollScope.scrollToPage({ pageNumber: targetPageNumber, behavior });
    return true;
  }

  const viewportGap = viewport?.getViewportGap() ?? 0;
  const documentRotation = rotate?.forDocument(documentId).getRotation() ?? Rotation.Degree0;
  const targetRotation = (targetPage.rotation + documentRotation) % 4 as Rotation;
  const pageCoordinates = restorePagePosition({
    x: viewportMetrics.scrollLeft - currentRect.origin.x - viewportGap,
    y: viewportMetrics.scrollTop - currentRect.origin.y - viewportGap,
  }, targetPage.size, targetRotation, scale);

  scrollScope.scrollToPage({
    pageNumber: targetPageNumber,
    pageCoordinates,
    behavior,
  });
  return true;
}

export function moveByPages(
  registry: PluginRegistry,
  delta: number,
  behavior: ScrollBehavior = 'smooth',
) {
  const documentId = getActiveDocumentId(registry);
  const scroll = getPluginCapability<ScrollCapability>(registry, 'scroll');
  if (!documentId || !scroll) return false;

  const scrollScope = scroll.forDocument(documentId);
  return scrollToPagePreservingViewport(
    registry,
    scrollScope.getCurrentPage() + delta,
    behavior,
  );
}

export function installPageNavigationInput(
  registry: PluginRegistry,
  onNavigate: () => void,
) {
  let sideButtonPress: { button: 3 | 4; startedAt: number } | null = null;

  const navigate = (delta: number) => {
    moveByPages(registry, delta);
    onNavigate();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (isEditableTarget(event.target)) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    event.preventDefault();
    event.stopPropagation();
    navigate(event.key === 'ArrowLeft' ? -1 : 1);
  };

  const stopSideButtonEvent = (event: MouseEvent | PointerEvent) => {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onSideButtonDown = (event: MouseEvent) => {
    stopSideButtonEvent(event);
    if (event.button !== 3 && event.button !== 4) return;
    sideButtonPress = { button: event.button, startedAt: performance.now() };
  };

  const onSideButtonUp = (event: MouseEvent) => {
    if (event.button !== 3 && event.button !== 4) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const duration = sideButtonPress?.button === event.button
      ? performance.now() - sideButtonPress.startedAt
      : 0;
    sideButtonPress = null;
    const direction = event.button === 3 ? -1 : 1;
    navigate(direction * (duration >= SIDE_BUTTON_LONG_PRESS_MS ? 2 : 1));
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
