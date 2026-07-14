import type { PluginRegistry } from '@embedpdf/core';
import type { ScrollCapability } from '@embedpdf/plugin-scroll';
import type { ViewportCapability } from '@embedpdf/plugin-viewport';
import {
  type PdfActionObject,
  type PdfDestinationObject,
  type PdfLinkTarget,
} from '@embedpdf/models';
import { platform } from '#platform';

export const EMPTY_CLEANUP = () => {};

export const isPdfDocumentUrl = (value: string) => {
  try {
    const url = new URL(value);

    return url.protocol === 'file:' && url.pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
};

export function getInitialFileUrl() {
  return platform.getInitialDocumentUrl();
}

export function getActiveDocumentId(registry: PluginRegistry) {
  return registry.getStore().getState().core.activeDocumentId;
}

export function runWhenIdle(callback: () => void) {
  const id = requestIdleCallback(callback, { timeout: 1200 });
  return () => cancelIdleCallback(id);
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
