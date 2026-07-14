import { useEffect, useRef, useState, type ComponentType } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
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
  Search,
  ShieldCheck,
  Square,
  StickyNote,
  Strikethrough,
  Type,
  Underline,
  Undo2,
} from 'lucide-react';
import {
  getActiveDocumentId,
  getCurrentScrollAnchor,
  restoreScrollAnchor,
  type ScrollCapability,
} from './utils';
import {
  applyViewerThemeByIndex,
  getStoredToolbarPinned,
  setStoredToolbarPinned,
  VIEWER_THEMES,
} from './theme';
import { ShnctlSearch } from './search';
import { ShnctlIconButton } from './tool-button';
import { documentEditingEnabled } from '#platform';

type ToolbarMode = 'view' | 'page' | 'search' | 'draw';
type SpreadModeValue = SpreadMode;
type ScrollStrategyValue = ScrollStrategy;

const TOOLBAR_HIDE_DELAY_MS = 420;

interface ShnctlToolbarProps {
  registry?: PluginRegistry;
  activeDocumentId?: string | null;
  searchOpen: boolean;
  thumbnailsOpen: boolean;
  colorPaletteOpen: boolean;
  commentsOpen: boolean;
  themeIndexRef: React.MutableRefObject<number>;
  onSearchOpenChange(open: boolean): void;
  onToggleThumbnails(): void;
  onToggleColorPalette(): void;
  onToggleComments(): void;
  onOpenPrint(): void;
  onOpenProtect(): void;
}

interface ToolbarButtonProps {
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  active?: boolean;
  disabled?: boolean;
  onClick(): void;
}

interface ToolbarTooltip {
  label: string;
  left: number;
  top: number;
}

