import { type MutableRefObject } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import {
  type Command,
  type CommandsCapability,
  type PDFViewerRef,
  type ThemeConfig,
  type ToolbarItem,
  type UICapability,
} from '@embedpdf/react-pdf-viewer';
import {
    getActiveDocumentId,
} from './utils'

type ViewerTheme = {
  id: string;
  name: string;
  icon: string;
  config: ThemeConfig;
};

const EMPTY_CLEANUP = () => {};
const COMMENT_PANEL_COMMAND_ID = 'panel:toggle-comment';
export const VIEWER_THEMES: ViewerTheme[] = [
  {
    id: 'light',
    name: 'Light',
    icon: 'shnctl-palette-1',
    config: {
      preference: 'light',
      light: {
        accent: {
          primary: '#2563eb',
          primaryHover: '#1d4ed8',
          primaryActive: '#1e40af',
          primaryLight: '#dbeafe',
          primaryForeground: '#ffffff',
        },
      },
    },
  },
  {
    id: 'dark',
    name: 'Dark',
    icon: 'shnctl-palette-2',
    config: {
      preference: 'dark',
      dark: {
        accent: {
          primary: '#60a5fa',
          primaryHover: '#3b82f6',
          primaryActive: '#2563eb',
          primaryLight: '#1e3a8a',
          primaryForeground: '#0f172a',
        },
      },
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    icon: 'shnctl-palette-3',
    config: {
      preference: 'dark',
      dark: {
        background: {
          app: '#2e3440',
          surface: '#3b4252',
          surfaceAlt: '#353c4a',
          elevated: '#434c5e',
          overlay: 'rgba(46, 52, 64, 0.68)',
          input: '#2e3440',
        },
        foreground: {
          primary: '#eceff4',
          secondary: '#d8dee9',
          muted: '#a7b1c2',
          disabled: '#6f7888',
          onAccent: '#2e3440',
        },
        border: {
          default: '#4c566a',
          subtle: '#434c5e',
          strong: '#88c0d0',
        },
        accent: {
          primary: '#88c0d0',
          primaryHover: '#8fbcbb',
          primaryActive: '#81a1c1',
          primaryLight: '#3b5360',
          primaryForeground: '#2e3440',
        },
        interactive: {
          hover: '#434c5e',
          active: '#4c566a',
          selected: '#3b5360',
          focus: '#88c0d0',
          focusRing: '#5e81ac',
        },
      },
    },
  },
  {
    id: 'solar',
    name: 'Solar',
    icon: 'shnctl-palette-4',
    config: {
      preference: 'light',
      light: {
        background: {
          app: '#f8f5ec',
          surface: '#f1ede3',
          surfaceAlt: '#f5f1e8',
          elevated: '#fffdf7',
          overlay: 'rgba(101, 92, 75, 0.16)',
          input: '#fbf8f0',
        },
        foreground: {
          primary: '#2d332f',
          secondary: '#5f675f',
          muted: '#8b9288',
          disabled: '#a9aea4',
          onAccent: '#fbf8f0',
        },
        border: {
          default: '#d8d0bf',
          subtle: '#e5dfd2',
          strong: '#5f8f86',
        },
        accent: {
          primary: '#5f8f86',
          primaryHover: '#527d75',
          primaryActive: '#466c65',
          primaryLight: '#dbe8e3',
          primaryForeground: '#fbf8f0',
        },
        interactive: {
          hover: '#e9e2d4',
          active: '#ddd5c6',
          selected: '#dbe8e3',
          focus: '#5f8f86',
          focusRing: '#9eb8b1',
        },
      },
    },
  },
];

const THEME_COMMAND_ID = 'shnctl.theme.cycle';
const THEME_BUTTON_ID = 'shnctl-theme-cycle-button';
const THEME_STORAGE_KEY = 'shnctl-viewer-theme-v1';
const PAGE_MODE_COMMAND_ID = 'shnctl.mode.page';
const SINGLE_PAGE_COMMAND_ID = 'shnctl.view.single-page';
const TWO_PAGE_ODD_COMMAND_ID = 'shnctl.view.two-page-odd';
const VERTICAL_SCROLL_COMMAND_ID = 'shnctl.view.vertical-scroll';
const HORIZONTAL_SCROLL_COMMAND_ID = 'shnctl.view.horizontal-scroll';
const ROTATE_COMMAND_ID = 'shnctl.view.rotate';
const PAGE_TOOLBAR_ID = 'shnctl-page-toolbar';
const PAGE_MODE_TAB_ID = 'shnctl-page-mode';
const VIEW_CONTROL_BUTTON_IDS = new Set([
  'shnctl-single-page-button',
  'shnctl-two-page-odd-button',
  'shnctl-vertical-scroll-button',
  'shnctl-horizontal-scroll-button',
  'shnctl-rotate-button',
]);
const PAGE_SETTINGS_BUTTON_ID = 'page-settings-button';
const MAIN_ZOOM_ITEM_IDS = new Set(['zoom-menu-button', 'zoom-toolbar', 'divider-3']);

type SpreadModeValue = 'none' | 'odd' | 'even';
type ScrollStrategyValue = 'vertical' | 'horizontal';

interface SpreadCapability {
  setSpreadMode(mode: SpreadModeValue): void;
  getSpreadMode(): SpreadModeValue;
}

interface ScrollCapability {
  getLayout(): { strategy: ScrollStrategyValue };
  forDocument(documentId: string): {
    getCurrentPage(): number;
    scrollToPage(options: {
      pageNumber: number;
      behavior?: 'instant' | 'smooth' | 'auto';
    }): void;
  };
  setScrollStrategy(strategy: ScrollStrategyValue, documentId?: string): void;
}

interface RotateCapability {
  rotateForward(): void;
}

interface UiPluginState {
  plugins?: {
    ui?: {
      documents?: Record<
        string,
        {
          activeToolbars?: Record<string, Record<string, string>>;
        }
      >;
    };
    scroll?: {
      documents?: Record<
        string,
        {
          strategy?: ScrollStrategyValue;
        }
      >;
    };
  };
}

export function getStoredThemeIndex() {
  let storedThemeId: string | null = null;

  try {
    storedThemeId = window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return 0;
  }

  const index = VIEWER_THEMES.findIndex((theme) => theme.id === storedThemeId);

  return index >= 0 ? index : 0;
}


function getThemeAccentColor(theme: ViewerTheme) {
  const colorScheme = theme.config.preference === 'dark' ? 'dark' : 'light';
  const colors = colorScheme === 'dark' ? theme.config.dark : theme.config.light;

  return colors?.accent?.primary ?? '#2563eb';
}

function applyViewerTheme(container: PDFViewerRef['container'], themeIndex: number) {
  const theme = VIEWER_THEMES[themeIndex] ?? VIEWER_THEMES[0];

  container?.setTheme(theme.config);
  document.documentElement.dataset.viewerTheme = theme.id;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme.id);
  } catch {
    // Theme switching should still work if storage is unavailable.
  }
}

