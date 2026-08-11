import type { PluginRegistry } from '@embedpdf/core';
import { ScrollStrategy } from '@embedpdf/plugin-scroll';
import { SpreadMode, type SpreadCapability } from '@embedpdf/plugin-spread';
import { platform } from '#platform';
import type { PdfScroll } from './pdf-scroll';
import {
  EMPTY_CLEANUP,
  getPluginCapability,
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

export function installReadingHistory(
  registry: PluginRegistry,
  scroll: PdfScroll,
  documentKey?: string,
) {
  if (!documentKey) return EMPTY_CLEANUP;

  const spread = getPluginCapability<SpreadCapability>(registry, 'spread');
  const spreadScope = spread?.forDocument(scroll.documentId);
  let historyReady = false;
  let disposed = false;
  let pendingWriteId = 0;
  let finalWrite: Promise<void> | null = null;
  let lastScrollStrategy = scroll.getStrategy();

  const getProgress = () => {
    const strategy = scroll.getStrategy();
    const spreadMode = spreadScope?.getSpreadMode();
    return {
      pageNumber: scroll.getCurrentPage(),
      scrollStrategy: strategy,
      spreadMode: isSpreadMode(spreadMode) ? spreadMode : undefined,
    };
  };

  const getViewSnapshot = () => {
    const position = scroll.getPosition();
    return {
      pageNumber: scroll.getCurrentPage(),
      scrollStrategy: scroll.getStrategy(),
      spreadMode: spreadScope?.getSpreadMode(),
      ...position,
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
    return platform.writeReadingProgress(documentKey, getProgress());
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
  const unsubscribeScrollStateChange = scroll.onStrategyChange((strategy) => {
    if (strategy === lastScrollStrategy) return;
    lastScrollStrategy = strategy;
    scheduleHistoryWrite();
  });

  let layoutReadyHandled = false;
  let unsubscribeLayoutReady: (() => void) | null = null;
  const handleLayoutReady = () => {
    if (layoutReadyHandled) return;
    layoutReadyHandled = true;
    unsubscribeLayoutReady?.();
    unsubscribeLayoutReady = null;
    const initialView = getViewSnapshot();

    platform.readReadingProgress(documentKey)
      .then((saved) => {
        if (disposed) return;
        const viewChangedWhileReading = hasViewChanged(
          initialView,
          getViewSnapshot(),
        );
        if (!viewChangedWhileReading && saved && isValidPageNumber(saved.pageNumber)) {
          if (isSpreadMode(saved.spreadMode)) spreadScope?.setSpreadMode(saved.spreadMode);
          if (isScrollStrategy(saved.scrollStrategy)) scroll.setStrategy(saved.scrollStrategy);
          scroll.restorePage(saved.pageNumber);
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
