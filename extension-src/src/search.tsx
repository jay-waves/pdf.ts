import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { PluginRegistry } from '@embedpdf/core';
import {
  MatchFlag,
  type SearchResult,
} from '@embedpdf/models';
import {
  type SearchCapability,
  type SearchDocumentState,
  type CommandsCapability,
  type UICapability,
} from '@embedpdf/react-pdf-viewer';
import {
    type ScrollCapability,
    getActiveDocumentId,
} from './utils'

const EMPTY_CLEANUP = () => {};
const SEARCH_PANEL_COMMAND_ID = 'panel:toggle-search';

type SearchPanelState = Pick<
  SearchDocumentState,
  'results' | 'total' | 'activeResultIndex' | 'query' | 'loading' | 'active'
>;
type SearchScope = NonNullable<ReturnType<SearchCapability['forDocument']>>;

function getInitialSearchState(): SearchPanelState {
  return {
    results: [],
    total: 0,
    activeResultIndex: -1,
    query: '',
    loading: false,
    active: false,
  };
}

function toSearchPanelState(state: SearchDocumentState): SearchPanelState {
  return {
    results: state.results,
    total: state.total,
    activeResultIndex: state.activeResultIndex,
    query: state.query,
    loading: state.loading,
    active: state.active,
  };
}

function getSearchCapability(registry?: PluginRegistry) {
  return registry?.getPlugin('search')?.provides?.() as SearchCapability | undefined;
}

function getActiveSearchScope(registry?: PluginRegistry): SearchScope | undefined {
  const documentId = registry ? getActiveDocumentId(registry) : undefined;
  const search = getSearchCapability(registry);

  if (!documentId || !search) {
    return undefined;
  }

  return search.forDocument(documentId);
}

