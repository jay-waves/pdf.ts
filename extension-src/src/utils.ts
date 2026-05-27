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
