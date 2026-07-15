import type { PluginRegistry } from '@embedpdf/core';
import {
  Rotation,
  type PdfActionObject,
  type PdfDestinationObject,
  type PdfLinkTarget,
  type Position,
  type Size,
} from '@embedpdf/models';
import type { RotateCapability } from '@embedpdf/plugin-rotate';
import { ScrollStrategy, type ScrollCapability } from '@embedpdf/plugin-scroll';
import type { ViewportCapability } from '@embedpdf/plugin-viewport';
export const EMPTY_CLEANUP = () => {};

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches('input, textarea, select, [contenteditable="true"]') || target.isContentEditable;
}

export function getActiveDocumentId(registry: PluginRegistry) {
  return registry.getStore().getState().core.activeDocumentId;
}

export function getFileNameFromUrl(value: string) {
  try {
    const fileName = new URL(value).pathname.split('/').filter(Boolean).at(-1);
    return fileName ? decodeURIComponent(fileName) : undefined;
  } catch {
    return undefined;
  }
}

export function getDocumentScrollStrategy(registry: PluginRegistry, documentId: string) {
  const state = registry.getStore().getState() as {
    plugins?: { scroll?: { documents?: Record<string, { strategy?: ScrollStrategy }> } };
  };
  const strategy = state.plugins?.scroll?.documents?.[documentId]?.strategy;
  return strategy === ScrollStrategy.Horizontal ? strategy : ScrollStrategy.Vertical;
}

export interface ScrollAnchor {
  documentId: string;
  pageNumber: number;
  pageCoordinates?: { x: number; y: number };
}

export function getCurrentScrollAnchor(registry: PluginRegistry): ScrollAnchor | null {
  const documentId = getActiveDocumentId(registry);
  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;

  if (!documentId || !scroll) {
    return null;
  }

  const scrollScope = scroll.forDocument(documentId);
  const pageNumber = scrollScope.getCurrentPage();
  const metrics = scrollScope.getMetrics();
  const pageMetric =
    metrics.pageVisibilityMetrics.find((metric) => metric.pageNumber === pageNumber) ??
    metrics.pageVisibilityMetrics[0];
  const viewport = registry.getPlugin('viewport')?.provides?.() as ViewportCapability | undefined;

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
  if (!anchor) {
    return;
  }

  if (getActiveDocumentId(registry) !== anchor.documentId) {
    return;
  }

  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
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
  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  const viewport = registry.getPlugin('viewport')?.provides?.() as ViewportCapability | undefined;
  const rotate = registry.getPlugin('rotate')?.provides?.() as RotateCapability | undefined;
  if (!documentId || !scroll) return;

  const scrollScope = scroll.forDocument(documentId);
  const targetPageNumber = Math.min(Math.max(1, pageNumber), scrollScope.getTotalPages());
  const viewportScope = viewport?.forDocument(documentId);
  const viewportMetrics = viewportScope?.getMetrics();
  const currentPageNumber = viewportMetrics
    ? scrollScope.getMetrics(viewportMetrics).currentPage
    : scrollScope.getCurrentPage();
  if (targetPageNumber === currentPageNumber && !scrollScope.getPageChangeState().isChanging) return;

  const pages = scrollScope.getSpreadPagesWithRotatedSize().flat();
  const currentPage = pages.find((page) => page.index === currentPageNumber - 1);
  const targetPage = pages.find((page) => page.index === targetPageNumber - 1);
  if (!currentPage || !targetPage || !viewportMetrics) {
    scrollScope.scrollToPage({ pageNumber: targetPageNumber, behavior });
    return;
  }

  const currentRect = scrollScope.getRectPositionForPage(currentPage.index, {
    origin: { x: 0, y: 0 },
    size: currentPage.size,
  });
  if (!currentRect) {
    scrollScope.scrollToPage({ pageNumber: targetPageNumber, behavior });
    return;
  }

  const scale = currentPage.rotatedSize.width
    ? currentRect.size.width / currentPage.rotatedSize.width
    : currentRect.size.height / currentPage.rotatedSize.height;
  if (!Number.isFinite(scale) || scale <= 0) {
    scrollScope.scrollToPage({ pageNumber: targetPageNumber, behavior });
    return;
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
}

export function getDestinationFromTarget(target?: PdfLinkTarget): PdfDestinationObject | undefined {
  if (!target) {
    return undefined;
  }

  if (target.type === 'destination') {
    return target.destination;
  }

  if (target.type === 'action') {
    const action = target.action as PdfActionObject;
    return 'destination' in action ? action.destination : undefined;
  }

  return undefined;
}

export type { ScrollCapability } from '@embedpdf/plugin-scroll';
