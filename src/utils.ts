import type { PluginRegistry } from '@embedpdf/core';
import {
  type PdfActionObject,
  type PdfDestinationObject,
  type PdfLinkTarget,
} from '@embedpdf/models';

export const isPdfDocumentUrl = (value: string) => {
  try {
    const url = new URL(value);
    const isSupportedProtocol = url.protocol === 'file:';

    return isSupportedProtocol && url.pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
};

export function getInitialFileUrl() {
  const params = new URLSearchParams(window.location.search);
  const file = params.get('file') ?? params.get('src');

  return file && isPdfDocumentUrl(file) ? file : undefined;
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
  const viewport = registry.getPlugin('viewport')?.provides?.() as { getViewportGap(): number } | undefined;

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

function restoreScrollAnchor(registry: PluginRegistry, anchor: ScrollAnchor) {
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

export function restoreScrollAnchorAfterLayout(registry: PluginRegistry, anchor: ScrollAnchor | null, delay = 0) {
  if (!anchor) {
    return;
  }

  const restore = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => restoreScrollAnchor(registry, anchor));
    });
  };

  if (delay > 0) {
    return window.setTimeout(restore, delay);
  }

  restore();
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

export interface ScrollPageChangeEvent {
  documentId: string;
  pageNumber: number;
  totalPages: number;
}

export interface ScrollLayoutReadyEvent {
  documentId: string;
  isInitial: boolean;
  pageNumber: number;
  totalPages: number;
}

export interface ScrollDocumentState {
  strategy?: 'vertical' | 'horizontal';
}

export interface ScrollScope {
  getCurrentPage(): number;
  getTotalPages(): number;
  getMetrics(): {
    pageVisibilityMetrics: Array<{
      pageNumber: number;
      original: {
        pageX: number;
        pageY: number;
      };
      scaled: {
        scale: number;
      };
    }>;
  };
  scrollToPage(options: {
    pageNumber: number;
    pageCoordinates?: { x: number; y: number };
    behavior?: 'instant' | 'smooth' | 'auto';
  }): void;
  scrollToNextPage(behavior?: 'instant' | 'smooth' | 'auto'): void;
  scrollToPreviousPage(behavior?: 'instant' | 'smooth' | 'auto'): void;
  setScrollStrategy(strategy: 'vertical' | 'horizontal'): void;
}

export interface ScrollCapability {
  forDocument(documentId: string): ScrollScope;
  getCurrentPage(): number;
  getTotalPages(): number;
  setScrollStrategy(strategy: 'vertical' | 'horizontal', documentId?: string): void;
  onPageChange(listener: (event: ScrollPageChangeEvent) => void): () => void;
  onLayoutReady(listener: (event: ScrollLayoutReadyEvent) => void): () => void;
  onStateChange(listener: (state: ScrollDocumentState) => void): () => void;
}