function getSearchFlags(searchScope?: ReturnType<typeof getActiveSearchScope>) {
  if (!searchScope) {
    return [];
  }

  try {
    return searchScope.getFlags();
  } catch {
    return [];
  }
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

function renderSearchContext(result: SearchResult) {
  const { context } = result;
  const before = `${context.truncatedLeft ? '...' : ''}${context.before}`;
  const after = `${context.after}${context.truncatedRight ? '...' : ''}`;

  return (
    <>
      {before ? <span>{before} </span> : null}
      <mark>{context.match}</mark>
      {after ? <span> {after}</span> : null}
    </>
  );
}

function useSearchPanel(registry: PluginRegistry | undefined, open: boolean) {
  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchPanelState>(getInitialSearchState);
  const searchScope = useMemo(() => getActiveSearchScope(registry), [registry]);

  useEffect(() => {
    if (!open || !searchScope) {
      return;
    }

    searchScope.startSearch();

    try {
      const nextState = toSearchPanelState(searchScope.getState());
      setSearchState(nextState);
      setQuery(nextState.query);
    } catch {
      setSearchState(getInitialSearchState());
    }

    const unsubscribe = searchScope.onStateChange((nextState) => {
      const panelState = toSearchPanelState(nextState);
      setSearchState(panelState);
      setQuery(panelState.query);
    });

    return unsubscribe;
  }, [open, searchScope]);

  const runSearch = (nextQuery = query) => {
    if (!searchScope) {
      return;
    }

    searchScope.searchAllPages(nextQuery);
  };

  const goToResult = (index: number) => {
    if (!searchScope) {
      return;
    }

    const result = searchState.results[index];
    scrollToSearchResult(registry, result);
    searchScope.goToResult(index);
  };

  const moveResult = (direction: -1 | 1) => {
    if (!searchScope || searchState.total === 0) {
      return;
    }

    const nextIndex = direction < 0 ? searchScope.previousResult() : searchScope.nextResult();
    const nextResult = nextIndex >= 0 ? searchState.results[nextIndex] : undefined;
    scrollToSearchResult(registry, nextResult);
  };

  const toggleFlag = (flag: MatchFlag) => {
    if (!searchScope) {
      return;
    }

    const flags = getSearchFlags(searchScope);
    const nextFlags = flags.includes(flag) ? flags.filter((item) => item !== flag) : [...flags, flag];
    searchScope.setFlags(nextFlags);
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
    goToResult,
    moveResult,
    toggleFlag,
  };
}

export function ShnctlSearch({
  registry,
  open,
  onClose,
}: {
  registry?: PluginRegistry;
  open: boolean;
  onClose: () => void;
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
    goToResult,
    moveResult,
    toggleFlag,
  } = useSearchPanel(registry, open);

  useEffect(() => {
    if (!open || !canSearch) {
      return;
    }

    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [canSearch, open]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="shnctl-overlay" />
        <Dialog.Content className="shnctl-search-panel" aria-describedby={undefined}>
          <div className="shnctl-search-header">
            <Dialog.Title className="shnctl-search-title">Search</Dialog.Title>
            <Dialog.Close className="shnctl-search-close" aria-label="Close search">
              x
            </Dialog.Close>
          </div>
          <form
            className="shnctl-search-form"
            onSubmit={(event) => {
              event.preventDefault();
              runSearch();
            }}
          >
            <input
              ref={inputRef}
              className="shnctl-search-input"
              value={query}
              placeholder="Find in document"
              disabled={!canSearch}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            <button type="submit" className="shnctl-search-button" disabled={!canSearch}>
              Find
            </button>
          </form>
          <div className="shnctl-search-tools">
            <button
              type="button"
              className={`shnctl-search-toggle${flags.includes(MatchFlag.MatchCase) ? ' is-active' : ''}`}
              onClick={() => toggleFlag(MatchFlag.MatchCase)}
              disabled={!canSearch}
            >
              Aa
            </button>
            <button
              type="button"
              className={`shnctl-search-toggle${flags.includes(MatchFlag.MatchWholeWord) ? ' is-active' : ''}`}
              onClick={() => toggleFlag(MatchFlag.MatchWholeWord)}
              disabled={!canSearch}
            >
              Word
            </button>
            <div className="shnctl-search-counter">
              {searchState.loading ? 'Searching...' : `${activeIndex >= 0 ? activeIndex + 1 : 0} / ${searchState.total}`}
            </div>
            <button type="button" className="shnctl-search-step" onClick={() => moveResult(-1)} disabled={searchState.total === 0}>
              &lt;
            </button>
            <button type="button" className="shnctl-search-step" onClick={() => moveResult(1)} disabled={searchState.total === 0}>
              &gt;
            </button>
          </div>
          <div className="shnctl-search-results">
            {!canSearch ? <div className="shnctl-state">Search is not ready.</div> : null}
            {canSearch && !searchState.query ? <div className="shnctl-state">Enter text to search this PDF.</div> : null}
            {canSearch && searchState.query && !searchState.loading && searchState.total === 0 ? (
              <div className="shnctl-state">No matches found.</div>
            ) : null}
            {searchState.results.map((result, index) => (
              <button
                type="button"
                key={`${result.pageIndex}-${result.charIndex}-${index}`}
                className={`shnctl-search-result${index === activeIndex ? ' is-active' : ''}`}
                onClick={() => goToResult(index)}
              >
                <span className="shnctl-search-result-page">Page {result.pageIndex + 1}</span>
                <span className="shnctl-search-result-context">{renderSearchContext(result)}</span>
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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

export function installPanelCommandRedirects(
  registry: PluginRegistry,
  searchOpenRef: MutableRefObject<boolean>,
  onSearchOpenChange: (open: boolean) => void,
) {
  const commands = registry.getPlugin('commands')?.provides?.() as CommandsCapability | undefined;
  const ui = registry.getPlugin('ui')?.provides?.() as UICapability | undefined;

  if (!commands) {
    return EMPTY_CLEANUP;
  }

  const closeBuiltInSidebars = (documentId: string) => {
    const scope = ui?.forDocument(documentId);
    scope?.closeSidebarSlot('right', 'main');
  };

  commands.registerCommand({
    id: SEARCH_PANEL_COMMAND_ID,
    label: 'Search',
    icon: 'search',
    shortcuts: ['Ctrl+F', 'Meta+F'],
    categories: ['panel', 'panel-search'],
    action: ({ documentId }) => {
      closeBuiltInSidebars(documentId);
      onSearchOpenChange(!searchOpenRef.current);
    },
    active: () => searchOpenRef.current,
  });

  return () => {
    commands.unregisterCommand(SEARCH_PANEL_COMMAND_ID);
  };
}
