import { useEffect, useRef, useState, type ComponentType } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import type { PDFViewerRef } from '@embedpdf/react-pdf-viewer';
import {
  ArrowDownUp,
  ArrowLeftRight,
  BookImage,
  Download,
  GalleryHorizontal,
  Hand,
  Highlighter,
  Menu,
  MessageSquareMore,
  Minus,
  Palette,
  PaintBucket,
  PanelRight,
  Pin,
  Plus,
  Printer,
  Redo2,
  RotateCw,
  ShieldCheck,
  Signature,
  Square,
  Strikethrough,
  Type,
  Underline,
  Undo2,
} from 'lucide-react';
import {
  getActiveDocumentId,
  getCurrentScrollAnchor,
  restoreScrollAnchorAfterLayout,
  type ScrollCapability,
} from './utils';
import {
  applyViewerThemeByIndex,
  getStoredToolbarPinned,
  setStoredToolbarPinned,
  VIEWER_THEMES,
} from './theme';
import { ShnctlSearch } from './search';

type ToolbarMode = 'view' | 'page' | 'search' | 'draw';
type SpreadModeValue = 'none' | 'odd' | 'even';
type ScrollStrategyValue = 'vertical' | 'horizontal';
type ZoomLevel = 'automatic' | 'fit-page' | 'fit-width' | number;

const TOOLBAR_HIDE_DELAY_MS = 420;

interface ZoomScope {
  requestZoom(level: ZoomLevel): void;
  zoomIn(): void;
  zoomOut(): void;
  getState(): { currentZoomLevel: number; zoomLevel: ZoomLevel };
  onStateChange(listener: (state: { currentZoomLevel: number; zoomLevel: ZoomLevel }) => void): () => void;
}

interface ZoomCapability {
  forDocument(documentId: string): ZoomScope;
}

interface SpreadCapability {
  setSpreadMode(mode: SpreadModeValue): void;
  getSpreadMode(): SpreadModeValue;
  onSpreadChange(listener: { documentId: string; spreadMode: SpreadModeValue } | ((event: { documentId: string; spreadMode: SpreadModeValue }) => void)): () => void;
}

interface RotateCapability {
  rotateForward(): void;
}

interface PanCapability {
  forDocument(documentId: string): {
    enablePan(): void;
    disablePan(): void;
    isPanMode(): boolean;
    onPanModeChange(listener: (isPanMode: boolean) => void): () => void;
  };
}

interface AnnotationCapability {
  forDocument(documentId: string): {
    getActiveTool(): { id: string } | null;
    setActiveTool(toolId: string | null): void;
    onActiveToolChange(listener: (tool: { id: string } | null) => void): () => void;
    undo?(): void;
    redo?(): void;
  };
  undo?(documentId?: string): void;
  redo?(documentId?: string): void;
}

interface ExportCapability {
  saveAsCopy(): { toPromise(): Promise<ArrayBuffer> };
  download?(): void;
  forDocument?(documentId: string): {
    saveAsCopy(): { toPromise(): Promise<ArrayBuffer> };
    download?(): void;
  };
}

interface CommandsCapability {
  execute(commandId: string, documentId?: string, source?: 'keyboard' | 'ui' | 'api'): void;
  resolve?(commandId: string, documentId?: string): { disabled?: boolean; visible?: boolean };
}

interface UiSidebarCapability {
  forDocument(documentId: string): {
    openModal?(modalId: string, props?: Record<string, unknown>): void;
    toggleSidebar?(placement: 'left' | 'right', slot: string, sidebarId: string): void;
    openSidebarSlot?(placement: 'left' | 'right', slot: string, sidebarId?: string): void;
    closeSidebarSlot?(placement: 'left' | 'right', slot: string): void;
    isSidebarOpen?(placement: 'left' | 'right', slot: string): boolean;
    setActiveSidebar?(placement: 'left' | 'right', slot: string, sidebarId: string): void;
  };
}

interface UiModalCapability {
  openModal(modalId: string, props?: Record<string, unknown>, documentId?: string): void;
}

