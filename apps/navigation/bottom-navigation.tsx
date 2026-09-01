import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BookImage, CornerDownLeft, CornerUpRight, ListTree } from 'lucide-react';
import { ControlButton, FloatingSurface } from '../components';
import type { OutlineCache } from './outline';
import { useViewerActivityAutoHide } from '../components/use-auto-hide';
import type { ViewerCommandDispatch } from '../viewer/viewer-controller';
import styles from './bottom-navigation.module.css';

export function BottomNav({
  dispatch,
  title,
  pageNumber,
  totalPages,
  outlineStatus,
}: {
  dispatch: ViewerCommandDispatch;
  title: string;
  pageNumber: number;
  totalPages: number;
  outlineStatus: OutlineCache['status'];
}) {
  const [pageInput, setPageInput] = useState(String(pageNumber || 1));
  const interactingRef = useRef(false);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const canNavigate = totalPages > 0;
  const canGoPrevious = canNavigate && pageNumber > 1;
  const canGoNext = canNavigate && pageNumber < totalPages;
  const outlineTitle = title.trim();
  const shouldShowOutlineTitle = outlineStatus === 'ready' && outlineTitle.length > 0;
  const shouldShowThumbnails = outlineStatus === 'empty';
  const pageInputDigits = Math.max(pageInput.length, 1);

  useEffect(() => {
    setPageInput(String(pageNumber || 1));
  }, [pageNumber]);

  const { visible, reveal, scheduleHide } = useViewerActivityAutoHide(
    'navigation',
    () => !interactingRef.current,
  );
  const revealTemporarily = useCallback(() => {
    reveal();
    scheduleHide();
  }, [reveal, scheduleHide]);

  useEffect(() => {
    let wasAtBottomEdge = false;
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const atBottomEdge = window.innerHeight - event.clientY <= 96;
      if (atBottomEdge && !wasAtBottomEdge) revealTemporarily();
      wasAtBottomEdge = atBottomEdge;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, [revealTemporarily]);

  const scrollToPage = (nextPageNumber: number) => {
    if (!totalPages) return;

    const clampedPageNumber = Math.min(Math.max(1, nextPageNumber), totalPages);
    dispatch({ type: 'navigation/go-to-page', pageNumber: clampedPageNumber });
    setPageInput(String(clampedPageNumber));
  };

  const handlePageSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextPageNumber = Number(pageInput);
    if (
      pageInput.length === 0
      || !Number.isInteger(nextPageNumber)
      || nextPageNumber < 1
      || nextPageNumber > totalPages
    ) {
      setPageInput(String(pageNumber || 1));
      return;
    }
    scrollToPage(nextPageNumber);
  };

  const scrollByPage = (direction: -1 | 1) => {
    dispatch({ type: 'navigation/move-pages', delta: direction });
  };

  return (
    <FloatingSurface
      as="nav"
      className={styles.navigation}
      data-visible={visible ? 'true' : undefined}
      aria-label="PDF navigation"
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse') return;
        interactingRef.current = true;
        reveal();
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'mouse') return;
        interactingRef.current = false;
        scheduleHide();
      }}
      onFocus={() => {
        interactingRef.current = true;
        reveal();
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        interactingRef.current = false;
        scheduleHide();
      }}
    >
      <div className={styles.navigationButtons}>
        <ControlButton
          className="min-w-0 leading-none"
          onClick={() => scrollByPage(-1)}
          disabled={!canGoPrevious}
          aria-label="Previous page"
        >
          <CornerDownLeft size={16} strokeWidth={1.8} aria-hidden="true" />
        </ControlButton>
        <ControlButton
          className="min-w-0 leading-none"
          onClick={() => scrollByPage(1)}
          disabled={!canGoNext}
          aria-label="Next page"
        >
          <CornerUpRight size={16} strokeWidth={1.8} aria-hidden="true" />
        </ControlButton>
      </div>
      <div className={styles.navigationContent}>
        {shouldShowOutlineTitle ? (
          <button
            type="button"
            className={styles.outlineButton}
            aria-label="Open outline"
            onClick={() => {
              reveal();
              dispatch({ type: 'ui/open-panel', panel: 'outline' });
            }}
          >
            <ListTree
              className={styles.navigationTitleIcon}
              size={14}
              strokeWidth={1.8}
              aria-hidden="true"
            />
            <span className={styles.navigationTitle}>{outlineTitle}</span>
          </button>
        ) : shouldShowThumbnails ? (
          <button
            type="button"
            className={`${styles.outlineButton} ${styles.thumbnailButton}`}
            title="Open thumbnails"
            aria-label="Open thumbnails"
            onClick={() => {
              reveal();
              dispatch({ type: 'ui/open-panel', panel: 'thumbnails' });
            }}
          >
            <BookImage
              className="block flex-none"
              size={14}
              strokeWidth={1.8}
              aria-hidden="true"
            />
          </button>
        ) : null}
        <form
          className={styles.pageForm}
          aria-label="Page jump"
          onSubmit={handlePageSubmit}
          onClick={(event) => {
            reveal();
            if (event.target === pageInputRef.current) return;
            pageInputRef.current?.focus();
            pageInputRef.current?.select();
          }}
        >
          <input
            ref={pageInputRef}
            className={styles.pageInput}
            style={{ width: `${pageInputDigits}ch` }}
            value={pageInput}
            type="text"
            inputMode="numeric"
            enterKeyHint="go"
            aria-label="Current page"
            disabled={!canNavigate}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (/^\d*$/.test(value)) setPageInput(value);
            }}
            onFocus={reveal}
            onBlur={() => setPageInput(String(pageNumber || 1))}
          />
          <span className={styles.pageTotal}>
            <span>/</span>
            <span>{totalPages || '-'}</span>
          </span>
        </form>
      </div>
    </FloatingSurface>
  );
}