function registerThemeIcons(container: PDFViewerRef['container']) {
  if (!container) {
    return;
  }

  const createPaletteIcon = (countPath: string) => ({
    viewBox: '0 0 24 24',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.8,
    paths: [
      {
        d: 'M12 3.4c-4.75 0-8.6 3.35-8.6 7.9 0 4 3.2 7.3 7.2 7.3h1.15c.9 0 1.5-.62 1.5-1.42 0-.7-.48-1.25-1.2-1.25h-.42c-.9 0-1.62-.7-1.62-1.58 0-.9.72-1.62 1.62-1.62h2.68c3.47 0 6.29-2.03 6.29-4.82 0-2.88-3.85-4.51-8.6-4.51z',
        stroke: 'primary',
        fill: 'none',
      },
      { d: 'M7.4 10.2h.02', stroke: 'primary', fill: 'none', strokeWidth: 2.4 },
      { d: 'M10.25 7.35h.02', stroke: 'primary', fill: 'none', strokeWidth: 2.4 },
      { d: 'M14.15 7.35h.02', stroke: 'primary', fill: 'none', strokeWidth: 2.4 },
      { d: 'M16.95 10.2h.02', stroke: 'primary', fill: 'none', strokeWidth: 2.4 },
      { d: 'M15.6 16.9a4.4 4.4 0 1 0 8.8 0a4.4 4.4 0 1 0 -8.8 0', stroke: 'none', fill: 'secondary' },
      { d: countPath, stroke: '#ffffff', fill: 'none', strokeWidth: 1.55 },
    ],
  });

  container.registerIcons({
    'shnctl-palette-1': createPaletteIcon('M20 14.7v4.4'),
    'shnctl-palette-2': createPaletteIcon('M18.35 14.65h3.25v1.5h-3.25v2.95h3.25'),
    'shnctl-palette-3': createPaletteIcon('M18.35 14.65h3.25v1.55h-2.35M21.6 16.2v2.9h-3.25'),
    'shnctl-palette-4': createPaletteIcon('M18.3 14.65v2.45h3.3M21.6 14.65v4.45'),
    'shnctl-palette-5': createPaletteIcon('M21.55 14.65h-3.2l-.2 1.9h1.75a1.3 1.3 0 0 1 0 2.55h-1.8'),
    'shnctl-palette-6': createPaletteIcon('M21.45 14.75h-1.8a1.55 1.55 0 0 0 0 3.1h.35a1.25 1.25 0 0 0 0-2.5h-1.85'),
    'shnctl-palette-7': createPaletteIcon('M18.3 14.65h3.35l-2.15 4.45'),
    'shnctl-single-page': {
      viewBox: '0 0 24 24',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: 1.8,
      paths: [
        { d: 'M7 3.5h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z', stroke: 'primary', fill: 'none' },
        { d: 'M8.5 8h7M8.5 11.5h7M8.5 15h5', stroke: 'primary', fill: 'none' },
      ],
    },
    'shnctl-two-page-odd': {
      viewBox: '0 0 24 24',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: 1.8,
      paths: [
        { d: 'M4 5.5a2 2 0 0 1 2-2h5v17H6a2 2 0 0 1-2-2zM13 3.5h5a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-5z', stroke: 'primary', fill: 'none' },
        { d: 'M7 8.5h2M15 8.5h2M7 12h2M15 12h2', stroke: 'primary', fill: 'none' },
      ],
    },
    'shnctl-scroll-vertical': {
      viewBox: '0 0 24 24',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: 2,
      paths: [
        { d: 'M12 5v14', stroke: 'primary', fill: 'none' },
        { d: 'M8 9l4-4 4 4', stroke: 'primary', fill: 'none' },
        { d: 'M8 15l4 4 4-4', stroke: 'primary', fill: 'none' },
      ],
    },
    'shnctl-scroll-horizontal': {
      viewBox: '0 0 24 24',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: 2,
      paths: [
        { d: 'M5 12h14', stroke: 'primary', fill: 'none' },
        { d: 'M9 8l-4 4 4 4', stroke: 'primary', fill: 'none' },
        { d: 'M15 8l4 4-4 4', stroke: 'primary', fill: 'none' },
      ],
    },
    'shnctl-rotate': {
      viewBox: '0 0 24 24',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: 2,
      paths: [
        { d: 'M21 12a9 9 0 1 1-2.64-6.36', stroke: 'primary', fill: 'none' },
        { d: 'M21 3v6h-6', stroke: 'primary', fill: 'none' },
      ],
    },
    'shnctl-page-menu': {
      viewBox: '0 0 24 24',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: 1.8,
      paths: [
        { d: 'M6.5 3.5h8.2L19 7.8v10.7a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z', stroke: 'primary', fill: 'none' },
        { d: 'M14.5 3.8v4.4h4.2M8 11.5h8M8 15h5.5', stroke: 'primary', fill: 'none' },
      ],
    },
  });
}