interface ShnctlToolbarProps {
  registry?: PluginRegistry;
  container: PDFViewerRef['container'];
  searchOpen: boolean;
  thumbnailsOpen: boolean;
  signaturesOpen: boolean;
  colorPaletteOpen: boolean;
  themeIndexRef: React.MutableRefObject<number>;
  onSearchOpenChange(open: boolean): void;
  onToggleThumbnails(): void;
  onOpenSignatures(): void;
  onToggleColorPalette(): void;
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

const MODE_LABELS: Record<ToolbarMode, string> = {
  view: 'View',
  page: 'Page',
  search: 'Search',
  draw: 'Draw',
};

const DRAW_TOOLS = [
  { id: 'highlight', label: 'Highlight', icon: Highlighter },
  { id: 'underline', label: 'Underline', icon: Underline },
  { id: 'strikeout', label: 'Strikeout', icon: Strikethrough },
  { id: 'square', label: 'Rectangle', icon: Square },
  { id: 'textComment', label: 'Comment', icon: MessageSquareMore },
  { id: 'freeText', label: 'Text', icon: Type },
];

const ZOOM_OPTIONS: Array<{ label: string; value: ZoomLevel }> = [
  { label: 'Fit page', value: 'fit-page' },
  { label: 'Fit width', value: 'fit-width' },
  { label: '50%', value: 0.5 },
  { label: '75%', value: 0.75 },
  { label: '100%', value: 1 },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.5 },
  { label: '200%', value: 2 },
];

