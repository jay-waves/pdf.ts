import { useEffect, useMemo, useRef, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import {
  MatchFlag,
  type SearchResult,
} from '@embedpdf/models';
import {
  type SearchCapability,
} from '@embedpdf/plugin-search';
import {
  CaseSensitive,
  ChevronLeft,
  ChevronRight,
  Search as SearchIcon,
  SpellCheck,
  X,
} from 'lucide-react';
import { Tooltip } from './components';
import { getActiveDocumentId, type ScrollCapability } from './utils';

type SearchScope = NonNullable<ReturnType<SearchCapability['forDocument']>>;
type SearchPanelState = Pick<
  ReturnType<SearchScope['getState']>,
  'results' | 'total' | 'activeResultIndex' | 'query' | 'loading'
>;

function getInitialSearchState(): SearchPanelState {
  return {
    results: [],
    total: 0,
    activeResultIndex: -1,
    query: '',
    loading: false,
  };
}

function toSearchPanelState(state: ReturnType<SearchScope['getState']>): SearchPanelState {
  return {
    results: state.results,
    total: state.total,
    activeResultIndex: state.activeResultIndex,
    query: state.query,
    loading: state.loading,
  };
}

function getActiveSearchScope(registry?: PluginRegistry): SearchScope | undefined {
  const documentId = registry ? getActiveDocumentId(registry) : undefined;
  const search = registry?.getPlugin('search')?.provides?.() as SearchCapability | undefined;

  if (!documentId || !search) {
    return undefined;
  }

  return search.forDocument(documentId);
}

function getSearchFlags(searchScope?: SearchScope) {
  return searchScope?.getFlags() ?? [];
}

function scrollToSearchResult(registry: PluginRegistry | undefined, result: SearchResult | undefined) {
  if (!registry || !result) {
    return;
  }

  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  const documentId = getActiveDocumentId(registry);

  if (!scroll || !documentId) {
    return;
  }

  scroll.forDocument(documentId).scrollToPage({
    pageNumber: result.pageIndex + 1,
    behavior: 'smooth',
  });
}

function getCurrentPageIndex(registry: PluginRegistry | undefined) {
  if (!registry) {
    return 0;
  }

  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  const documentId = getActiveDocumentId(registry);

  if (!scroll || !documentId) {
    return 0;
  }

  return Math.max(0, scroll.forDocument(documentId).getCurrentPage() - 1);
}

function getResultIndicesForPage(results: SearchResult[], pageIndex: number) {
  return results.reduce<number[]>((indices, result, index) => {
    if (result.pageIndex === pageIndex) {
      indices.push(index);
    }

    return indices;
  }, []);
}

function findResultIndexFromPage(results: SearchResult[], pageIndex: number, direction: -1 | 1) {
  if (direction > 0) {
    return results.findIndex((result) => result.pageIndex > pageIndex);
  }

  for (let index = results.length - 1; index >= 0; index -= 1) {
    if (results[index]?.pageIndex < pageIndex) {
      return index;
    }
  }

  return -1;
}

function findNearestResultIndexFromPage(results: SearchResult[], pageIndex: number) {
  const currentPageResult = getResultIndicesForPage(results, pageIndex)[0];
  if (currentPageResult !== undefined) {
    return currentPageResult;
  }

  const nextPageResult = findResultIndexFromPage(results, pageIndex, 1);
  if (nextPageResult >= 0) {
    return nextPageResult;
  }

  return findResultIndexFromPage(results, pageIndex, -1);
}

function useSearchPanel(registry: PluginRegistry | undefined, open: boolean) {
  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchPanelState>(getInitialSearchState);
  const [currentPageIndex, setCurrentPageIndex] = useState(() => getCurrentPageIndex(registry));
  const searchScope = useMemo(() => getActiveSearchScope(registry), [registry]);
  const alignedSearchKeyRef = useRef('');

  useEffect(() => {
    if (!open || !registry) {
      return;
    }

    setCurrentPageIndex(getCurrentPageIndex(registry));
    const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;

    return scroll?.onPageChange?.(({ pageNumber }) => {
      setCurrentPageIndex(Math.max(0, pageNumber - 1));
    });
  }, [open, registry]);

  useEffect(() => {
    if (!open || !searchScope) {
      return;
    }

    searchScope.startSearch();

    const nextState = toSearchPanelState(searchScope.getState());
    setSearchState(nextState);
    setQuery(nextState.query);

    const unsubscribe = searchScope.onStateChange((nextState) => {
      const panelState = toSearchPanelState(nextState);
      setSearchState(panelState);
      setQuery(panelState.query);
    });

    return () => {
      unsubscribe();
      searchScope.stopSearch();
    };
  }, [open, searchScope]);

  const runSearch = (nextQuery = query) => {
    if (!searchScope) {
      return;
    }

    alignedSearchKeyRef.current = '';
    if (!nextQuery.trim()) {
      searchScope.stopSearch();
      return;
    }
    searchScope.searchAllPages(nextQuery);
  };

  useEffect(() => {
    if (!open || !searchScope || searchState.loading || searchState.total === 0) {
      return;
    }

    const searchKey = `${searchState.query}\u0000${searchState.total}\u0000${searchState.results.length}`;
    if (alignedSearchKeyRef.current === searchKey) {
      return;
    }

    alignedSearchKeyRef.current = searchKey;

    const activeResult = searchState.results[searchState.activeResultIndex];
    if (activeResult?.pageIndex === currentPageIndex) {
      return;
    }

    const nearestIndex = findNearestResultIndexFromPage(searchState.results, currentPageIndex);
    if (nearestIndex < 0 || nearestIndex === searchState.activeResultIndex) {
      return;
    }

    const nextIndex = searchScope.goToResult(nearestIndex);
    scrollToSearchResult(registry, searchState.results[nextIndex]);
  }, [currentPageIndex, open, registry, searchScope, searchState]);

  const moveResult = (direction: -1 | 1) => {
    if (!searchScope || searchState.total === 0) {
      return;
    }

    const pageResultIndices = getResultIndicesForPage(searchState.results, currentPageIndex);
    const activePageResultIndex = pageResultIndices.indexOf(searchState.activeResultIndex);
    let nextIndex = -1;

    if (pageResultIndices.length > 0) {
      if (activePageResultIndex < 0) {
        nextIndex = direction > 0 ? pageResultIndices[0] ?? -1 : pageResultIndices.at(-1) ?? -1;
      } else {
        nextIndex = pageResultIndices[activePageResultIndex + direction] ?? -1;
      }
    }

    if (nextIndex < 0) {
      nextIndex = findResultIndexFromPage(searchState.results, currentPageIndex, direction);
    }

    if (nextIndex < 0) {
      nextIndex = direction < 0 ? searchScope.previousResult() : searchScope.nextResult();
    } else {
      nextIndex = searchScope.goToResult(nextIndex);
    }

    const nextResult = nextIndex >= 0 ? searchState.results[nextIndex] : undefined;
    scrollToSearchResult(registry, nextResult);
  };

  const toggleFlag = (flag: MatchFlag) => {
    if (!searchScope) {
      return;
    }

    const flags = getSearchFlags(searchScope);
    const nextFlags = flags.includes(flag) ? flags.filter((item) => item !== flag) : [...flags, flag];
    alignedSearchKeyRef.current = '';
    searchScope.setFlags(nextFlags);
  };

  const clearSearch = () => {
    alignedSearchKeyRef.current = '';
    setQuery('');
    searchScope?.stopSearch();
  };

  const flags = getSearchFlags(searchScope);

  return {
    query,
    setQuery,
    searchState,
    activeIndex: searchState.activeResultIndex,
    canSearch: Boolean(searchScope),
    flags,
    runSearch,
    clearSearch,
    moveResult,
    toggleFlag,
  };
}

export function Search({
  registry,
  open,
}: {
  registry?: PluginRegistry;
  open: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    query,
    setQuery,
    searchState,
    activeIndex,
    canSearch,
    flags,
    runSearch,
    clearSearch,
    moveResult,
    toggleFlag,
  } = useSearchPanel(registry, open);
  const canNavigate = searchState.total > 0;

  useEffect(() => {
    if (!open || !canSearch) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [canSearch, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="shnctl-toolbar-secondary shnctl-search-bar" role="search" aria-label="PDF search">
      <Tooltip content="Previous result">
        <button type="button" className="shnctl-action shnctl-search-step" onClick={() => moveResult(-1)} disabled={!canNavigate} aria-label="Previous result">
          <ChevronLeft size={16} strokeWidth={2} />
        </button>
      </Tooltip>
      <div className="shnctl-search-counter">
        {searchState.loading ? 'Searching...' : `${activeIndex >= 0 ? activeIndex + 1 : 0} / ${searchState.total}`}
      </div>
      <Tooltip content="Next result">
        <button type="button" className="shnctl-action shnctl-search-step" onClick={() => moveResult(1)} disabled={!canNavigate} aria-label="Next result">
          <ChevronRight size={16} strokeWidth={2} />
        </button>
      </Tooltip>
      <form
        className="shnctl-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          runSearch();
        }}
      >
        <div className="shnctl-search-input-wrap">
          <input
            ref={inputRef}
            className="shnctl-search-input"
            value={query}
            type="search"
            placeholder={canSearch ? 'Find in document' : 'Search is not ready'}
            disabled={!canSearch}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {query || searchState.total > 0 || searchState.loading ? (
            <button
              type="button"
              className="shnctl-action shnctl-search-clear"
              aria-label="Clear search"
              onClick={() => {
                clearSearch();
                inputRef.current?.focus();
              }}
            >
              <X size={13} strokeWidth={2} />
            </button>
          ) : null}
        </div>
        <Tooltip content="Search">
          <button type="submit" className="shnctl-action shnctl-search-toggle shnctl-search-submit" disabled={!canSearch} aria-label="Search">
            <SearchIcon size={15} strokeWidth={2} />
          </button>
        </Tooltip>
      </form>
      <Tooltip content="Match case">
        <button
          type="button"
          className={`shnctl-action shnctl-search-toggle shnctl-search-option${flags.includes(MatchFlag.MatchCase) ? ' is-active' : ''}`}
          onClick={() => toggleFlag(MatchFlag.MatchCase)}
          disabled={!canSearch}
          aria-label="Match case"
          aria-pressed={flags.includes(MatchFlag.MatchCase)}
        >
          <CaseSensitive className="shnctl-search-case-icon" strokeWidth={2} />
        </button>
      </Tooltip>
      <Tooltip content="Match whole word">
        <button
          type="button"
          className={`shnctl-action shnctl-search-toggle shnctl-search-option${flags.includes(MatchFlag.MatchWholeWord) ? ' is-active' : ''}`}
          onClick={() => toggleFlag(MatchFlag.MatchWholeWord)}
          disabled={!canSearch}
          aria-label="Match whole word"
          aria-pressed={flags.includes(MatchFlag.MatchWholeWord)}
        >
          <SpellCheck size={16} strokeWidth={2} />
        </button>
      </Tooltip>
    </div>
  );
}

export function installSearchKeyboardShortcut(onOpen: () => void) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.shiftKey || (!event.ctrlKey && !event.metaKey)) {
      return;
    }

    if (event.key.toLowerCase() !== 'f') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onOpen();
  };

  window.addEventListener('keydown', onKeyDown, { capture: true });

  return () => {
    window.removeEventListener('keydown', onKeyDown, { capture: true });
  };
}