const MODE_ITEMS: Array<{
  id: ToolbarMode;
  label: string;
  icon: ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;
}> = [
  { id: 'view', label: 'VIEW', icon: Eye },
  { id: 'page', label: 'PAGE', icon: StickyNote },
  { id: 'search', label: 'SEARCH', icon: Search },
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

function ToolbarButton({ label, icon: Icon, active, disabled, onClick }: ToolbarButtonProps) {
  return (
    <ShnctlIconButton
      className="shnctl-toolbar-button"
      label={label}
      icon={Icon}
      active={active}
      disabled={disabled}
      tooltip="data"
      onClick={onClick}
    />
  );
}

function getDocumentScope<T>(
  registry: PluginRegistry | undefined,
  pluginId: string,
  documentId: string | null | undefined = registry ? getActiveDocumentId(registry) : undefined,
): { documentId: string; capability: T } | null {
  const capability = registry?.getPlugin(pluginId)?.provides?.() as T | undefined;

  return documentId && capability ? { documentId, capability } : null;
}

function useToolbarState(registry: PluginRegistry | undefined, activeDocumentId?: string | null) {
  const [zoomPercent, setZoomPercent] = useState(100);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>(1);
  const [panMode, setPanMode] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [spreadMode, setSpreadMode] = useState<SpreadModeValue>(SpreadMode.None);
  const [scrollStrategy, setScrollStrategy] = useState<ScrollStrategyValue>(ScrollStrategy.Vertical);

  useEffect(() => {
    const scopeInfo = getDocumentScope<ZoomCapability>(registry, 'zoom', activeDocumentId);
    if (!scopeInfo) {
      return;
    }

    const zoomScope = scopeInfo.capability.forDocument(scopeInfo.documentId);
    const syncZoom = (state = zoomScope.getState()) => {
      setZoomPercent(Math.round((state.currentZoomLevel || 1) * 100));
      setZoomLevel(state.zoomLevel);
    };

    syncZoom();
    return zoomScope.onStateChange(syncZoom);
  }, [activeDocumentId, registry]);

  useEffect(() => {
    const scopeInfo = getDocumentScope<PanCapability>(registry, 'pan', activeDocumentId);
    if (!scopeInfo) {
      return;
    }

    const panScope = scopeInfo.capability.forDocument(scopeInfo.documentId);
    setPanMode(panScope.isPanMode());
    return panScope.onPanModeChange(setPanMode);
  }, [activeDocumentId, registry]);

  useEffect(() => {
    const scopeInfo = getDocumentScope<AnnotationCapability>(registry, 'annotation', activeDocumentId);
    if (!scopeInfo) {
      return;
    }

    const annotationScope = scopeInfo.capability.forDocument(scopeInfo.documentId);
    setActiveTool(annotationScope.getActiveTool()?.id ?? null);
    return annotationScope.onActiveToolChange((tool) => setActiveTool(tool?.id ?? null));
  }, [activeDocumentId, registry]);

  useEffect(() => {
    const spread = registry?.getPlugin('spread')?.provides?.() as SpreadCapability | undefined;
    if (!spread || !activeDocumentId) {
      return;
    }

    const spreadScope = spread.forDocument(activeDocumentId);
    setSpreadMode(spreadScope.getSpreadMode());
    return spreadScope.onSpreadChange(setSpreadMode);
  }, [activeDocumentId, registry]);

  useEffect(() => {
    const scroll = registry?.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
    if (!registry || !scroll || !activeDocumentId) {
      return;
    }

    try {
      const state = registry.getStore().getState() as {
        plugins?: { scroll?: { documents?: Record<string, { strategy?: ScrollStrategyValue }> } };
      };
      setScrollStrategy(state.plugins?.scroll?.documents?.[activeDocumentId]?.strategy ?? ScrollStrategy.Vertical);
    } catch {
      setScrollStrategy(ScrollStrategy.Vertical);
    }

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

export function ShnctlToolbar({
  registry,
  activeDocumentId,
  searchOpen,
  thumbnailsOpen,
  colorPaletteOpen,
  commentsOpen,
  themeIndexRef,
  onSearchOpenChange,
  onToggleThumbnails,
  onToggleColorPalette,
  onToggleComments,
  onOpenPrint,
  onOpenProtect,
}: ShnctlToolbarProps) {
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [documentMenuOpen, setDocumentMenuOpen] = useState(false);
  const [selectedMode, setSelectedMode] = useState<ToolbarMode>('view');
  const [pinned, setPinned] = useState(() => getStoredToolbarPinned());
  const [tooltip, setTooltip] = useState<ToolbarTooltip | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarHideTimerRef = useRef<number | undefined>(undefined);
  const tooltipTimerRef = useRef<number | undefined>(undefined);
  const { zoomPercent, zoomLevel, panMode, activeTool, spreadMode, scrollStrategy } = useToolbarState(registry, activeDocumentId);
  const availableModeItems = documentEditingEnabled ? MODE_ITEMS : MODE_ITEMS.filter(({ id }) => id !== 'draw');
  const mode: ToolbarMode = searchOpen ? 'search' : selectedMode;
  const activeModeItem = availableModeItems.find(({ id }) => id === mode) ?? availableModeItems[0];
  const canUseRegistry = Boolean(registry && activeDocumentId);

  const clearToolbarHideTimer = () => {
    if (toolbarHideTimerRef.current !== undefined) {
      window.clearTimeout(toolbarHideTimerRef.current);
      toolbarHideTimerRef.current = undefined;
    }
  };

  const clearTooltipTimer = () => {
    if (tooltipTimerRef.current !== undefined) {
      window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = undefined;
    }
  };

  const hideTooltip = () => {
    clearTooltipTimer();
    setTooltip(null);
  };

  const scheduleTooltip = (target: EventTarget | null) => {
    const element = target instanceof Element
      ? target.closest<HTMLElement>('.shnctl-toolbar-button[data-shnctl-tooltip], .shnctl-toolbar-tab[data-shnctl-tooltip]')
      : null;
    const label = element?.dataset.shnctlTooltip;

    hideTooltip();
    if (!element || !label || element.matches(':disabled')) {
      return;
    }

    tooltipTimerRef.current = window.setTimeout(() => {
      const rect = element.getBoundingClientRect();
      setTooltip({
        label,
        left: rect.left + rect.width / 2,
        top: rect.bottom + 12,
      });
    }, 520);
  };

  const showToolbar = () => {
    clearToolbarHideTimer();
    toolbarRef.current?.setAttribute('data-visible', 'true');
  };

  const hideToolbar = () => {
    clearToolbarHideTimer();
    if (!pinned && !toolbarRef.current?.matches(':hover, :focus-within')) {
      toolbarRef.current?.removeAttribute('data-visible');
    }
  };

  const scheduleToolbarHide = () => {
    if (pinned) {
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
    setModeMenuOpen(false);
    setDocumentMenuOpen(false);
    setSelectedMode(nextMode);

    const annotation = documentEditingEnabled ? getDocumentScope<AnnotationCapability>(registry, 'annotation') : null;
    if (documentEditingEnabled && nextMode !== 'draw') {
      annotation?.capability.forDocument(annotation.documentId).setActiveTool(null);
    }

    if (nextMode === 'search') {
      onSearchOpenChange(true);
      return;
    }

    closeSearch();
  };

  const togglePan = () => {
    const scopeInfo = getDocumentScope<PanCapability>(registry, 'pan');
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

  const cycleTheme = () => {
    if (!registry) {
      return;
    }

    themeIndexRef.current = (themeIndexRef.current + 1) % VIEWER_THEMES.length;
    applyViewerThemeByIndex(themeIndexRef.current);
  };

  const togglePinned = () => {
    const nextPinned = !pinned;
    setPinned(nextPinned);
    setStoredToolbarPinned(nextPinned);
  };

  const requestZoom = (level: ZoomLevel) => {
    const scopeInfo = getDocumentScope<ZoomCapability>(registry, 'zoom');
    scopeInfo?.capability.forDocument(scopeInfo.documentId).requestZoom(level);
  };

  const zoomByButton = (direction: 1 | -1) => {
    const scopeInfo = getDocumentScope<ZoomCapability>(registry, 'zoom');
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
    const scopeInfo = getDocumentScope<AnnotationCapability>(registry, 'annotation');
    if (!scopeInfo) {
      return;
    }

    const annotationScope = scopeInfo.capability.forDocument(scopeInfo.documentId);
    annotationScope.setActiveTool(activeTool === toolId ? null : toolId);
    setSelectedMode('draw');
  };

  const setSpread = (nextSpreadMode: SpreadModeValue) => {
    const spread = registry?.getPlugin('spread')?.provides?.() as SpreadCapability | undefined;
    if (!spread) {
      return;
    }

    switchLayoutPreservingAnchor(registry, () => spread.setSpreadMode(nextSpreadMode));
  };

  const setScroll = (nextStrategy: ScrollStrategyValue) => {
    const scroll = registry?.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
    if (!scroll) {
      return;
    }

    switchLayoutPreservingAnchor(registry, (documentId) => scroll.setScrollStrategy(nextStrategy, documentId));
  };

  const rotateForward = () => {
    const rotate = registry?.getPlugin('rotate')?.provides?.() as RotateCapability | undefined;
    rotate?.rotateForward();
  };

  const printDocument = () => {
    setDocumentMenuOpen(false);
    closeSearch();
    onOpenPrint();
  };

  const openSecurityDialog = () => {
    setDocumentMenuOpen(false);
    closeSearch();
    onOpenProtect();
  };

  const exportDocument = () => {
    setDocumentMenuOpen(false);
    const exportCapability = registry?.getPlugin('export')?.provides?.() as ExportCapability | undefined;
    if (!exportCapability) {
      return;
    }

    const documentId = registry ? getActiveDocumentId(registry) : undefined;
    if (documentId) {
      exportCapability.forDocument(documentId).download();
    } else {
      exportCapability.download();
    }
  };

  const toggleThumbnailsPanel = () => {
    setDocumentMenuOpen(false);
    setModeMenuOpen(false);
    closeSearch();
    onToggleThumbnails();
  };

  const runAnnotationHistory = (direction: 'undo' | 'redo') => {
    const scopeInfo = getDocumentScope<HistoryCapability>(registry, 'history');
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

      const target = event.target;
      if (target instanceof HTMLElement) {
        const tagName = target.tagName.toLowerCase();
        if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable) {
          return;
        }
      }

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
      clearTooltipTimer();
    };
  }, [pinned]);

  return (
    <div
      ref={toolbarRef}
      className="shnctl-toolbar-shell"
      data-pinned={pinned ? 'true' : undefined}
      data-visible={pinned ? 'true' : undefined}
      onMouseEnter={showToolbar}
      onMouseLeave={() => {
        hideTooltip();
        scheduleToolbarHide();
      }}
      onPointerOver={(event) => scheduleTooltip(event.target)}
      onPointerOut={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && toolbarRef.current?.contains(nextTarget)) {
          return;
        }
        hideTooltip();
      }}
      onFocus={(event) => scheduleTooltip(event.target)}
      onBlur={hideTooltip}
    >
      <div className="shnctl-toolbar-main" role="toolbar" aria-label="PDF toolbar">
        <div className="shnctl-toolbar-zone shnctl-toolbar-zone-left">
          <div className="shnctl-toolbar-group">
            <button
              type="button"
              className="shnctl-action shnctl-toolbar-button shnctl-document-menu-button"
              onClick={() => {
                setModeMenuOpen(false);
                setDocumentMenuOpen((open) => !open);
              }}
              aria-label="Document menu"
              aria-haspopup="menu"
              aria-expanded={documentMenuOpen}
            >
              <Menu size={14} strokeWidth={2} />
            </button>
            <ToolbarButton label="Switch theme" icon={Palette} onClick={cycleTheme} disabled={!registry} />
            <ToolbarButton label="Pan" icon={Hand} active={panMode} onClick={togglePan} disabled={!canUseRegistry} />
            <ToolbarButton label="Pin toolbar" icon={Pin} active={pinned} onClick={togglePinned} />
            {documentMenuOpen ? (
              <div className="shnctl-toolbar-menu shnctl-document-menu" role="menu" onMouseLeave={() => setDocumentMenuOpen(false)}>
                <button type="button" role="menuitem" className={thumbnailsOpen ? 'is-active' : ''} onClick={toggleThumbnailsPanel} disabled={!canUseRegistry}>
                  <BookImage size={14} strokeWidth={2} />
                  <span>Thumbnails</span>
                </button>
                <button type="button" role="menuitem" onClick={printDocument}>
                  <Printer size={14} strokeWidth={2} />
                  <span>Print</span>
                </button>
                {documentEditingEnabled ? <button type="button" role="menuitem" onClick={openSecurityDialog} disabled={!canUseRegistry}>
                  <ShieldCheck size={14} strokeWidth={2} />
                  <span>Security</span>
                </button> : null}
                {documentEditingEnabled ? <button
                  type="button"
                  role="menuitem"
                  className={commentsOpen ? 'is-active' : ''}
                  onClick={() => {
                    setDocumentMenuOpen(false);
                    closeSearch();
                    onToggleComments();
                  }}
                  disabled={!canUseRegistry}
                >
                  <MessageSquareMore size={14} strokeWidth={2} />
                  <span>Comments</span>
                </button> : null}
                {documentEditingEnabled ? <button type="button" role="menuitem" onClick={() => void exportDocument()} disabled={!canUseRegistry}>
                  <Download size={14} strokeWidth={2} />
                  <span>Export</span>
                </button> : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="shnctl-toolbar-zone shnctl-toolbar-zone-center">
          <div className="shnctl-toolbar-group shnctl-toolbar-modes">
            <button
              type="button"
              className="shnctl-toolbar-mode-select"
              onClick={() => setModeMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={modeMenuOpen}
            >
              <activeModeItem.icon className="shnctl-mode-icon" size={14} strokeWidth={2} />
              <span>{activeModeItem.label}</span>
            </button>
            {modeMenuOpen ? (
              <div className="shnctl-toolbar-menu" role="menu" onMouseLeave={() => setModeMenuOpen(false)}>
                {availableModeItems.map(({ id, label, icon: Icon }) => (
                  <button key={id} type="button" role="menuitem" className={mode === id ? 'is-active' : ''} onClick={() => setMode(id)}>
                    <Icon className="shnctl-mode-icon" size={14} strokeWidth={2} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {availableModeItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={`shnctl-toolbar-tab${mode === id ? ' is-active' : ''}`}
                onClick={() => setMode(id)}
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
            <select
              className="shnctl-toolbar-zoom-select"
              value={typeof zoomLevel === 'number' ? String(zoomLevel) : zoomLevel}
              onChange={(event) => {
                const option = ZOOM_OPTIONS.find((item) => String(item.value) === event.currentTarget.value);
                requestZoom(option?.value ?? Number(event.currentTarget.value));
              }}
              aria-label="Zoom"
            >
              <option value={typeof zoomLevel === 'number' ? String(zoomLevel) : zoomLevel}>{zoomPercent}%</option>
              {ZOOM_OPTIONS.map((item) => (
                <option key={String(item.value)} value={String(item.value)}>{item.label}</option>
              ))}
            </select>
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

      {mode === 'search' ? <ShnctlSearch registry={registry} open /> : null}

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
      {tooltip ? (
        <div
          className="shnctl-toolbar-floating-tooltip"
          style={{ left: tooltip.left, top: tooltip.top }}
          role="tooltip"
        >
          {tooltip.label}
        </div>
      ) : null}
    </div>
  );
}
