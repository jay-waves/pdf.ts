import { useEffect, useRef, useState, type ComponentType } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import type { ExportCapability } from '@embedpdf/plugin-export';
import type { HistoryCapability } from '@embedpdf/plugin-history';
import type { PanCapability } from '@embedpdf/plugin-pan';
import type { RotateCapability } from '@embedpdf/plugin-rotate';
import { ScrollStrategy } from '@embedpdf/plugin-scroll';
import { SpreadMode, type SpreadCapability } from '@embedpdf/plugin-spread';
import { ZoomMode, type ZoomCapability, type ZoomLevel } from '@embedpdf/plugin-zoom';
import {
  ArrowDownUp,
  ArrowLeftRight,
  BookImage,
  Download,
  GalleryHorizontal,
  Hand,
  Highlighter,
  LineSquiggle,
  ListTree,
  Eye,
  Menu,
  MessageSquareMore,
  Minus,
  MoveUpRight,
  Palette,
  PaintBucket,
  PencilRuler,
  Pin,
  Plus,
  Printer,
  Redo2,
  RotateCw,
  Search as SearchIcon,
  ShieldCheck,
  Square,
  StickyNote,
  Strikethrough,
  Type,
  Underline,
  Undo2,
} from 'lucide-react';
import { getAnnotationScope } from './annotations';
import {
  getActiveDocumentId,
  getCurrentScrollAnchor,
  getDocumentCapability,
  getDocumentScrollStrategy,
  getPluginCapability,
  isEditableTarget,
  restoreScrollAnchor,
  type ScrollCapability,
} from './utils';
import {
  cycleViewerTheme,
  getStoredToolbarPinned,
  setStoredToolbarPinned,
} from './theme';
import { Search } from './search';
import {
  DropdownMenu,
  DropdownMenuItem,
  IconButton,
  Select,
} from './components';
import { documentEditingEnabled } from '#platform';

type ToolbarMode = 'view' | 'page' | 'search' | 'draw';
type PersistentToolbarMode = Exclude<ToolbarMode, 'search'>;
const TOOLBAR_HIDE_DELAY_MS = 420;

interface ToolbarProps {
  registry?: PluginRegistry;
  activeDocumentId?: string | null;
  searchOpen: boolean;
  thumbnailsOpen: boolean;
  outlineOpen: boolean;
  colorPaletteOpen: boolean;
  commentsOpen: boolean;
  onSearchOpenChange(open: boolean): void;
  onToggleThumbnails(): void;
  onOpenOutline(): void;
  onToggleColorPalette(): void;
  onToggleComments(): void;
  onOpenPrint(): void;
  onOpenProtect(): void;
  onPinnedInsetChange(inset: number): void;
}

interface ToolbarButtonProps {
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  active?: boolean;
  disabled?: boolean;
  onClick(): void;
}

const MODE_ITEMS: Array<{
  id: ToolbarMode;
  label: string;
  icon: ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;
}> = [
  { id: 'view', label: 'VIEW', icon: Eye },
  { id: 'page', label: 'PAGE', icon: StickyNote },
  { id: 'search', label: 'SEARCH', icon: SearchIcon },
  ...(documentEditingEnabled ? [{ id: 'draw' as const, label: 'DRAW', icon: PencilRuler }] : []),
];

const DRAW_TOOLS = documentEditingEnabled ? [
  { id: 'highlight', label: 'Highlight', icon: Highlighter },
  { id: 'underline', label: 'Underline', icon: Underline },
  { id: 'strikeout', label: 'Strikeout', icon: Strikethrough },
  { id: 'square', label: 'Rectangle', icon: Square },
  { id: 'lineArrow', label: 'Arrow', icon: MoveUpRight },
  { id: 'ink', label: 'Ink', icon: LineSquiggle },
  { id: 'textComment', label: 'Comment', icon: MessageSquareMore },
  { id: 'freeText', label: 'Text', icon: Type },
] : [];

const ZOOM_OPTIONS: Array<{ label: string; value: ZoomLevel }> = [
  { label: 'Fit page', value: ZoomMode.FitPage },
  { label: 'Fit width', value: ZoomMode.FitWidth },
  { label: '50%', value: 0.5 },
  { label: '75%', value: 0.75 },
  { label: '100%', value: 1 },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.5 },
  { label: '200%', value: 2 },
];
const ZOOM_SELECT_OPTIONS = ZOOM_OPTIONS.map(({ label, value }) => ({ label, value: String(value) }));
const ZOOM_LEVELS = new Map(ZOOM_OPTIONS.map(({ value }) => [String(value), value]));

