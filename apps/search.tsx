import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type HTMLAttributes,
} from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import { useDocumentState } from '@embedpdf/core/react';
import { MatchFlag, type SearchResult } from '@embedpdf/models';
import { ChevronLeft, ChevronRight, Search as SearchIcon, X } from 'lucide-react';
import { Tooltip } from './components';
import type { PdfSearch } from './pdf-search';
import styles from './search.module.css';
import { getActiveDocumentId, getPluginCapability, type ScrollCapability } from './utils';

export function PdfSearchLayer({
  search,
  documentId,
  pageIndex,
  highlightColor,
  activeHighlightColor,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  search: PdfSearch;
  documentId: string;
  pageIndex: number;
  highlightColor: string;
  activeHighlightColor: string;
}) {
  const state = useSyncExternalStore(search.subscribe, search.getSnapshot);
  const scale = useDocumentState(documentId)?.scale ?? 1;
  if (state.documentId !== documentId || !state.results.length) return null;

  return (
    <div {...props} style={{ ...style, position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {state.results.map((result, resultIndex) => (
        result.pageIndex === pageIndex
          ? result.rects.map((rect, rectIndex) => (
            <div
              key={`${resultIndex}-${rectIndex}`}
              style={{
                position: 'absolute',
                top: rect.origin.y * scale,
                left: rect.origin.x * scale,
                width: rect.size.width * scale,
                height: rect.size.height * scale,
                backgroundColor: resultIndex === state.activeResultIndex
                  ? activeHighlightColor
                  : highlightColor,
                mixBlendMode: 'multiply',
                transform: 'scale(1.02)',
                transformOrigin: 'center',
              }}
            />
          ))
          : null
      ))}
    </div>
  );
}

function getScroll(registry?: PluginRegistry) {
  const documentId = registry ? getActiveDocumentId(registry) : null;
  const scroll = getPluginCapability<ScrollCapability>(registry, 'scroll');
  return documentId && scroll ? scroll.forDocument(documentId) : null;
}

function getCurrentPageIndex(registry?: PluginRegistry) {
  return Math.max(0, (getScroll(registry)?.getCurrentPage() ?? 1) - 1);
}

function scrollToResult(registry: PluginRegistry | undefined, result?: SearchResult) {
  if (!result) return;
  getScroll(registry)?.scrollToPage({ pageNumber: result.pageIndex + 1, behavior: 'instant' });
}

export function Search({
  registry,
  search,
  documentId,
  open,
}: {
  registry?: PluginRegistry;
  search: PdfSearch;
  documentId?: string | null;
  open: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const state = useSyncExternalStore(search.subscribe, search.getSnapshot);
  const canSearch = Boolean(documentId);
  const total = state.results.length;

  useEffect(() => {
    if (!open || !documentId) return;
    search.setDocument(documentId);
    setQuery(search.getSnapshot().query);
    return () => search.clear();
  }, [documentId, open, search]);

  useEffect(() => {
    if (!open || !canSearch) return;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [canSearch, open]);

  useEffect(() => {
    if (open) scrollToResult(registry, state.results[state.activeResultIndex]);
  }, [open, registry, state.activeResultIndex, state.results]);

  if (!open) return null;

  const runSearch = () => search.run(query, state.flags, getCurrentPageIndex(registry));
  const clearSearch = () => {
    setQuery('');
    search.clear();
    inputRef.current?.focus();
  };
  const toggleFlag = (flag: MatchFlag) => {
    search.toggleFlag(flag, query, getCurrentPageIndex(registry));
  };

  return (
    <div className={styles.bar} role="search" aria-label="PDF search">
      <Tooltip content="Previous result">
        <button
          type="button"
          className={styles.button}
          onClick={() => search.move(-1)}
          disabled={!total}
          aria-label="Previous result"
        >
          <ChevronLeft size={16} strokeWidth={2} />
        </button>
      </Tooltip>
      <div className={styles.status}>
        {state.loading ? 'Searching...' : `${state.activeResultIndex >= 0 ? state.activeResultIndex + 1 : 0} / ${total}`}
      </div>
      <Tooltip content="Next result">
        <button
          type="button"
          className={styles.button}
          onClick={() => search.move(1)}
          disabled={!total}
          aria-label="Next result"
        >
          <ChevronRight size={16} strokeWidth={2} />
        </button>
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
          <button type="submit" className={styles.button} disabled={!canSearch} aria-label="Search">
            <SearchIcon size={15} strokeWidth={2} />
          </button>
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
      <button
        type="button"
        className={styles.button}
        data-active={active ? 'true' : undefined}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
      >
        <span className={styles.matchIcon} aria-hidden="true">{icon}</span>
      </button>
    </Tooltip>
  );
}

export function installSearchKeyboardShortcut(onOpen: () => void) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented
      || event.altKey
      || event.shiftKey
      || (!event.ctrlKey && !event.metaKey)
      || event.key.toLowerCase() !== 'f'
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onOpen();
  };

  window.addEventListener('keydown', onKeyDown, { capture: true });
  return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
}
