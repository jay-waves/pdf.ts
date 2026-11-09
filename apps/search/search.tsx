import { useEffect, useRef, useState, type CSSProperties, type HTMLAttributes } from 'react';
import { SearchLayer as NativeSearchLayer, useSearch, useSearchState, type SearchHit } from '@embedpdf/react/search';
import { ChevronLeft, ChevronRight, Search as SearchIcon, X } from 'lucide-react';
import { ControlButton, Tooltip } from '../components';
import type { ViewerStage } from '../viewer/viewer-stage';
import styles from './search.module.css';

export function SearchLayer({ documentId: _documentId, pageIndex: _pageIndex, style, ...props }:
  HTMLAttributes<HTMLDivElement> & { documentId: string; pageIndex: number }) {
  return <div {...props} style={{ ...style, position: 'absolute', inset: 0, pointerEvents: 'none',
    '--epdf-search-highlight': 'color-mix(in srgb, var(--pdf-annotation-auto-stroke) 38%, transparent)',
    '--epdf-search-highlight-active': 'color-mix(in srgb, var(--pdf-danger-primary) 62%, transparent)',
    '--epdf-search-blend-mode': 'normal',
  } as CSSProperties}><NativeSearchLayer /></div>;
}

export function Search({ stage, documentId }: { stage?: ViewerStage | null; documentId?: string | null }) {
  const search = useSearch();
  const state = useSearchState();
  const inputRef = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const revealedHit = useRef<SearchHit | null>(null);
  const [query, setQuery] = useState(state.query?.text ?? '');
  const [matchCase, setMatchCase] = useState(state.query?.matchCase ?? false);
  const [wholeWord, setWholeWord] = useState(state.query?.wholeWord ?? false);
  const [error, setError] = useState('');
  const canSearch = Boolean(documentId) && search.canSearch();
  const total = state.hitCount;
  const loading = state.status === 'searching';

  useEffect(() => {
    const frame = requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
    return () => { generation.current++; cancelAnimationFrame(frame); search.clear(); };
  }, [search, documentId]);

  // The plugin keeps active-hit identity stable as subsequent batches arrive.
  useEffect(() => {
    if (state.activeHit && state.activeHit !== revealedHit.current) {
      revealedHit.current = state.activeHit;
      search.revealActiveHit();
    }
  }, [search, state.activeHit]);

  const runSearch = (nextCase = matchCase, nextWholeWord = wholeWord) => {
    const current = ++generation.current;
    setError('');
    revealedHit.current = null;
    void search.search({ text: query.trim(), matchCase: nextCase, wholeWord: nextWholeWord },
      { from: Math.max(0, (stage?.getCurrentPage() ?? 1) - 1) })
      .catch(failure => {
        if (generation.current !== current) return;
        search.clear();
        setError(failure instanceof Error ? failure.message : 'Search failed.');
      });
  };
  const move = (direction: -1 | 1) => {
    revealedHit.current = direction > 0 ? search.nextHit() : search.previousHit();
  };
  const clearSearch = () => { generation.current++; revealedHit.current = null; setQuery(''); setError(''); search.clear(); inputRef.current?.focus(); };

  return <div className={styles.bar} role="search" aria-label="PDF search">
    <Tooltip content="Previous result"><ControlButton className={styles.button} onClick={() => move(-1)}
      disabled={!total} aria-label="Previous result"><ChevronLeft size={16} strokeWidth={2} /></ControlButton></Tooltip>
    <div className={styles.status}>{loading ? 'Searching...' : `${state.activeHitIndex >= 0 ? state.activeHitIndex + 1 : 0} / ${total}`}</div>
    <Tooltip content="Next result"><ControlButton className={styles.button} onClick={() => move(1)}
      disabled={!total} aria-label="Next result"><ChevronRight size={16} strokeWidth={2} /></ControlButton></Tooltip>
    <form className={styles.form} onSubmit={event => { event.preventDefault(); runSearch(); }}>
      <div className={styles.inputWrap}>
        <input ref={inputRef} className={styles.input} value={query} type="search"
          aria-label="Search PDF text" placeholder={canSearch ? 'Search' : 'Search is not ready'}
          disabled={!canSearch} onChange={event => setQuery(event.currentTarget.value)} />
        <div className={styles.inputActions}>
          {query || total || loading ? <button type="button" className={styles.clear} aria-label="Clear search" onClick={clearSearch}><X size={13} strokeWidth={2} /></button> : null}
          <SearchFlagButton label="Match case" icon="Aa" active={matchCase} disabled={!canSearch}
            onClick={() => { setMatchCase(!matchCase); if (query.trim()) runSearch(!matchCase, wholeWord); }} />
          <SearchFlagButton label="Match whole word" icon="'ab'" active={wholeWord} disabled={!canSearch}
            onClick={() => { setWholeWord(!wholeWord); if (query.trim()) runSearch(matchCase, !wholeWord); }} />
        </div>
      </div>
      <Tooltip content="Search"><ControlButton type="submit" className={styles.button} disabled={!canSearch} aria-label="Search"><SearchIcon size={15} strokeWidth={2} /></ControlButton></Tooltip>
    </form>
    {error || state.error ? <span role="alert">{error || state.error?.message}</span> : null}
  </div>;
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
        className={styles.matchButton}
        aria-label={label}
        aria-pressed={active}
        data-active={active ? 'true' : undefined}
        disabled={disabled}
        onClick={onClick}
      >
        <span aria-hidden="true">{icon}</span>
      </button>
    </Tooltip>
  );
}
