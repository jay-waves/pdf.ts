import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BookImage, CornerDownLeft, CornerUpRight, ListTree } from 'lucide-react';
import { FloatingSurface } from './components';
import type { PdfScroll } from './pdf-scroll';
import type { OutlineCache } from './outline';
import styles from './bottom-navigation.module.css';

const NAVIGATION_AUTO_HIDE_DELAY_MS = 900;

export function BottomNav({
  scroll,
  title,
  pageNumber,
  totalPages,
  outlineStatus,
  onOpenOutline,
  onOpenThumbnails,
}: {
  scroll?: PdfScroll | null;
  title: string;
  pageNumber: number;
  totalPages: number;
  outlineStatus: OutlineCache['status'];
  onOpenOutline: () => void;
  onOpenThumbnails: () => void;
}) {
  const [pageInput, setPageInput] = useState(String(pageNumber || 1));
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef(0);
  const interactingRef = useRef(false);
  const canNavigate = Boolean(scroll && totalPages > 0);
  const canGoPrevious = canNavigate && pageNumber > 1;
  const canGoNext = canNavigate && pageNumber < totalPages;
  const outlineTitle = title.trim();
  const shouldShowOutlineTitle = outlineStatus === 'ready' && outlineTitle.length > 0;
  const shouldShowThumbnails = outlineStatus === 'empty';

  useEffect(() => {
    setPageInput(String(pageNumber || 1));
  }, [pageNumber]);

  const clearHideTimer = useCallback(() => {
    if (!hideTimerRef.current) return;
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = 0;
  }, []);

  const reveal = useCallback(() => {
    setVisible(true);
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => {
      if (!interactingRef.current) setVisible(false);
      hideTimerRef.current = 0;
    }, NAVIGATION_AUTO_HIDE_DELAY_MS);
  }, [clearHideTimer]);

  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current || interactingRef.current) return;
    hideTimerRef.current = window.setTimeout(() => {
      if (!interactingRef.current) setVisible(false);
      hideTimerRef.current = 0;
    }, NAVIGATION_AUTO_HIDE_DELAY_MS);
  }, []);

  useEffect(() => {
    return scroll?.installInput(reveal);
  }, [reveal, scroll]);

  useEffect(() => {
    let wasAtBottomEdge = false;
    const onPointerMove = (event: PointerEvent) => {
      const atBottomEdge = window.innerHeight - event.clientY <= 96;
      if (atBottomEdge && !wasAtBottomEdge) reveal();
      wasAtBottomEdge = atBottomEdge;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      clearHideTimer();
    };
  }, [clearHideTimer, reveal]);

  const scrollToPage = (nextPageNumber: number) => {
    reveal();
    if (!scroll || !totalPages) return;

    const clampedPageNumber = Math.min(Math.max(1, nextPageNumber), totalPages);
    scroll.goToPage(clampedPageNumber);
    setPageInput(String(clampedPageNumber));
  };

  const handlePageSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextPageNumber = Number(pageInput);
    if (!Number.isInteger(nextPageNumber)) {
      setPageInput(String(pageNumber || 1));
      return;
    }
    scrollToPage(nextPageNumber);
  };

  const scrollByPage = (direction: -1 | 1) => {
    reveal();
    scroll?.movePages(direction);
  };

  return (
    <FloatingSurface
      as="nav"
      className={styles.navigation}
      data-visible={visible ? 'true' : undefined}
      aria-label="PDF navigation"
      onMouseEnter={() => {
        interactingRef.current = true;
        reveal();
      }}
      onMouseLeave={() => {
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
        <button
          type="button"
          className={styles.navigationButton}
          onClick={() => scrollByPage(-1)}
          disabled={!canGoPrevious}
          aria-label="Previous page"
        >
          <CornerDownLeft size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.navigationButton}
          onClick={() => scrollByPage(1)}
          disabled={!canGoNext}
          aria-label="Next page"
        >
          <CornerUpRight size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.navigationContent}>
        {shouldShowOutlineTitle ? (
          <button
            type="button"
            className={styles.outlineButton}
            aria-label="Open outline"
            onClick={() => {
              reveal();
              onOpenOutline();
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
              onOpenThumbnails();
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
        >
          <input
            className={styles.pageInput}
            value={pageInput}
            type="text"
            inputMode="numeric"
            enterKeyHint="go"
            required
            aria-label="Current page"
            disabled={!canNavigate}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (/^\d*$/.test(value)) setPageInput(value);
            }}
            onFocus={reveal}
            onBlur={() => setPageInput(String(pageNumber || 1))}
          />
          <span className={styles.pageTotal}>/ {totalPages || '-'}</span>
        </form>
      </div>
    </FloatingSurface>
  );
}
