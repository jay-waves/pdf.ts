import { ScrollStrategy } from '@embedpdf/plugin-scroll';
import { SpreadMode } from '@embedpdf/plugin-spread';
import { platform } from '#platform';
import type { PdfScroll } from '../renderer/pdf-scroll';
import type { PageController } from '../viewer/page-controller';

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
  scroll: PdfScroll,
  pages: PageController,
  documentKey?: string,
) {
  if (!documentKey) return;

  let historyReady = false;
  let disposed = false;
  let pendingWriteId = 0;
  let finalWrite: Promise<void> | null = null;

  const getProgress = () => {
    const { strategy, spread: spreadMode } = pages.getSnapshot();
    return {
      pageNumber: pages.getSnapshot().pageNumber,
      scrollStrategy: strategy,
      spreadMode: isSpreadMode(spreadMode) ? spreadMode : undefined,
    };
  };

  const getViewSnapshot = () => {
    const position = scroll.getPosition();
    return {
      pageNumber: pages.getSnapshot().pageNumber,
      mode: pages.getSnapshot().mode,
      scrollStrategy: pages.getSnapshot().strategy,
      spreadMode: pages.getSnapshot().spread,
      ...position,
    };
  };

  const hasViewChanged = (
    before: ReturnType<typeof getViewSnapshot>,
    after: ReturnType<typeof getViewSnapshot>,
  ) => (
    before.pageNumber !== after.pageNumber
    || before.mode !== after.mode
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

  const unsubscribePageChange = pages.subscribe(scheduleHistoryWrite);
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
          const view = pages.getSnapshot();
          pages.applyLayout(
            isScrollStrategy(saved.scrollStrategy) ? saved.scrollStrategy : view.strategy,
            isSpreadMode(saved.spreadMode) ? saved.spreadMode : view.spread,
          );
          pages.goToPage(saved.pageNumber);
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
    unsubscribeLayoutReady?.();
  };
}