function ToolbarButton({ label, icon: Icon, active, disabled, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={`shnctl-toolbar-button${active ? ' is-active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      data-shnctl-tooltip={label}
    >
      <Icon size={14} strokeWidth={2} />
    </button>
  );
}

function getDocumentScope<T>(registry: PluginRegistry | undefined, pluginId: string): { documentId: string; capability: T } | null {
  const documentId = registry ? getActiveDocumentId(registry) : undefined;
  const capability = registry?.getPlugin(pluginId)?.provides?.() as T | undefined;

  return documentId && capability ? { documentId, capability } : null;
}

function useRegistryTick(registry?: PluginRegistry) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!registry) {
      return;
    }

    const store = registry.getStore();
    return store.subscribe(() => setTick((tick) => tick + 1));
  }, [registry]);
}

function useToolbarState(registry: PluginRegistry | undefined, searchOpen: boolean) {
  useRegistryTick(registry);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>(1);
  const [panMode, setPanMode] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [spreadMode, setSpreadMode] = useState<SpreadModeValue>('none');
  const [scrollStrategy, setScrollStrategy] = useState<ScrollStrategyValue>('vertical');

  useEffect(() => {
    const scopeInfo = getDocumentScope<ZoomCapability>(registry, 'zoom');
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
  }, [registry]);

  useEffect(() => {
    const scopeInfo = getDocumentScope<PanCapability>(registry, 'pan');
    if (!scopeInfo) {
      return;
    }

    const panScope = scopeInfo.capability.forDocument(scopeInfo.documentId);
    setPanMode(panScope.isPanMode());
    return panScope.onPanModeChange(setPanMode);
  }, [registry]);

  useEffect(() => {
    const scopeInfo = getDocumentScope<AnnotationCapability>(registry, 'annotation');
    if (!scopeInfo) {
      return;
    }

    const annotationScope = scopeInfo.capability.forDocument(scopeInfo.documentId);
    setActiveTool(annotationScope.getActiveTool()?.id ?? null);
    return annotationScope.onActiveToolChange((tool) => setActiveTool(tool?.id ?? null));
  }, [registry]);

  useEffect(() => {
    const spread = registry?.getPlugin('spread')?.provides?.() as SpreadCapability | undefined;
    if (!spread) {
      return;
    }

    setSpreadMode(spread.getSpreadMode());
    return spread.onSpreadChange((event) => setSpreadMode(event.spreadMode));
  }, [registry]);

  useEffect(() => {
    const scroll = registry?.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
    if (!registry || !scroll) {
      return;
    }

    try {
      const documentId = getActiveDocumentId(registry);
      if (!documentId) {
        setScrollStrategy('vertical');
        return;
      }
      const state = registry.getStore().getState() as {
        plugins?: { scroll?: { documents?: Record<string, { strategy?: ScrollStrategyValue }> } };
      };
      setScrollStrategy(state.plugins?.scroll?.documents?.[documentId]?.strategy ?? 'vertical');
    } catch {
      setScrollStrategy('vertical');
    }

    return scroll.onStateChange((state) => setScrollStrategy(state.strategy ?? 'vertical'));
  }, [registry]);

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
  restoreScrollAnchorAfterLayout(registry, anchor);
}

export function ShnctlToolbar({
  registry,
  container,
  searchOpen,
  thumbnailsOpen,
  signaturesOpen,
  colorPaletteOpen,
  themeIndexRef,
  onSearchOpenChange,
  onToggleThumbnails,
  onOpenSignatures,
  onToggleColorPalette,
}: ShnctlToolbarProps) {
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [documentMenuOpen, setDocumentMenuOpen] = useState(false);
  const [selectedMode, setSelectedMode] = useState<ToolbarMode>('view');
  const [pinned, setPinned] = useState(() => getStoredToolbarPinned());
  const [tooltip, setTooltip] = useState<ToolbarTooltip | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarHideTimerRef = useRef<number | undefined>(undefined);
  const tooltipTimerRef = useRef<number | undefined>(undefined);
  const { zoomPercent, zoomLevel, panMode, activeTool, spreadMode, scrollStrategy } = useToolbarState(registry, searchOpen);
  const mode: ToolbarMode = searchOpen ? 'search' : selectedMode;
  const canUseRegistry = Boolean(registry && getActiveDocumentId(registry));

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
    if (activeTool && !searchOpen) {
      setSelectedMode('draw');
    }
  }, [activeTool, searchOpen]);

  const closeSearch = () => onSearchOpenChange(false);
  const setMode = (nextMode: ToolbarMode) => {
    setModeMenuOpen(false);
    setDocumentMenuOpen(false);
    setSelectedMode(nextMode);

    const annotation = getDocumentScope<AnnotationCapability>(registry, 'annotation');
    if (nextMode !== 'draw') {
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
    applyViewerThemeByIndex(container, themeIndexRef.current);
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

  const executeDocumentCommand = (commandId: 'document:print' | 'document:protect' | 'document:export') => {
    setDocumentMenuOpen(false);
    const documentId = registry ? getActiveDocumentId(registry) : undefined;
    const commands = registry?.getPlugin('commands')?.provides?.() as CommandsCapability | undefined;

    if (commands && documentId) {
      try {
        const command = commands.resolve?.(commandId, documentId);
        if (command?.visible !== false && !command?.disabled) {
          commands.execute(commandId, documentId, 'ui');
          return true;
        }
      } catch (error) {
        console.warn(`[shnctl] failed to execute ${commandId}`, error);
      }
    }

    return false;
  };

  const openNativeModal = (modalId: 'print-modal' | 'protect-modal' | 'view-permissions-modal') => {
    const documentId = registry ? getActiveDocumentId(registry) : undefined;
    const ui = registry?.getPlugin('ui')?.provides?.() as UiModalCapability | undefined;
    if (!ui || !documentId) {
      return false;
    }

    ui.openModal(modalId, undefined, documentId);
    return true;
  };

  const printDocument = () => {
    if (!executeDocumentCommand('document:print')) {
      openNativeModal('print-modal');
    }
  };

  const openSecurityDialog = () => {
    if (!executeDocumentCommand('document:protect')) {
      openNativeModal('protect-modal') || openNativeModal('view-permissions-modal');
    }
  };

  const exportDocument = async () => {
    if (executeDocumentCommand('document:export')) {
      return;
    }

    const exportCapability = registry?.getPlugin('export')?.provides?.() as ExportCapability | undefined;
    if (!exportCapability) {
      return;
    }

    const documentId = registry ? getActiveDocumentId(registry) : undefined;
    const exportScope = documentId ? exportCapability.forDocument?.(documentId) : undefined;
    if (exportScope?.download || exportCapability.download) {
      (exportScope?.download ?? exportCapability.download)?.();
      return;
    }

    try {
      const arrayBuffer = await (exportScope ?? exportCapability).saveAsCopy().toPromise();
      const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${document.title?.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'document'}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.warn('[shnctl] failed to export PDF', error);
    }
  };

  const toggleCommentSidebar = () => {
    const scopeInfo = getDocumentScope<UiSidebarCapability>(registry, 'ui');
    if (!scopeInfo) {
      return;
    }

    const sidebar = scopeInfo.capability.forDocument(scopeInfo.documentId);
    if (sidebar.isSidebarOpen?.('right', 'main')) {
      sidebar.closeSidebarSlot?.('right', 'main');
      return;
    }

    sidebar.openSidebarSlot?.('right', 'main', 'comment-panel');
    sidebar.setActiveSidebar?.('right', 'main', 'comment-panel');
  };

  const openSignaturePanel = () => {
    setDocumentMenuOpen(false);
    setModeMenuOpen(false);
    closeSearch();
    onOpenSignatures();
  };

  const toggleThumbnailsPanel = () => {
    setDocumentMenuOpen(false);
    setModeMenuOpen(false);
    closeSearch();
    onToggleThumbnails();
  };

  const runAnnotationHistory = (direction: 'undo' | 'redo') => {
    const scopeInfo = getDocumentScope<AnnotationCapability>(registry, 'annotation');
    if (!scopeInfo) {
      return;
    }

    const annotationScope = scopeInfo.capability.forDocument(scopeInfo.documentId);
    if (direction === 'undo') {
      annotationScope.undo?.();
      scopeInfo.capability.undo?.(scopeInfo.documentId);
    } else {
      annotationScope.redo?.();
      scopeInfo.capability.redo?.(scopeInfo.documentId);
    }
  };

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
              className="shnctl-toolbar-button shnctl-document-menu-button"
              onClick={() => {
                setModeMenuOpen(false);
                setDocumentMenuOpen((open) => !open);
              }}
              aria-label="Document menu"
              aria-haspopup="menu"
              aria-expanded={documentMenuOpen}
              data-shnctl-tooltip="Document menu"
            >
              <Menu size={14} strokeWidth={2} />
            </button>
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
                <button type="button" role="menuitem" onClick={openSecurityDialog} disabled={!canUseRegistry}>
                  <ShieldCheck size={14} strokeWidth={2} />
                  <span>Security</span>
                </button>
                <button type="button" role="menuitem" className={signaturesOpen ? 'is-active' : ''} onClick={openSignaturePanel} disabled={!canUseRegistry}>
                  <Signature size={14} strokeWidth={2} />
                  <span>Signatures</span>
                </button>
                <button type="button" role="menuitem" onClick={() => void exportDocument()} disabled={!canUseRegistry}>
                  <Download size={14} strokeWidth={2} />
                  <span>Export</span>
                </button>
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
              <span>{MODE_LABELS[mode]}</span>
            </button>
            {modeMenuOpen ? (
              <div className="shnctl-toolbar-menu" role="menu" onMouseLeave={() => setModeMenuOpen(false)}>
                {(['view', 'page', 'search', 'draw'] as ToolbarMode[]).map((item) => (
                  <button key={item} type="button" role="menuitem" className={mode === item ? 'is-active' : ''} onClick={() => setMode(item)}>
                    {MODE_LABELS[item]}
                  </button>
                ))}
              </div>
            ) : null}
            {(['view', 'page', 'search', 'draw'] as ToolbarMode[]).map((item) => (
              <button
                key={item}
                type="button"
                className={`shnctl-toolbar-tab${mode === item ? ' is-active' : ''}`}
                onClick={() => setMode(item)}
                data-shnctl-tooltip={MODE_LABELS[item]}
              >
                {MODE_LABELS[item]}
              </button>
            ))}
          </div>
        </div>

        <div className="shnctl-toolbar-zone shnctl-toolbar-zone-right">
          <div className="shnctl-toolbar-group">
            <ToolbarButton label="Switch theme" icon={Palette} onClick={cycleTheme} disabled={!registry} />
            <ToolbarButton label="Pan" icon={Hand} active={panMode} onClick={togglePan} disabled={!canUseRegistry} />
            <ToolbarButton label="Comment sidebar" icon={PanelRight} onClick={toggleCommentSidebar} disabled={!canUseRegistry} />
            <ToolbarButton label="Pin toolbar" icon={Pin} active={pinned} onClick={togglePinned} />
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
            <ToolbarButton label={spreadMode === 'odd' ? 'Single page' : 'Two page'} icon={GalleryHorizontal} active={spreadMode === 'odd'} onClick={() => setSpread(spreadMode === 'odd' ? 'none' : 'odd')} disabled={!canUseRegistry} />
            <ToolbarButton label="Vertical scroll" icon={ArrowDownUp} active={scrollStrategy === 'vertical'} onClick={() => setScroll('vertical')} disabled={!canUseRegistry} />
            <ToolbarButton label="Horizontal scroll" icon={ArrowLeftRight} active={scrollStrategy === 'horizontal'} onClick={() => setScroll('horizontal')} disabled={!canUseRegistry} />
            <ToolbarButton label="Rotate" icon={RotateCw} onClick={rotateForward} disabled={!canUseRegistry} />
          </div>
        </div>
      ) : null}

      {mode === 'search' ? <ShnctlSearch registry={registry} open /> : null}

      {mode === 'draw' ? (
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
