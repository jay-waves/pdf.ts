import type { PluginRegistry } from '@embedpdf/core';
import { ScrollStrategy } from '@embedpdf/plugin-scroll';
import { SpreadMode, type SpreadCapability } from '@embedpdf/plugin-spread';
import { platform } from '#platform';
import {
  EMPTY_CLEANUP,
  getActiveDocumentId,
  getDocumentScrollStrategy,
  restoreScrollAnchor,
  type ScrollCapability,
} from './utils';

function isScrollStrategy(value: unknown): value is ScrollStrategy {
  return value === ScrollStrategy.Vertical || value === ScrollStrategy.Horizontal;
}

function isSpreadMode(value: unknown): value is SpreadMode {
  return value === SpreadMode.None || value === SpreadMode.Odd || value === SpreadMode.Even;
}

export function installReadingHistory(registry: PluginRegistry, documentKey?: string) {
  if (!documentKey) return EMPTY_CLEANUP;

  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  if (!scroll) return EMPTY_CLEANUP;

  const spread = registry.getPlugin('spread')?.provides?.() as SpreadCapability | undefined;
  let historyReady = false;
  let disposed = false;
  let pendingWriteId = 0;
  let finalWrite: Promise<void> | null = null;
  const initialDocumentId = getActiveDocumentId(registry);
  let lastScrollStrategy = initialDocumentId
    ? getDocumentScrollStrategy(registry, initialDocumentId)
    : undefined;

  const getProgress = (documentId: string) => {
    const strategy = getDocumentScrollStrategy(registry, documentId);
    const spreadMode = spread?.forDocument(documentId).getSpreadMode();
    return {
      pageNumber: scroll.forDocument(documentId).getCurrentPage(),
      scrollStrategy: strategy,
      spreadMode: isSpreadMode(spreadMode) ? spreadMode : undefined,
      updatedAt: new Date().toISOString(),
    };
  };

  const flushPendingWrite = () => {
    pendingWriteId = 0;
    const documentId = getActiveDocumentId(registry);
    return documentId
      ? platform.writeReadingProgress(documentKey, getProgress(documentId))
      : Promise.resolve();
  };

  const scheduleHistoryWrite = () => {
    if (!historyReady) return;
    if (pendingWriteId) window.clearTimeout(pendingWriteId);
    pendingWriteId = window.setTimeout(() => {
      pendingWriteId = 0;
      flushPendingWrite().catch((error) => console.warn('[pdf-ts] failed to write reading history', error));
    }, 300);
  };

  const unsubscribePageChange = scroll.onPageChange(scheduleHistoryWrite);
  const unsubscribeSpreadChange = spread?.onSpreadChange(scheduleHistoryWrite);
  const unsubscribeScrollStateChange = scroll.onStateChange((state) => {
    if (!isScrollStrategy(state.strategy) || state.strategy === lastScrollStrategy) return;
    lastScrollStrategy = state.strategy;
    scheduleHistoryWrite();
  });

  let layoutReadyHandled = false;
  let unsubscribeLayoutReady: (() => void) | null = null;
  const handleLayoutReady = (event: { documentId: string }) => {
    if (layoutReadyHandled || event.documentId !== getActiveDocumentId(registry)) return;
    layoutReadyHandled = true;
    unsubscribeLayoutReady?.();
    unsubscribeLayoutReady = null;

    platform.readReadingProgress(documentKey)
      .then((saved) => {
        if (disposed) return;
        if (saved) {
          if (isSpreadMode(saved.spreadMode)) spread?.forDocument(event.documentId).setSpreadMode(saved.spreadMode);
          if (isScrollStrategy(saved.scrollStrategy)) scroll.setScrollStrategy(saved.scrollStrategy, event.documentId);
          restoreScrollAnchor(registry, { documentId: event.documentId, pageNumber: saved.pageNumber });
        }
        historyReady = true;
      })
      .catch((error) => {
        if (disposed) return;
        historyReady = true;
        console.warn('[pdf-ts] failed to read reading history', error);
      });
  };
  unsubscribeLayoutReady = scroll.onLayoutReady(handleLayoutReady);
  if (layoutReadyHandled) {
    unsubscribeLayoutReady();
    unsubscribeLayoutReady = null;
  }

  const flushFinalHistoryWrite = () => {
    if (pendingWriteId) {
      window.clearTimeout(pendingWriteId);
      pendingWriteId = 0;
    }
    if (!historyReady) return Promise.resolve();
    const documentId = getActiveDocumentId(registry);
    return documentId
      ? platform.writeReadingProgress(documentKey, getProgress(documentId))
      : Promise.resolve();
  };

  const onClose = () => {
    if (finalWrite) return;
    finalWrite = flushFinalHistoryWrite()
      .catch((error) => console.warn('[pdf-ts] failed to write final reading history', error))
      .finally(() => {
        finalWrite = null;
      });
  };
  window.addEventListener('pagehide', onClose);

  return () => {
    onClose();
    disposed = true;
    window.removeEventListener('pagehide', onClose);
    unsubscribePageChange();
    unsubscribeSpreadChange?.();
    unsubscribeScrollStateChange();
    unsubscribeLayoutReady?.();
  };
}
