import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
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
  CaseSensitive,
  ChevronLeft,
  ChevronRight,
  WholeWord,
} from 'lucide-react';
import {
    type ScrollCapability,
    getActiveDocumentId,
} from './utils'

const EMPTY_CLEANUP = () => {};
const SEARCH_PANEL_COMMAND_ID = 'panel:toggle-search';
const SHNCTL_SEARCH_COMMAND_ID = 'shnctl:toggle-search';

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

function clearActiveSearch(registry?: PluginRegistry) {
  const searchScope = getActiveSearchScope(registry);
  if (!searchScope) {
    return;
  }

  searchScope.searchAllPages('');
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
    moveResult,
    toggleFlag,
  } = useSearchPanel(registry, open);
  const canNavigate = searchState.total > 0;

  useEffect(() => {
    if (!open || !canSearch) {
      return;
    }

    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [canSearch, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="shnctl-search-bar" role="search" aria-label="PDF search">
      <button type="button" className="shnctl-search-step" onClick={() => moveResult(-1)} disabled={!canNavigate} aria-label="Previous result" title="Previous result">
        <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
      </button>
      <div className="shnctl-search-counter">
        {searchState.loading ? 'Searching...' : `${activeIndex >= 0 ? activeIndex + 1 : 0} / ${searchState.total}`}
      </div>
      <button type="button" className="shnctl-search-step" onClick={() => moveResult(1)} disabled={!canNavigate} aria-label="Next result" title="Next result">
        <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
      </button>
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
          type="search"
          placeholder={canSearch ? 'Find in document' : 'Search is not ready'}
          disabled={!canSearch}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </form>
      <button
        type="button"
        className={`shnctl-search-toggle${flags.includes(MatchFlag.MatchCase) ? ' is-active' : ''}`}
        onClick={() => toggleFlag(MatchFlag.MatchCase)}
        disabled={!canSearch}
        aria-label="Match case"
        aria-pressed={flags.includes(MatchFlag.MatchCase)}
        title="Match case"
      >
        <CaseSensitive size={18} strokeWidth={2} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`shnctl-search-toggle${flags.includes(MatchFlag.MatchWholeWord) ? ' is-active' : ''}`}
        onClick={() => toggleFlag(MatchFlag.MatchWholeWord)}
        disabled={!canSearch}
        aria-label="Match whole word"
        aria-pressed={flags.includes(MatchFlag.MatchWholeWord)}
        title="Match whole word"
      >
        <WholeWord size={18} strokeWidth={2} aria-hidden="true" />
      </button>
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

export function installPanelCommandRedirects(
  registry: PluginRegistry,
  searchOpenRef: MutableRefObject<boolean>,
  onSearchOpenChange: (open: boolean) => void,
) {
  const commands = registry.getPlugin('commands')?.provides?.() as CommandsCapability | undefined;
  const ui = registry.getPlugin('ui')?.provides?.() as UICapability | undefined;

  const closeBuiltInSidebars = (documentId: string) => {
    const scope = ui?.forDocument(documentId);
    scope?.closeSidebarSlot('right', 'main');
    scope?.closeSidebarSlot('left', 'main');
  };

  const refreshMainToolbar = (documentId?: string) => {
    if (!ui || !documentId) {
      return;
    }

    requestAnimationFrame(() => {
      ui.forDocument(documentId).setActiveToolbar('top', 'main', 'main-toolbar');
    });
  };

  if (commands) {
    try {
      commands.unregisterCommand(SHNCTL_SEARCH_COMMAND_ID);
    } catch {
      // The command may not be registered yet depending on plugin startup order.
    }

    commands.registerCommand({
      id: SHNCTL_SEARCH_COMMAND_ID,
      label: 'Search',
      icon: 'search',
      shortcuts: ['Ctrl+F', 'Meta+F'],
      categories: ['tools'],
      action: ({ documentId }) => {
        closeBuiltInSidebars(documentId);
        if (searchOpenRef.current) {
          clearActiveSearch(registry);
          onSearchOpenChange(false);
          refreshMainToolbar(documentId);
          return;
        }

        onSearchOpenChange(true);
        refreshMainToolbar(documentId);
      },
      active: () => searchOpenRef.current,
    });
  }

  const restoreToolbar = replaceToolbarSearchButton(ui);

  return () => {
    restoreToolbar();
    commands?.unregisterCommand(SHNCTL_SEARCH_COMMAND_ID);
  };
}

function replaceToolbarSearchButton(ui?: UICapability) {
  if (!ui) {
    return EMPTY_CLEANUP;
  }

  type ToolbarItem = {
    id?: string;
    commandId?: string;
    items?: ToolbarItem[];
    [key: string]: unknown;
  };

  try {
    const schema = ui.getSchema();
    const toolbar = schema.toolbars?.['main-toolbar'];
    if (!toolbar?.items) {
      return EMPTY_CLEANUP;
    }

    const originalItems = structuredClone(toolbar.items) as ToolbarItem[];
    const items = removeSearchToolbarItems(originalItems);
    const rightGroup = findToolbarItem(items, 'right-group') ?? findLastGroup(items);
    const searchButton = {
      type: 'command-button',
      id: 'shnctl-search-button',
      commandId: SHNCTL_SEARCH_COMMAND_ID,
      variant: 'icon',
    };

    if (rightGroup?.items) {
      rightGroup.items.unshift(searchButton);
    } else {
      items.push(searchButton);
    }

    ui.mergeSchema({
      toolbars: {
        'main-toolbar': {
          ...toolbar,
          items,
        },
      },
    });

    return () => {
      ui.mergeSchema({
        toolbars: {
          'main-toolbar': {
            ...toolbar,
            items: originalItems,
          },
        },
      });
    };
  } catch (error) {
    console.warn('[shnctl] failed to customize search toolbar button', error);
    return EMPTY_CLEANUP;
  }
}

function removeSearchToolbarItems<T extends { id?: string; commandId?: string; items?: T[] }>(items: T[]): T[] {
  return items
    .filter((item) => !isSearchToolbarItem(item))
    .map((item) => (item.items ? { ...item, items: removeSearchToolbarItems(item.items) } : item));
}

function isSearchToolbarItem(item: { id?: string; commandId?: string }) {
  const id = item.id?.toLowerCase() ?? '';
  const commandId = item.commandId?.toLowerCase() ?? '';
  return id.includes('search') || commandId === SEARCH_PANEL_COMMAND_ID || commandId.includes('search');
}

function findToolbarItem<T extends { id?: string; items?: T[] }>(items: T[], id: string): T | undefined {
  for (const item of items) {
    if (item.id === id) {
      return item;
    }

    const child = item.items ? findToolbarItem(item.items, id) : undefined;
    if (child) {
      return child;
    }
  }

  return undefined;
}

function findLastGroup<T extends { items?: T[] }>(items: T[]): T | undefined {
  return [...items].reverse().find((item) => Array.isArray(item.items));
}
