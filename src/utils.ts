import type { PluginRegistry } from '@embedpdf/core';
import { ScrollStrategy, type ScrollCapability } from '@embedpdf/plugin-scroll';
import type { ViewportCapability } from '@embedpdf/plugin-viewport';
import {
  type PdfActionObject,
  type PdfDestinationObject,
  type PdfLinkTarget,
} from '@embedpdf/models';
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