function refreshMainToolbar(registry: PluginRegistry, ui: UICapability) {
  const documentId = getActiveDocumentId(registry);

  if (documentId) {
    ui.forDocument(documentId).setActiveToolbar('top', 'main', 'main-toolbar');
  }
}

function switchScrollStrategyPreservingPage(
  registry: PluginRegistry,
  ui: UICapability,
  scroll: ScrollCapability | undefined,
  strategy: ScrollStrategyValue,
) {
  const documentId = getActiveDocumentId(registry);

  if (!scroll || !documentId) {
    return;
  }

  const scrollScope = scroll.forDocument(documentId);
  const pageNumber = scrollScope.getCurrentPage();

  scroll.setScrollStrategy(strategy, documentId);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollScope.scrollToPage({
        pageNumber,
        behavior: 'instant',
      });
      refreshMainToolbar(registry, ui);
    });
  });
}

function removeToolbarItemByCommandId(items: ToolbarItem[], commandId: string): ToolbarItem[] {
  return items.reduce<ToolbarItem[]>((nextItems, item) => {
    if (item.type === 'command-button' && item.commandId === commandId) {
      return nextItems;
    }

    if (item.type === 'group') {
      nextItems.push({
        ...item,
        items: removeToolbarItemByCommandId(item.items as ToolbarItem[], commandId),
      });
      return nextItems;
    }

    nextItems.push(item);
    return nextItems;
  }, []);
}

