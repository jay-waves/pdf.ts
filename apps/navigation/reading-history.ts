import { ScrollStrategy } from '../viewer/viewer-stage';
import { SpreadMode } from '../viewer/viewer-stage';
import { platform } from '#platform';
import type { ViewerStage } from '../viewer/viewer-stage';
import type { ReadingProgress } from '../platform/types';

function isScrollStrategy(value: unknown): value is ScrollStrategy {
  return value === ScrollStrategy.Vertical || value === ScrollStrategy.Horizontal;
}

function isSpreadMode(value: unknown): value is SpreadMode {
  return value === SpreadMode.None || value === SpreadMode.Odd || value === SpreadMode.Even;
}

function isValidPageNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function validViewpoint(value: ReadingProgress['viewpoint']): value is NonNullable<ReadingProgress['viewpoint']> {
  if (!value || typeof value !== 'object' || !value.anchor || typeof value.anchor !== 'object'
    || !value.zoom || typeof value.zoom !== 'object') return false;
  const { anchor, zoom } = value;
  if (!Number.isInteger(anchor.pageIndex) || anchor.pageIndex < 0
    || !Number.isFinite(anchor.fractionX) || !Number.isFinite(anchor.fractionY)) return false;
  if ('mode' in zoom) return ['automatic', 'fit-page', 'fit-width', 'fit-all'].includes(zoom.mode);
  const level = 'level' in zoom ? zoom.level : 'pageWidth' in zoom ? zoom.pageWidth : 'pageHeight' in zoom ? zoom.pageHeight : NaN;
  return Number.isFinite(level) && level > 0;
}

export function installReadingHistory(
  stage: ViewerStage,
  documentKey?: string,
  restore = true,
) {
  if (!documentKey) return;

  let historyReady = false;
  let disposed = false;
  let pendingWriteId = 0;
  let maxWaitId = 0;
  let queued: ReadingProgress | null = null;
  let writing = false;
  let lastWritten = '';
  let unsubscribePosition = () => {};

  const getProgress = () => {
    const { pageNumber, strategy, spread: spreadMode } = stage.getSnapshot();
    const viewpoint = stage.getReadingViewpoint();
    return {
      // Presentation uses a separate page counter; persist the reading camera.
      pageNumber: viewpoint ? viewpoint.anchor.pageIndex + 1 : pageNumber,
      ...(viewpoint ? { viewpoint } : {}),
      scrollStrategy: strategy,
      spreadMode: isSpreadMode(spreadMode) ? spreadMode : undefined,
    };
  };

  const getViewSnapshot = () => {
    const view = stage.getSnapshot();
    const position = stage.getPosition();
    return {
      pageNumber: view.pageNumber,
      mode: view.mode,
      scrollStrategy: view.strategy,
      spreadMode: view.spread,
      selectingRegion: view.selectingRegion,
      ...position,
      zoom: JSON.stringify(stage.getReadingViewpoint()?.zoom),
    };
  };

  const hasViewChanged = (
    before: ReturnType<typeof getViewSnapshot>,
    after: ReturnType<typeof getViewSnapshot>,
  ) => (
    before.zoom !== after.zoom
    || before.pageNumber !== after.pageNumber
    || before.mode !== after.mode
    || before.scrollStrategy !== after.scrollStrategy
    || before.spreadMode !== after.spreadMode
    || before.selectingRegion !== after.selectingRegion
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

  const clearTimers = () => {
    if (pendingWriteId) window.clearTimeout(pendingWriteId);
    if (maxWaitId) window.clearTimeout(maxWaitId);
    pendingWriteId = maxWaitId = 0;
  };
  const drainWrites = async () => {
    if (writing) return;
    writing = true;
    try {
      while (queued) {
        const progress = queued;
        queued = null;
        const encoded = JSON.stringify(progress);
        if (encoded === lastWritten) continue;
        try {
          await platform.writeReadingProgress(documentKey, progress);
          lastWritten = encoded;
        } catch (error) {
          console.warn('[pdf-ts] failed to write reading history', error);
        }
      }
    } finally { writing = false; }
  };
  const flushPendingWrite = () => {
    clearTimers();
    if (!historyReady) return;
    queued = getProgress();
    void drainWrites();
  };
  const scheduleHistoryWrite = () => {
    if (!historyReady) return;
    if (pendingWriteId) window.clearTimeout(pendingWriteId);
    pendingWriteId = window.setTimeout(flushPendingWrite, 500);
    // Continuous scrolling still checkpoints, without writing every frame.
    if (!maxWaitId) maxWaitId = window.setTimeout(flushPendingWrite, 5000);
  };

  const unsubscribePageChange = stage.subscribe(scheduleHistoryWrite);
  let layoutReadyHandled = false;
  let unsubscribeLayoutReady: (() => void) | null = null;
  const handleLayoutReady = () => {
    if (layoutReadyHandled) return;
    layoutReadyHandled = true;
    unsubscribeLayoutReady?.();
    unsubscribeLayoutReady = null;
    unsubscribePosition = stage.onReadingPositionChange(scheduleHistoryWrite);
    if (!restore) { historyReady = true; return; }
    const initialView = getViewSnapshot();

    platform.readReadingProgress(documentKey)
      .then((saved) => {
        if (disposed) return;
        const viewChangedWhileReading = hasViewChanged(
          initialView,
          getViewSnapshot(),
        );
        if (!viewChangedWhileReading && saved && isValidPageNumber(saved.pageNumber)) {
          const view = stage.getSnapshot();
          stage.applyLayout(
            isScrollStrategy(saved.scrollStrategy) ? saved.scrollStrategy : view.strategy,
            isSpreadMode(saved.spreadMode) ? saved.spreadMode : view.spread,
          );
          if (validViewpoint(saved.viewpoint)
            && saved.viewpoint.anchor.pageIndex < view.totalPages) {
            stage.restoreReadingPosition({ pageNumber: saved.viewpoint.anchor.pageIndex + 1, viewpoint: saved.viewpoint });
          } else stage.goToPage(saved.pageNumber);
        }
        historyReady = true;
        // Also lazily migrate a legacy record to its per-document key.
        if (viewChangedWhileReading || saved) scheduleHistoryWrite();
      })
      .catch((error) => {
        if (disposed) return;
        historyReady = true;
        console.warn('[pdf-ts] failed to read reading history', error);
      });
  };
  unsubscribeLayoutReady = stage.onLayoutReady(handleLayoutReady);
  if (layoutReadyHandled) {
    unsubscribeLayoutReady();
    unsubscribeLayoutReady = null;
  }

  const onHidden = () => {
    if (document.visibilityState === 'hidden') flushPendingWrite();
  };
  window.addEventListener('pagehide', flushPendingWrite);
  document.addEventListener('visibilitychange', onHidden);

  return () => {
    flushPendingWrite();
    disposed = true;
    window.removeEventListener('pagehide', flushPendingWrite);
    document.removeEventListener('visibilitychange', onHidden);
    unsubscribePageChange();
    unsubscribePosition();
    unsubscribeLayoutReady?.();
  };
}
