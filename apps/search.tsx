import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
} from 'react';
import { useDocumentState } from '@embedpdf/core/react';
import { MatchFlag, type SearchResult } from '@embedpdf/models';
import { ChevronLeft, ChevronRight, Search as SearchIcon, X } from 'lucide-react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { ControlButton, Tooltip } from './components';
import { pdfSearchStore } from './pdf-search';
import type { PdfScroll } from './pdf-scroll';
import styles from './search.module.css';

const HIGHLIGHT_COLOR = 'color-mix(in srgb, var(--pdf-annotation-auto-stroke) 38%, transparent)';
const ACTIVE_HIGHLIGHT_COLOR = 'color-mix(in srgb, var(--pdf-danger-primary) 62%, transparent)';

export function SearchLayer({
  documentId,
  pageIndex,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  documentId: string;
  pageIndex: number;
}) {
  const { pageResults, activeResultIndex } = useStore(pdfSearchStore, useShallow((state) => {
    if (state.documentId !== documentId) {
      return { pageResults: undefined, activeResultIndex: -1 };
    }
    const pageResults = state.resultsByPage.get(pageIndex);
    const activeResultIndex = pageResults?.some(({ resultIndex }) => (
      resultIndex === state.activeResultIndex
    )) ? state.activeResultIndex : -1;
    return { pageResults, activeResultIndex };
  }));
  const scale = useDocumentState(documentId)?.scale ?? 1;
  if (!pageResults?.length) return null;

  return (
    <div {...props} style={{ ...style, position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {pageResults.map(({ result, resultIndex }) => (
        result.rects.map((rect, rectIndex) => (
            <div
              key={`${resultIndex}-${rectIndex}`}
              className="pdf-search-highlight"
              style={{
                position: 'absolute',
                top: rect.origin.y * scale,
                left: rect.origin.x * scale,
                width: rect.size.width * scale,
                height: rect.size.height * scale,
                backgroundColor: resultIndex === activeResultIndex
                  ? ACTIVE_HIGHLIGHT_COLOR
                  : HIGHLIGHT_COLOR,
                mixBlendMode: 'multiply',
                transform: 'scale(1.02)',
                transformOrigin: 'center',
              }}
            />
          ))
      ))}
    </div>
  );
}

function scrollToResult(
  scroll: PdfScroll | null | undefined,
  result?: SearchResult,
) {
  if (!scroll || !result) return;
  scroll.reveal(result.pageIndex, result.rects, {
    behavior: 'smooth',
    insets: { top: 64 },
  });
}

export function Search({
  scroll,
  documentId,
  onSearch,
}: {
  scroll?: PdfScroll | null;
  documentId?: string | null;
  onSearch(): void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const state = useStore(pdfSearchStore);
  const { clear, move, run, setDocument, toggleFlag: toggleSearchFlag } = state;
  const canSearch = Boolean(documentId);
  const total = state.results.length;

  useEffect(() => {
    if (!documentId) return;
    setDocument(documentId);
    setQuery(pdfSearchStore.getState().query);
    return clear;
  }, [clear, documentId, setDocument]);

  useEffect(() => {
    if (!canSearch) return;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [canSearch]);

  useEffect(() => {
    scrollToResult(scroll, state.results[state.activeResultIndex]);
  }, [scroll, state.activeResultIndex, state.results]);

  const runSearch = () => {
    if (canSearch && query.trim()) onSearch();
    run(query, state.flags, Math.max(0, (scroll?.getCurrentPage() ?? 1) - 1));
  };
  const clearSearch = () => {
    setQuery('');
    clear();
    inputRef.current?.focus();
  };
  const toggleFlag = (flag: MatchFlag) => {
    if (canSearch && query.trim()) onSearch();
    toggleSearchFlag(flag, query, Math.max(0, (scroll?.getCurrentPage() ?? 1) - 1));
  };

  return (
    <div className={styles.bar} role="search" aria-label="PDF search">
      <Tooltip content="Previous result">
        <ControlButton
          className={styles.button}
          onClick={() => move(-1)}
          disabled={!total}
          aria-label="Previous result"
        >
          <ChevronLeft size={16} strokeWidth={2} />
        </ControlButton>
      </Tooltip>
      <div className={styles.status}>
        {state.loading ? 'Searching...' : `${state.activeResultIndex >= 0 ? state.activeResultIndex + 1 : 0} / ${total}`}
      </div>
      <Tooltip content="Next result">
        <ControlButton
          className={styles.button}
          onClick={() => move(1)}
          disabled={!total}
          aria-label="Next result"
        >
          <ChevronRight size={16} strokeWidth={2} />
        </ControlButton>
      </Tooltip>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          runSearch();
        }}
      >
        <div className={styles.inputWrap}>
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            type="search"
            placeholder={canSearch ? 'Find in document' : 'Search is not ready'}
            disabled={!canSearch}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {query || total || state.loading ? (
            <button type="button" className={styles.clear} aria-label="Clear search" onClick={clearSearch}>
              <X size={13} strokeWidth={2} />
            </button>
          ) : null}
        </div>
        <Tooltip content="Search">
          <ControlButton type="submit" className={styles.button} disabled={!canSearch} aria-label="Search">
            <SearchIcon size={15} strokeWidth={2} />
          </ControlButton>
        </Tooltip>
      </form>
      <SearchFlagButton
        label="Match case"
        icon="Aa"
        active={state.flags.includes(MatchFlag.MatchCase)}
        disabled={!canSearch}
        onClick={() => toggleFlag(MatchFlag.MatchCase)}
      />
      <SearchFlagButton
        label="Match whole word"
        icon="'ab'"
        active={state.flags.includes(MatchFlag.MatchWholeWord)}
        disabled={!canSearch}
        onClick={() => toggleFlag(MatchFlag.MatchWholeWord)}
      />
    </div>
  );
}

function SearchFlagButton({
  label,
  icon,
  active,
  disabled,
  onClick,
}: {
  label: string;
  icon: string;
  active: boolean;
  disabled: boolean;
  onClick(): void;
}) {
  return (
    <Tooltip content={label}>
      <ControlButton
        className={styles.button}
        data-active={active ? 'true' : undefined}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
      >
        <span className={styles.matchIcon} aria-hidden="true">{icon}</span>
      </ControlButton>
    </Tooltip>
  );
}