function removeToolbarItemsById(items: ToolbarItem[], ids: Set<string>): ToolbarItem[] {
  return items.reduce<ToolbarItem[]>((nextItems, item) => {
    if (ids.has(item.id)) {
      return nextItems;
    }

    if (item.type === 'group') {
      nextItems.push({
        ...item,
        items: removeToolbarItemsById(item.items as ToolbarItem[], ids),
      });
      return nextItems;
    }

    nextItems.push(item);
    return nextItems;
  }, []);
}

function isPanToolbarItem(item: ToolbarItem) {
  const itemLike = item as ToolbarItem & {
    commandId?: string;
    componentId?: string;
  };

  return [itemLike.id, itemLike.commandId, itemLike.componentId].some((value) => value?.toLowerCase().includes('pan'));
}

function removeDividerBeforePanTool(items: ToolbarItem[]): ToolbarItem[] {
  return items.reduce<ToolbarItem[]>((nextItems, item) => {
    const nextItem =
      item.type === 'group'
        ? {
            ...item,
            items: removeDividerBeforePanTool(item.items as ToolbarItem[]),
          }
        : item;

    if (isPanToolbarItem(nextItem) && nextItems.at(-1)?.type === 'divider') {
      nextItems.pop();
    }

    nextItems.push(nextItem);
    return nextItems;
  }, []);
}

function appendUnique(items: string[] | undefined, item: string) {
  return items?.includes(item) ? items : [...(items ?? []), item];
}

function prependUnique(items: string[] | undefined, item: string) {
  return items?.includes(item) ? items : [item, ...(items ?? [])];
}

function addPageModeToResponsiveSchema(toolbar: { responsive?: any; items: ToolbarItem[] }, schema: ReturnType<UICapability['getSchema']>) {
  const breakpoints = toolbar.responsive?.breakpoints;

  if (breakpoints?.xxxs) {
    breakpoints.xxxs.hide = appendUnique(breakpoints.xxxs.hide, PAGE_MODE_TAB_ID);
  }

  if (breakpoints?.sm) {
    breakpoints.sm.show = appendUnique(breakpoints.sm.show, PAGE_MODE_TAB_ID);
  }

  if (breakpoints?.md) {
    breakpoints.md.show = appendUnique(breakpoints.md.show, PAGE_MODE_TAB_ID);
  }

  const modeSelect = toolbar.items.find((item) => item.id === 'mode-select-button');
  if (modeSelect) {
    modeSelect.visibilityDependsOn = {
      ...modeSelect.visibilityDependsOn,
      itemIds: appendUnique(modeSelect.visibilityDependsOn?.itemIds, PAGE_MODE_COMMAND_ID),
    };
  }

  const overflowMenu = schema.menus['mode-tabs-overflow-menu'];
  if (!overflowMenu.items.some((item) => item.id === PAGE_MODE_COMMAND_ID)) {
    overflowMenu.items.splice(1, 0, {
      type: 'command',
      id: PAGE_MODE_COMMAND_ID,
      commandId: PAGE_MODE_COMMAND_ID,
      categories: ['mode', 'page'],
    });
  }

  const overflowBreakpoints = overflowMenu.responsive?.breakpoints;
  if (overflowBreakpoints?.xs) {
    overflowBreakpoints.xs.show = appendUnique(overflowBreakpoints.xs.show, PAGE_MODE_COMMAND_ID);
  }
  if (overflowBreakpoints?.sm) {
    overflowBreakpoints.sm.hide = prependUnique(overflowBreakpoints.sm.hide, PAGE_MODE_COMMAND_ID);
  }
  if (overflowBreakpoints?.md) {
    overflowBreakpoints.md.hide = prependUnique(overflowBreakpoints.md.hide, PAGE_MODE_COMMAND_ID);
  }
}