function ToolbarButton({ label, icon: Icon, active, disabled, onClick }: ToolbarButtonProps) {
  return (
    <IconButton
      className="shnctl-toolbar-button"
      label={label}
      icon={Icon}
      active={active}
      disabled={disabled}
      onClick={onClick}
    />
  );
}

function useToolbarState(registry: PluginRegistry | undefined, activeDocumentId?: string | null) {
  const [zoomPercent, setZoomPercent] = useState(100);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>(1);
  const [panMode, setPanMode] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [spreadMode, setSpreadMode] = useState(SpreadMode.None);
  const [scrollStrategy, setScrollStrategy] = useState(ScrollStrategy.Vertical);

  useEffect(() => {
    const scopeInfo = getDocumentCapability<ZoomCapability>(registry, 'zoom', activeDocumentId);
    if (!scopeInfo) {
      return;
    }

    const zoomScope = scopeInfo.capability.forDocument(scopeInfo.documentId);
    const syncZoom = (state = zoomScope.getState()) => {
      setZoomPercent(Math.round((state.currentZoomLevel ?? 1) * 100));
      setZoomLevel(state.zoomLevel);
    };

    syncZoom();
    return zoomScope.onStateChange(syncZoom);
  }, [activeDocumentId, registry]);

  useEffect(() => {
    const scopeInfo = getDocumentCapability<PanCapability>(registry, 'pan', activeDocumentId);
    if (!scopeInfo) {
      return;
    }

    const panScope = scopeInfo.capability.forDocument(scopeInfo.documentId);
    setPanMode(panScope.isPanMode());
    return panScope.onPanModeChange(setPanMode);
  }, [activeDocumentId, registry]);

  useEffect(() => {
    const scopeInfo = getAnnotationScope(registry, activeDocumentId);
    if (!scopeInfo) {
      return;
    }

    setActiveTool(scopeInfo.scope.getActiveTool()?.id ?? null);
    return scopeInfo.scope.onActiveToolChange((tool) => setActiveTool(tool?.id ?? null));
  }, [activeDocumentId, registry]);

  useEffect(() => {
    const spread = getPluginCapability<SpreadCapability>(registry, 'spread');
    if (!spread || !activeDocumentId) {
      return;
    }

    const spreadScope = spread.forDocument(activeDocumentId);
    setSpreadMode(spreadScope.getSpreadMode());
    return spreadScope.onSpreadChange(setSpreadMode);
  }, [activeDocumentId, registry]);

  useEffect(() => {
    const scroll = getPluginCapability<ScrollCapability>(registry, 'scroll');
    if (!registry || !scroll || !activeDocumentId) {
      return;
    }

    setScrollStrategy(getDocumentScrollStrategy(registry, activeDocumentId));

    return scroll.onStateChange((state) => setScrollStrategy(state.strategy ?? ScrollStrategy.Vertical));
  }, [activeDocumentId, registry]);

  return { zoomPercent, zoomLevel, panMode, activeTool, spreadMode, scrollStrategy };
}

function switchLayoutPreservingAnchor(registry: PluginRegistry | undefined, updateLayout: (documentId: string) => void) {
  if (!registry) {
    return;
  }

  const documentId = getActiveDocumentId(registry);
  if (!documentId) {
    return;
  }

  const anchor = getCurrentScrollAnchor(registry);
  updateLayout(documentId);
  restoreScrollAnchor(registry, anchor);
}

