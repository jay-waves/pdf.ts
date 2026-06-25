import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import {
  MatchFlag,
  type SearchResult,
} from '@embedpdf/models';
import {
  type SearchCapability,
  type CommandsCapability,
  type ToolbarItem,
  type UICapability,
} from '@embedpdf/react-pdf-viewer';
import { getActiveDocumentId, type ScrollCapability } from './utils';

const EMPTY_CLEANUP = () => {};
const SEARCH_PANEL_COMMAND_ID = 'panel:toggle-search';
const SHNCTL_SEARCH_COMMAND_ID = 'shnctl:toggle-search';
const SHNCTL_SEARCH_ICON_ID = 'shnctl-search';
const SHNCTL_SEARCH_TAB_ID = 'shnctl-search-mode';
const MODE_TAB_IDS = new Set([
  'view-mode',
  'shnctl-page-mode',
  SHNCTL_SEARCH_TAB_ID,
  'annotate-mode',
  'shapes-mode',
  'insert-mode',
  'form-mode',
  'redact-mode',
]);

type SearchScope = NonNullable<ReturnType<SearchCapability['forDocument']>>;
type SearchPanelState = Pick<
  ReturnType<SearchScope['getState']>,
  'results' | 'total' | 'activeResultIndex' | 'query' | 'loading' | 'active'
>;

function ChevronLeftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function CaseSensitiveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16" />
      <path d="M22 9v7" />
      <path d="M3.304 13h6.392" />
      <circle cx="18.5" cy="12.5" r="3.5" />
    </svg>
  );
}

function WholeWordIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7" cy="12" r="3" />
      <path d="M10 9v6" />
      <circle cx="17" cy="12" r="3" />
      <path d="M14 7v8" />
      <path d="M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21 21-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
    </svg>
  );
}

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

function toSearchPanelState(state: ReturnType<SearchScope['getState']>): SearchPanelState {
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

function getCurrentPageIndex(registry: PluginRegistry | undefined) {
  if (!registry) {
    return 0;
  }

  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  const documentId = getActiveDocumentId(registry);

  if (!scroll || !documentId) {
    return 0;
  }

  try {
    return Math.max(0, scroll.forDocument(documentId).getCurrentPage() - 1);
  } catch {
    return 0;
  }
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

    alignedSearchKeyRef.current = '';
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
    <div data-epdf-i="shnctl-search-toolbar" className="shnctl-search-bar" role="search" aria-label="PDF search">
      <button type="button" className="shnctl-search-step" onClick={() => moveResult(-1)} disabled={!canNavigate} aria-label="Previous result" title="Previous result">
        <ChevronLeftIcon />
      </button>
      <div className="shnctl-search-counter">
        {searchState.loading ? 'Searching...' : `${activeIndex >= 0 ? activeIndex + 1 : 0} / ${searchState.total}`}
      </div>
      <button type="button" className="shnctl-search-step" onClick={() => moveResult(1)} disabled={!canNavigate} aria-label="Next result" title="Next result">
        <ChevronRightIcon />
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
        <button type="submit" className="shnctl-search-toggle shnctl-search-submit" disabled={!canSearch} aria-label="Search" title="Search">
          <SearchIcon />
        </button>
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
        <CaseSensitiveIcon />
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
        <WholeWordIcon />
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
      label: 'SEARCH',
      icon: SHNCTL_SEARCH_ICON_ID,
      shortcuts: ['Ctrl+F', 'Meta+F'],
      categories: ['tools'],
      action: ({ documentId }) => {
        closeBuiltInSidebars(documentId);
        if (searchOpenRef.current) {
          refreshMainToolbar(documentId);
          return;
        }

        onSearchOpenChange(true);
        refreshMainToolbar(documentId);
      },
      active: () => searchOpenRef.current,
    });
  }

  const restoreToolbar = replaceToolbarSearchEntry(ui);
  const unsubscribeToolbarChanged = ui?.onToolbarChanged((event) => {
    if (
      searchOpenRef.current &&
      event.placement === 'top' &&
      event.slot === 'secondary'
    ) {
      onSearchOpenChange(false);
    }
  });
  const onModeTabClick = (event: MouseEvent) => {
    if (!searchOpenRef.current) {
      return;
    }

    const modeTab = event
      .composedPath()
      .find((item): item is Element => item instanceof Element && MODE_TAB_IDS.has(item.getAttribute('data-epdf-i') ?? ''));

    if (!modeTab || modeTab.getAttribute('data-epdf-i') === SHNCTL_SEARCH_TAB_ID) {
      return;
    }

    onSearchOpenChange(false);
  };

  document.addEventListener('click', onModeTabClick, { capture: true });

  return () => {
    document.removeEventListener('click', onModeTabClick, { capture: true });
    unsubscribeToolbarChanged?.();
    restoreToolbar();
    commands?.unregisterCommand(SHNCTL_SEARCH_COMMAND_ID);
  };
}

function replaceToolbarSearchEntry(ui?: UICapability) {
  if (!ui) {
    return EMPTY_CLEANUP;
  }

  try {
    const schema = ui.getSchema();
    const toolbar = schema.toolbars?.['main-toolbar'];
    if (!toolbar?.items) {
      return EMPTY_CLEANUP;
    }

    const originalItems = structuredClone(toolbar.items);
    const items = removeSearchToolbarItems(originalItems);
    const modeTabs = findToolbarItem(items, 'mode-tabs');
    const searchTab = {
      id: SHNCTL_SEARCH_TAB_ID,
      commandId: SHNCTL_SEARCH_COMMAND_ID,
      variant: 'text' as const,
      categories: ['mode', 'search'],
    };

    if (modeTabs?.type === 'tab-group') {
      modeTabs.tabs.splice(Math.min(2, modeTabs.tabs.length), 0, searchTab);
    } else {
      items.push({
        type: 'command-button',
        id: SHNCTL_SEARCH_TAB_ID,
        commandId: SHNCTL_SEARCH_COMMAND_ID,
        variant: 'text',
      });
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
    console.warn('[shnctl] failed to customize search toolbar entry', error);
    return EMPTY_CLEANUP;
  }
}

function removeSearchToolbarItems(items: ToolbarItem[]): ToolbarItem[] {
  return items
    .filter((item) => !isSearchToolbarItem(item))
    .map((item) => {
      if (item.type === 'group') {
        return { ...item, items: removeSearchToolbarItems(item.items) };
      }
      if (item.type === 'tab-group') {
        return { ...item, tabs: item.tabs.filter((tab) => !isSearchToolbarItem(tab)) };
      }
      return item;
    });
}

function isSearchToolbarItem(item: { id?: string; commandId?: string }) {
  const id = item.id?.toLowerCase() ?? '';
  const commandId = item.commandId?.toLowerCase() ?? '';
  return id.includes('search') || commandId === SEARCH_PANEL_COMMAND_ID || commandId.includes('search');
}

function findToolbarItem(items: ToolbarItem[], id: string): ToolbarItem | undefined {
  for (const item of items) {
    if (item.id === id) {
      return item;
    }

    const child = item.type === 'group' ? findToolbarItem(item.items, id) : undefined;
    if (child) {
      return child;
    }
  }

  return undefined;
}
