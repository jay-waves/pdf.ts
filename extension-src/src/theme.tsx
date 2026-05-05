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
          app: '#fdf6e3',
          surface: '#eee8d5',
          surfaceAlt: '#f4efd9',
          elevated: '#fffaf0',
          overlay: 'rgba(147, 128, 108, 0.22)',
          input: '#fdf6e3',
        },
        foreground: {
          primary: '#073642',
          secondary: '#586e75',
          muted: '#839496',
          disabled: '#93a1a1',
          onAccent: '#fdf6e3',
        },
        border: {
          default: '#d6cfb8',
          subtle: '#e2dcc7',
          strong: '#268bd2',
        },
        accent: {
          primary: '#268bd2',
          primaryHover: '#2aa198',
          primaryActive: '#006d8f',
          primaryLight: '#d8edf0',
          primaryForeground: '#fdf6e3',
        },
        interactive: {
          hover: '#e8dfc6',
          active: '#ddd3ba',
          selected: '#d8edf0',
          focus: '#268bd2',
          focusRing: '#93a1a1',
        },
      },
    },
  },
  {
    id: 'morandi',
    name: 'Morandi',
    icon: 'shnctl-palette-5',
    config: {
      preference: 'light',
      light: {
        background: {
          app: '#f3f0ea',
          surface: '#e6e0d7',
          surfaceAlt: '#ece7df',
          elevated: '#faf7f1',
          overlay: 'rgba(116, 105, 96, 0.22)',
          input: '#f8f5ef',
        },
        foreground: {
          primary: '#353331',
          secondary: '#5d5853',
          muted: '#80796f',
          disabled: '#aaa196',
          onAccent: '#fffaf4',
        },
        border: {
          default: '#d0c8bd',
          subtle: '#ddd6cc',
          strong: '#7b8f87',
        },
        accent: {
          primary: '#7b8f87',
          primaryHover: '#6f817a',
          primaryActive: '#63756f',
          primaryLight: '#d9dfdb',
          primaryForeground: '#fffaf4',
        },
        interactive: {
          hover: '#ded8cf',
          active: '#d3cbc1',
          selected: '#d9dfdb',
          focus: '#7b8f87',
          focusRing: '#b7aaa0',
        },
      },
    },
  },
  {
    id: 'mediterranean',
    name: 'Mediterranean',
    icon: 'shnctl-palette-6',
    config: {
      preference: 'light',
      light: {
        background: {
          app: '#f3f4ee',
          surface: '#e6ece6',
          surfaceAlt: '#eef1ea',
          elevated: '#fbfbf4',
          overlay: 'rgba(58, 83, 92, 0.2)',
          input: '#f8f8f1',
        },
        foreground: {
          primary: '#263b40',
          secondary: '#486064',
          muted: '#6d7d7f',
          disabled: '#9aa5a4',
          onAccent: '#f7fbf8',
        },
        border: {
          default: '#c9d4cf',
          subtle: '#d9e0dc',
          strong: '#3f7278',
        },
        accent: {
          primary: '#3f7278',
          primaryHover: '#35666d',
          primaryActive: '#2e5a60',
          primaryLight: '#d7e6e3',
          primaryForeground: '#f7fbf8',
        },
        interactive: {
          hover: '#dce7e2',
          active: '#ccdcd6',
          selected: '#d7e6e3',
          focus: '#3f7278',
          focusRing: '#8aa9a8',
        },
      },
    },
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: 'shnctl-palette-7',
    config: {
      preference: 'light',
      light: {
        background: {
          app: '#f6f8fa',
          surface: '#ffffff',
          surfaceAlt: '#f6f8fa',
          elevated: '#ffffff',
          overlay: 'rgba(31, 35, 40, 0.16)',
          input: '#ffffff',
        },
        foreground: {
          primary: '#1f2328',
          secondary: '#59636e',
          muted: '#6e7781',
          disabled: '#8c959f',
          onAccent: '#ffffff',
        },
        border: {
          default: '#d0d7de',
          subtle: '#d8dee4',
          strong: '#0969da',
        },
        accent: {
          primary: '#0969da',
          primaryHover: '#0757b7',
          primaryActive: '#054da7',
          primaryLight: '#ddf4ff',
          primaryForeground: '#ffffff',
        },
        interactive: {
          hover: '#f3f4f6',
          active: '#eaeef2',
          selected: '#ddf4ff',
          focus: '#0969da',
          focusRing: '#0969da',
        },
      },
    },
  },
];

const THEME_COMMAND_ID = 'shnctl.theme.cycle';
const THEME_BUTTON_ID = 'shnctl-theme-cycle-button';
const THEME_STORAGE_KEY = 'shnctl-viewer-theme-v1';

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
  });
}

function refreshMainToolbar(registry: PluginRegistry, ui: UICapability) {
  const documentId = getActiveDocumentId(registry);

  if (documentId) {
    ui.forDocument(documentId).setActiveToolbar('top', 'main', 'main-toolbar');
  }
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

  commands.registerCommand(themeCommand);

  const schema = ui.getSchema();
  const toolbar = schema.toolbars['main-toolbar'];
  if (!toolbar) {
    return () => commands.unregisterCommand(THEME_COMMAND_ID);
  }

  const items = removeToolbarItemByCommandId(structuredClone(toolbar.items) as ToolbarItem[], COMMENT_PANEL_COMMAND_ID);
  const rightGroup = items.find((item): item is Extract<ToolbarItem, { type: 'group' }> => item.type === 'group' && item.id === 'right-group');

  if (rightGroup && !rightGroup.items.some((item) => item.id === THEME_BUTTON_ID)) {
    rightGroup.items.unshift({
      type: 'command-button',
      id: THEME_BUTTON_ID,
      commandId: THEME_COMMAND_ID,
      variant: 'icon',
    });

    ui.mergeSchema({
      toolbars: {
        'main-toolbar': {
          ...toolbar,
          items,
        },
      },
    });
    refreshMainToolbar(registry, ui);
  }

  return () => {
    commands.unregisterCommand(THEME_COMMAND_ID);
  };
}
