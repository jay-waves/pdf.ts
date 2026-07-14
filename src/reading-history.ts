import type { PluginRegistry } from '@embedpdf/core';
import { ScrollStrategy } from '@embedpdf/plugin-scroll';
import { SpreadMode, type SpreadCapability } from '@embedpdf/plugin-spread';
import { platform } from '#platform';
import {
  EMPTY_CLEANUP,
  getActiveDocumentId,
  restoreScrollAnchor,
  runWhenIdle,
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
  let pendingWriteId = 0;
  let cancelPendingIdleWrite: (() => void) | null = null;

  const getScrollStrategy = (documentId: string) => {
    const state = registry.getStore().getState() as {
      plugins?: { scroll?: { documents?: Record<string, { strategy?: unknown }> } };
    };
    return state.plugins?.scroll?.documents?.[documentId]?.strategy;
  };

  const getProgress = (documentId: string) => {
    const strategy = getScrollStrategy(documentId);
    const spreadMode = spread?.forDocument(documentId).getSpreadMode();
    return {
      pageNumber: scroll.forDocument(documentId).getCurrentPage(),
      scrollStrategy: isScrollStrategy(strategy) ? strategy : undefined,
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
    cancelPendingIdleWrite?.();
    cancelPendingIdleWrite = null;
    pendingWriteId = window.setTimeout(() => {
      pendingWriteId = 0;
      cancelPendingIdleWrite = runWhenIdle(() => {
        cancelPendingIdleWrite = null;
        flushPendingWrite().catch((error) => console.warn('[shnctl] failed to write reading history', error));
      });
    }, 300);
  };

  const unsubscribePageChange = scroll.onPageChange(scheduleHistoryWrite);
  const unsubscribeSpreadChange = spread?.onSpreadChange(scheduleHistoryWrite);
  const unsubscribeScrollStateChange = scroll.onStateChange((state) => {
    if (isScrollStrategy(state.strategy)) scheduleHistoryWrite();
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
        if (saved) {
          if (isSpreadMode(saved.spreadMode)) spread?.forDocument(event.documentId).setSpreadMode(saved.spreadMode);
          if (isScrollStrategy(saved.scrollStrategy)) scroll.setScrollStrategy(saved.scrollStrategy, event.documentId);
          restoreScrollAnchor(registry, { documentId: event.documentId, pageNumber: saved.pageNumber });
        }
        historyReady = true;
      })
      .catch((error) => {
        historyReady = true;
        console.warn('[shnctl] failed to read reading history', error);
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
    cancelPendingIdleWrite?.();
    cancelPendingIdleWrite = null;
    if (!historyReady) return Promise.resolve();
    const documentId = getActiveDocumentId(registry);
    return documentId
      ? platform.writeReadingProgress(documentKey, getProgress(documentId))
      : Promise.resolve();
  };

  const onClose = () => {
    flushFinalHistoryWrite().catch((error) => console.warn('[shnctl] failed to write final reading history', error));
  };
  window.addEventListener('beforeunload', onClose);
  window.addEventListener('pagehide', onClose);

  return () => {
    onClose();
    window.removeEventListener('beforeunload', onClose);
    window.removeEventListener('pagehide', onClose);
    unsubscribePageChange();
    unsubscribeSpreadChange?.();
    unsubscribeScrollStateChange();
    unsubscribeLayoutReady?.();
  };
}