export function Toolbar({
  registry,
  activeDocumentId,
  searchOpen,
  thumbnailsOpen,
  outlineOpen,
  colorPaletteOpen,
  commentsOpen,
  onSearchOpenChange,
  onToggleThumbnails,
  onOpenOutline,
  onToggleColorPalette,
  onToggleComments,
  onOpenPrint,
  onOpenProtect,
  onPinnedInsetChange,
}: ToolbarProps) {
  const [openMenu, setOpenMenu] = useState<'document' | 'mode' | null>(null);
  const [selectedMode, setSelectedMode] = useState<PersistentToolbarMode>('view');
  const [pinned, setPinned] = useState(() => getStoredToolbarPinned());
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarHideTimerRef = useRef<number | undefined>(undefined);
  const { zoomPercent, zoomLevel, panMode, activeTool, spreadMode, scrollStrategy } = useToolbarState(registry, activeDocumentId);
  const mode: ToolbarMode = searchOpen ? 'search' : selectedMode;
  const activeModeItem = MODE_ITEMS.find(({ id }) => id === mode) ?? MODE_ITEMS[0];
  const canUseRegistry = Boolean(registry && activeDocumentId);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const updateInset = () => {
      onPinnedInsetChange(pinned ? toolbar.getBoundingClientRect().height : 0);
    };

    updateInset();
    if (!pinned) return;

    const observer = new ResizeObserver(updateInset);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [onPinnedInsetChange, pinned]);

  const clearToolbarHideTimer = () => {
    if (toolbarHideTimerRef.current !== undefined) {
      window.clearTimeout(toolbarHideTimerRef.current);
      toolbarHideTimerRef.current = undefined;
    }
  };

  const showToolbar = () => {
    clearToolbarHideTimer();
    toolbarRef.current?.setAttribute('data-visible', 'true');
  };

  const hideToolbar = () => {
    clearToolbarHideTimer();
    if (!pinned && !openMenu && !toolbarRef.current?.matches(':hover, :focus-within')) {
      toolbarRef.current?.removeAttribute('data-visible');
    }
  };

  const scheduleToolbarHide = () => {
    if (pinned || openMenu) {
      return;
    }

    clearToolbarHideTimer();
    toolbarHideTimerRef.current = window.setTimeout(hideToolbar, TOOLBAR_HIDE_DELAY_MS);
  };

  useEffect(() => {
    if (documentEditingEnabled && activeTool && !searchOpen) {
      setSelectedMode('draw');
    }
  }, [activeTool, searchOpen]);

  const closeSearch = () => onSearchOpenChange(false);
  const setMode = (nextMode: ToolbarMode) => {
    setOpenMenu(null);

    if (documentEditingEnabled && nextMode !== 'draw') {
      getAnnotationScope(registry)?.scope.setActiveTool(null);
    }

    if (nextMode === 'search') {
      onSearchOpenChange(true);
      return;
    }

    setSelectedMode(nextMode);
    closeSearch();
  };

  const togglePan = () => {
    const scopeInfo = getDocumentCapability<PanCapability>(registry, 'pan');
    if (!scopeInfo) {
      return;
    }

    const panScope = scopeInfo.capability.forDocument(scopeInfo.documentId);
    if (panScope.isPanMode()) {
      panScope.disablePan();
    } else {
      panScope.enablePan();
    }
  };

  const togglePinned = () => {
    const nextPinned = !pinned;
    setPinned(nextPinned);
    setStoredToolbarPinned(nextPinned);
  };

  const requestZoom = (level: ZoomLevel) => {
    const scopeInfo = getDocumentCapability<ZoomCapability>(registry, 'zoom');
    scopeInfo?.capability.forDocument(scopeInfo.documentId).requestZoom(level);
  };

  const zoomByButton = (direction: 1 | -1) => {
    const scopeInfo = getDocumentCapability<ZoomCapability>(registry, 'zoom');
    if (!scopeInfo) {
      return;
    }

    const zoomScope = scopeInfo.capability.forDocument(scopeInfo.documentId);
    if (direction > 0) {
      zoomScope.zoomIn();
    } else {
      zoomScope.zoomOut();
    }
  };

  const selectDrawTool = (toolId: string) => {
    closeSearch();
    const scopeInfo = getAnnotationScope(registry);
    if (!scopeInfo) {
      return;
    }

    scopeInfo.scope.setActiveTool(activeTool === toolId ? null : toolId);
    setSelectedMode('draw');
  };

  const setSpread = (nextSpreadMode: SpreadMode) => {
    const spread = getPluginCapability<SpreadCapability>(registry, 'spread');
    if (!spread) {
      return;
    }

    switchLayoutPreservingAnchor(registry, () => spread.setSpreadMode(nextSpreadMode));
  };

  const setScroll = (nextStrategy: ScrollStrategy) => {
    const scroll = getPluginCapability<ScrollCapability>(registry, 'scroll');
    if (!scroll) {
      return;
    }

    switchLayoutPreservingAnchor(registry, (documentId) => scroll.setScrollStrategy(nextStrategy, documentId));
  };

  const rotateForward = () => {
    const rotate = getPluginCapability<RotateCapability>(registry, 'rotate');
    rotate?.rotateForward();
  };

  const printDocument = () => {
    closeSearch();
    onOpenPrint();
  };

  const openSecurityDialog = () => {
    closeSearch();
    onOpenProtect();
  };

  const exportDocument = () => {
    const scopeInfo = getDocumentCapability<ExportCapability>(registry, 'export');
    scopeInfo?.capability.forDocument(scopeInfo.documentId).download();
  };

  const toggleThumbnailsPanel = () => {
    closeSearch();
    onToggleThumbnails();
  };

  const runAnnotationHistory = (direction: 'undo' | 'redo') => {
    const scopeInfo = getDocumentCapability<HistoryCapability>(registry, 'history');
    if (!scopeInfo) {
      return;
    }

    const historyScope = scopeInfo.capability.forDocument(scopeInfo.documentId);
    if (direction === 'undo') {
      historyScope.undo();
    } else {
      historyScope.redo();
    }
  };

  useEffect(() => {
    if (!documentEditingEnabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey) {
        return;
      }

      if (isEditableTarget(event.target)) return;

      const key = event.key.toLowerCase();
      const direction = key === 'y' || (key === 'z' && event.shiftKey) ? 'redo' : key === 'z' ? 'undo' : null;
      if (!direction) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      runAnnotationHistory(direction);
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [registry]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (pinned || event.clientY <= 40) {
        showToolbar();
      } else if (!toolbarRef.current?.matches(':hover, :focus-within')) {
        scheduleToolbarHide();
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      clearToolbarHideTimer();
    };
  }, [openMenu, pinned]);

  return (
    <div
      ref={toolbarRef}
      className="shnctl-toolbar-shell"
      data-pinned={pinned ? 'true' : undefined}
      data-visible={pinned ? 'true' : undefined}
      onMouseEnter={showToolbar}
      onMouseLeave={scheduleToolbarHide}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="shnctl-toolbar-main" role="toolbar" aria-label="PDF toolbar">
        <div className="shnctl-toolbar-zone shnctl-toolbar-zone-left">
          <div className="shnctl-toolbar-group">
            <DropdownMenu
              open={openMenu === 'document'}
              onOpenChange={(open) => setOpenMenu((current) => (
                open ? 'document' : current === 'document' ? null : current
              ))}
              className="shnctl-toolbar-menu"
              trigger={(
                <button type="button" className="shnctl-action shnctl-toolbar-button" aria-label="Document menu">
                  <Menu size={14} strokeWidth={2} />
                </button>
              )}
            >
              <DropdownMenuItem className={thumbnailsOpen ? 'is-active' : undefined} onSelect={toggleThumbnailsPanel} disabled={!canUseRegistry}>
                <BookImage size={14} strokeWidth={2} />
                <span>Thumbnails</span>
              </DropdownMenuItem>
              <DropdownMenuItem className={outlineOpen ? 'is-active' : undefined} onSelect={onOpenOutline} disabled={!canUseRegistry}>
                <ListTree size={14} strokeWidth={2} />
                <span>Contents</span>
              </DropdownMenuItem>
              {documentEditingEnabled ? <DropdownMenuItem
                className={commentsOpen ? 'is-active' : undefined}
                onSelect={() => {
                  closeSearch();
                  onToggleComments();
                }}
                disabled={!canUseRegistry}
              >
                <MessageSquareMore size={14} strokeWidth={2} />
                <span>Comments</span>
              </DropdownMenuItem> : null}
              <DropdownMenuItem onSelect={printDocument} disabled={!canUseRegistry}>
                <Printer size={14} strokeWidth={2} />
                <span>Print</span>
              </DropdownMenuItem>
              {documentEditingEnabled ? <DropdownMenuItem onSelect={openSecurityDialog} disabled={!canUseRegistry}>
                <ShieldCheck size={14} strokeWidth={2} />
                <span>Security</span>
              </DropdownMenuItem> : null}
              {documentEditingEnabled ? <DropdownMenuItem onSelect={exportDocument} disabled={!canUseRegistry}>
                <Download size={14} strokeWidth={2} />
                <span>Export</span>
              </DropdownMenuItem> : null}
            </DropdownMenu>
            <ToolbarButton label="Switch theme" icon={Palette} onClick={cycleViewerTheme} />
            <ToolbarButton label="Pan" icon={Hand} active={panMode} onClick={togglePan} disabled={!canUseRegistry} />
            <ToolbarButton label="Pin toolbar" icon={Pin} active={pinned} onClick={togglePinned} />
          </div>
        </div>

        <div className="shnctl-toolbar-zone shnctl-toolbar-zone-center">
          <div className="shnctl-toolbar-group shnctl-toolbar-modes">
            <DropdownMenu
              open={openMenu === 'mode'}
              onOpenChange={(open) => setOpenMenu((current) => (
                open ? 'mode' : current === 'mode' ? null : current
              ))}
              align="end"
              trigger={(
                <button type="button" className="shnctl-toolbar-mode-select">
                  <activeModeItem.icon className="shnctl-mode-icon" size={14} strokeWidth={2} />
                  <span>{activeModeItem.label}</span>
                </button>
              )}
            >
                {MODE_ITEMS.map(({ id, label, icon: Icon }) => (
                <DropdownMenuItem key={id} className={mode === id ? 'is-active' : undefined} onSelect={() => setMode(id)}>
                    <Icon className="shnctl-mode-icon" size={14} strokeWidth={2} />
                    <span>{label}</span>
                </DropdownMenuItem>
                ))}
            </DropdownMenu>
            {MODE_ITEMS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={`shnctl-toolbar-tab${mode === id ? ' is-active' : ''}`}
                onClick={() => setMode(id)}
                aria-pressed={mode === id}
              >
                <Icon className="shnctl-mode-icon" size={14} strokeWidth={2} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

      </div>

      {mode === 'page' ? (
        <div className="shnctl-toolbar-secondary" role="toolbar" aria-label="Page toolbar">
          <div className="shnctl-toolbar-group">
            <ToolbarButton label="Zoom out" icon={Minus} onClick={() => zoomByButton(-1)} disabled={!canUseRegistry} />
            <Select
              className="shnctl-toolbar-zoom-select"
              value={typeof zoomLevel === 'number' ? String(zoomLevel) : zoomLevel}
              displayValue={`${zoomPercent}%`}
              options={ZOOM_SELECT_OPTIONS}
              onValueChange={(value) => {
                const level = ZOOM_LEVELS.get(value);
                if (level !== undefined) requestZoom(level);
              }}
              label="Zoom"
              disabled={!canUseRegistry}
            />
            <ToolbarButton label="Zoom in" icon={Plus} onClick={() => zoomByButton(1)} disabled={!canUseRegistry} />
          </div>
          <div className="shnctl-toolbar-divider" />
          <div className="shnctl-toolbar-group">
            <ToolbarButton label={spreadMode === SpreadMode.Odd ? 'Single page' : 'Two page'} icon={GalleryHorizontal} active={spreadMode === SpreadMode.Odd} onClick={() => setSpread(spreadMode === SpreadMode.Odd ? SpreadMode.None : SpreadMode.Odd)} disabled={!canUseRegistry} />
            <ToolbarButton label="Vertical scroll" icon={ArrowDownUp} active={scrollStrategy === ScrollStrategy.Vertical} onClick={() => setScroll(ScrollStrategy.Vertical)} disabled={!canUseRegistry} />
            <ToolbarButton label="Horizontal scroll" icon={ArrowLeftRight} active={scrollStrategy === ScrollStrategy.Horizontal} onClick={() => setScroll(ScrollStrategy.Horizontal)} disabled={!canUseRegistry} />
            <ToolbarButton label="Rotate" icon={RotateCw} onClick={rotateForward} disabled={!canUseRegistry} />
          </div>
        </div>
      ) : null}

      {mode === 'search' ? <Search registry={registry} open /> : null}

      {documentEditingEnabled && mode === 'draw' ? (
        <div className="shnctl-toolbar-secondary" role="toolbar" aria-label="Draw toolbar">
          <div className="shnctl-toolbar-group shnctl-draw-tools">
            {DRAW_TOOLS.map(({ id, label, icon }) => (
              <ToolbarButton key={id} label={label} icon={icon} active={activeTool === id} onClick={() => selectDrawTool(id)} disabled={!canUseRegistry} />
            ))}
            <div className="shnctl-toolbar-divider" />
            <ToolbarButton label="Colors" icon={PaintBucket} active={colorPaletteOpen} onClick={onToggleColorPalette} disabled={!canUseRegistry} />
            <ToolbarButton label="Undo" icon={Undo2} onClick={() => runAnnotationHistory('undo')} disabled={!canUseRegistry} />
            <ToolbarButton label="Redo" icon={Redo2} onClick={() => runAnnotationHistory('redo')} disabled={!canUseRegistry} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