export function installThemeSwitcher(
  registry: PluginRegistry,
  container: PDFViewerRef['container'],
  themeIndexRef: MutableRefObject<number>,
) {
  if (!container) {
    return EMPTY_CLEANUP;
  }

  const commands = registry.getPlugin('commands')?.provides?.() as CommandsCapability | undefined;
  const ui = registry.getPlugin('ui')?.provides?.() as UICapability | undefined;

  if (!commands || !ui) {
    return EMPTY_CLEANUP;
  }

  registerThemeIcons(container);
  applyViewerTheme(container, themeIndexRef.current);
  const spread = registry.getPlugin('spread')?.provides?.() as SpreadCapability | undefined;
  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  const rotate = registry.getPlugin('rotate')?.provides?.() as RotateCapability | undefined;
  const registeredCommandIds = [
    THEME_COMMAND_ID,
    PAGE_MODE_COMMAND_ID,
    SINGLE_PAGE_COMMAND_ID,
    TWO_PAGE_ODD_COMMAND_ID,
    VERTICAL_SCROLL_COMMAND_ID,
    HORIZONTAL_SCROLL_COMMAND_ID,
    ROTATE_COMMAND_ID,
  ];

  const themeCommand: Command = {
    id: THEME_COMMAND_ID,
    label: 'Switch theme',
    icon: () => (VIEWER_THEMES[themeIndexRef.current] ?? VIEWER_THEMES[0]).icon,
    iconProps: () => ({
      secondaryColor: getThemeAccentColor(VIEWER_THEMES[themeIndexRef.current] ?? VIEWER_THEMES[0]),
    }),
    action: () => {
      themeIndexRef.current = (themeIndexRef.current + 1) % VIEWER_THEMES.length;
      applyViewerTheme(container, themeIndexRef.current);
      refreshMainToolbar(registry, ui);
    },
    categories: ['document'],
  };
  const pageModeCommand: Command = {
    id: PAGE_MODE_COMMAND_ID,
    label: 'Page',
    action: ({ documentId }) => {
      ui.forDocument(documentId).setActiveToolbar('top', 'secondary', PAGE_TOOLBAR_ID);
    },
    active: ({ state, documentId }) => {
      const activeToolbars = (state as UiPluginState).plugins?.ui?.documents?.[documentId]?.activeToolbars;
      return activeToolbars?.top?.secondary === PAGE_TOOLBAR_ID;
    },
    categories: ['mode', 'page'],
  };
  const viewCommands: Command[] = [
    {
      id: SINGLE_PAGE_COMMAND_ID,
      label: 'Single Page',
      icon: 'shnctl-single-page',
      action: () => {
        spread?.setSpreadMode('none');
        refreshMainToolbar(registry, ui);
      },
      active: () => spread?.getSpreadMode() === 'none',
      disabled: () => !spread,
      categories: ['document'],
    },
    {
      id: TWO_PAGE_ODD_COMMAND_ID,
      label: 'TwoPage (Odd)',
      icon: 'shnctl-two-page-odd',
      action: () => {
        spread?.setSpreadMode('odd');
        refreshMainToolbar(registry, ui);
      },
      active: () => spread?.getSpreadMode() === 'odd',
      disabled: () => !spread,
      categories: ['document'],
    },
    {
      id: VERTICAL_SCROLL_COMMAND_ID,
      label: 'Vertical',
      icon: 'shnctl-scroll-vertical',
      action: () => {
        switchScrollStrategyPreservingPage(registry, ui, scroll, 'vertical');
      },
      active: ({ state, documentId }) => (state as UiPluginState).plugins?.scroll?.documents?.[documentId]?.strategy === 'vertical',
      disabled: () => !scroll,
      categories: ['document'],
    },
    {
      id: HORIZONTAL_SCROLL_COMMAND_ID,
      label: 'Horizontal',
      icon: 'shnctl-scroll-horizontal',
      action: () => {
        switchScrollStrategyPreservingPage(registry, ui, scroll, 'horizontal');
      },
      active: ({ state, documentId }) => (state as UiPluginState).plugins?.scroll?.documents?.[documentId]?.strategy === 'horizontal',
      disabled: () => !scroll,
      categories: ['document'],
    },
    {
      id: ROTATE_COMMAND_ID,
      label: 'Rotate',
      icon: 'shnctl-rotate',
      action: () => {
        rotate?.rotateForward();
        refreshMainToolbar(registry, ui);
      },
      disabled: () => !rotate,
      categories: ['document'],
    },
  ];

  for (const command of [themeCommand, pageModeCommand, ...viewCommands]) {
    commands.registerCommand(command);
  }

  const schema = ui.getSchema();
  const toolbar = schema.toolbars['main-toolbar'];
  if (!toolbar) {
    return () => {
      for (const commandId of registeredCommandIds) {
        commands.unregisterCommand(commandId);
      }
    };
  }

  addPageModeToResponsiveSchema(toolbar, schema);

  const items = removeDividerBeforePanTool(
    removeToolbarItemsById(
      removeToolbarItemByCommandId(structuredClone(toolbar.items) as ToolbarItem[], COMMENT_PANEL_COMMAND_ID),
      new Set([...VIEW_CONTROL_BUTTON_IDS, ...MAIN_ZOOM_ITEM_IDS, PAGE_SETTINGS_BUTTON_ID, PAGE_MODE_TAB_ID]),
    ),
  );
  const rightGroup = items.find((item): item is Extract<ToolbarItem, { type: 'group' }> => item.type === 'group' && item.id === 'right-group');
  const modeTabs = items.find((item): item is Extract<ToolbarItem, { type: 'tab-group' }> => item.type === 'tab-group' && item.id === 'mode-tabs');

  if (modeTabs && !modeTabs.tabs.some((tab) => tab.id === PAGE_MODE_TAB_ID)) {
    const viewModeTab = modeTabs.tabs.find((tab) => tab.id === 'view-mode');

    if (viewModeTab?.visibilityDependsOn?.itemIds && !viewModeTab.visibilityDependsOn.itemIds.includes(PAGE_MODE_TAB_ID)) {
      viewModeTab.visibilityDependsOn.itemIds = [PAGE_MODE_TAB_ID, ...viewModeTab.visibilityDependsOn.itemIds];
    }

    modeTabs.tabs.splice(1, 0, {
      id: PAGE_MODE_TAB_ID,
      commandId: PAGE_MODE_COMMAND_ID,
      variant: 'text',
      categories: ['mode', 'page'],
    });
  }

  if (rightGroup) {
    if (!rightGroup.items.some((item) => item.id === THEME_BUTTON_ID)) {
      rightGroup.items.unshift({
        type: 'command-button',
        id: THEME_BUTTON_ID,
        commandId: THEME_COMMAND_ID,
        variant: 'icon',
      });
    }

    ui.mergeSchema({
      toolbars: {
        'main-toolbar': {
          ...toolbar,
          items,
        },
        [PAGE_TOOLBAR_ID]: {
          id: PAGE_TOOLBAR_ID,
          position: {
            placement: 'top',
            slot: 'secondary',
            order: 0,
          },
          items: [
            {
              type: 'spacer',
              id: 'shnctl-page-spacer-left',
              flex: true,
            },
            {
              type: 'group',
              id: 'shnctl-page-group',
              alignment: 'center',
              gap: 2,
              items: [
                {
                  type: 'custom',
                  id: 'shnctl-zoom-toolbar',
                  componentId: 'zoom-toolbar',
                  categories: ['zoom'],
                },
                {
                  type: 'divider',
                  id: 'shnctl-page-divider-0',
                  orientation: 'vertical',
                },
                {
                  type: 'command-button',
                  id: 'shnctl-single-page-button',
                  commandId: SINGLE_PAGE_COMMAND_ID,
                  variant: 'icon',
                },
                {
                  type: 'command-button',
                  id: 'shnctl-two-page-odd-button',
                  commandId: TWO_PAGE_ODD_COMMAND_ID,
                  variant: 'icon',
                },
                {
                  type: 'divider',
                  id: 'shnctl-page-divider-1',
                  orientation: 'vertical',
                },
                {
                  type: 'command-button',
                  id: 'shnctl-vertical-scroll-button',
                  commandId: VERTICAL_SCROLL_COMMAND_ID,
                  variant: 'icon',
                },
                {
                  type: 'command-button',
                  id: 'shnctl-horizontal-scroll-button',
                  commandId: HORIZONTAL_SCROLL_COMMAND_ID,
                  variant: 'icon',
                },
                {
                  type: 'divider',
                  id: 'shnctl-page-divider-2',
                  orientation: 'vertical',
                },
                {
                  type: 'command-button',
                  id: 'shnctl-rotate-button',
                  commandId: ROTATE_COMMAND_ID,
                  variant: 'icon',
                },
              ],
            },
            {
              type: 'spacer',
              id: 'shnctl-page-spacer-right',
              flex: true,
            },
          ],
          categories: ['page', 'zoom'],
        },
      },
    });
    refreshMainToolbar(registry, ui);
  }

  return () => {
    for (const commandId of registeredCommandIds) {
      commands.unregisterCommand(commandId);
    }
  };
}
