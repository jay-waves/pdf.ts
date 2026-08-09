import type { PluginRegistry } from '@embedpdf/core';
import { ScrollStrategy } from '@embedpdf/plugin-scroll';
import { SpreadMode, type SpreadCapability } from '@embedpdf/plugin-spread';
import type { ViewportCapability } from '@embedpdf/plugin-viewport';
import { platform } from '#platform';
import { restoreScrollAnchor } from './page-navigation';
import {
  EMPTY_CLEANUP,
  getActiveDocumentId,
  getDocumentScrollStrategy,
  getPluginCapability,
  type ScrollCapability,
} from './utils';

function isScrollStrategy(value: unknown): value is ScrollStrategy {
  return value === ScrollStrategy.Vertical || value === ScrollStrategy.Horizontal;
}

function isSpreadMode(value: unknown): value is SpreadMode {
  return value === SpreadMode.None || value === SpreadMode.Odd || value === SpreadMode.Even;
}

function isValidPageNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

export function installReadingHistory(registry: PluginRegistry, documentKey?: string) {
  if (!documentKey) return EMPTY_CLEANUP;

  const scroll = getPluginCapability<ScrollCapability>(registry, 'scroll');
  if (!scroll) return EMPTY_CLEANUP;

  const spread = getPluginCapability<SpreadCapability>(registry, 'spread');
  const viewport = getPluginCapability<ViewportCapability>(registry, 'viewport');
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
    };
  };

  const getViewSnapshot = (documentId: string) => {
    const metrics = viewport?.forDocument(documentId).getMetrics();
    return {
      pageNumber: scroll.forDocument(documentId).getCurrentPage(),
      scrollStrategy: getDocumentScrollStrategy(registry, documentId),
      spreadMode: spread?.forDocument(documentId).getSpreadMode(),
      scrollLeft: metrics?.scrollLeft,
      scrollTop: metrics?.scrollTop,
    };
  };

  const hasViewChanged = (
    before: ReturnType<typeof getViewSnapshot>,
    after: ReturnType<typeof getViewSnapshot>,
  ) => (
    before.pageNumber !== after.pageNumber
    || before.scrollStrategy !== after.scrollStrategy
    || before.spreadMode !== after.spreadMode
    || (
      before.scrollLeft !== undefined
      && after.scrollLeft !== undefined
      && Math.abs(before.scrollLeft - after.scrollLeft) > 1
    )
    || (
      before.scrollTop !== undefined
      && after.scrollTop !== undefined
      && Math.abs(before.scrollTop - after.scrollTop) > 1
    )
  );

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
    const initialView = getViewSnapshot(event.documentId);

    platform.readReadingProgress(documentKey)
      .then((saved) => {
        if (disposed) return;
        const viewChangedWhileReading = hasViewChanged(
          initialView,
          getViewSnapshot(event.documentId),
        );
        if (!viewChangedWhileReading && saved && isValidPageNumber(saved.pageNumber)) {
          if (isSpreadMode(saved.spreadMode)) spread?.forDocument(event.documentId).setSpreadMode(saved.spreadMode);
          if (isScrollStrategy(saved.scrollStrategy)) scroll.setScrollStrategy(saved.scrollStrategy, event.documentId);
          restoreScrollAnchor(registry, { documentId: event.documentId, pageNumber: saved.pageNumber });
        }
        historyReady = true;
        if (viewChangedWhileReading) scheduleHistoryWrite();
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
    }
    return historyReady ? flushPendingWrite() : Promise.resolve();
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
