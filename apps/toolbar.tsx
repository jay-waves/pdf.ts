import { useEffect, useRef, useState, type ComponentType } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import type { HistoryCapability } from '@embedpdf/plugin-history';
import type { RotateCapability } from '@embedpdf/plugin-rotate';
import { ScrollStrategy } from '@embedpdf/plugin-scroll';
import { SpreadMode, type SpreadCapability } from '@embedpdf/plugin-spread';
import { ZoomMode, type ZoomCapability, type ZoomLevel } from '@embedpdf/plugin-zoom';
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowLeftRight,
  BookImage,
  Download,
  GalleryHorizontal,
  Hand,
  Highlighter,
  Info,
  LineSquiggle,
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
  Save,
  Search as SearchIcon,
  ShieldCheck,
  Signature,
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
import styles from './toolbar.module.css';
import {
  FloatingToolbar,
  FloatingToolbarDivider,
  FloatingToolbarGroup,
  IconButton,
  Select,
  Tooltip,
} from './components';

type ToolbarMode = 'view' | 'page' | 'search' | 'draw';
type PersistentToolbarMode = Exclude<ToolbarMode, 'search'>;
type ToolbarSection = 'document' | ToolbarMode;
const TOOLBAR_HIDE_DELAY_MS = 900;
const PINNED_TOOLBAR_RESIZES_VIEWPORT = false;

interface ToolbarProps {
  registry?: PluginRegistry;
  activeDocumentId?: string | null;
  searchOpen: boolean;
  thumbnailsOpen: boolean;
  colorPaletteOpen: boolean;
  panMode: boolean;
  onPanModeChange(enabled: boolean): void;
  onSearchOpenChange(open: boolean): void;
  onToggleThumbnails(): void;
  onToggleColorPalette(): void;
  onOpenPrint(): void;
  onOpenProtect(): void;
  onOpenMetadata(): void;
  signatureCount: number;
  onOpenSignatures(): void;
  onExport(): void;
  onSave(): void;
  onPinnedInsetChange(inset: number): void;
}

interface ToolbarButtonProps {
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  active?: boolean;
  disabled?: boolean;
  onClick(): void;
}

const PRIMARY_ITEMS: Array<{
  id: ToolbarSection;
  label: string;
  icon: ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;
}> = [
  { id: 'document', label: 'DOCS', icon: Menu },
  { id: 'page', label: 'PAGE', icon: StickyNote },
  { id: 'search', label: 'SEARCH', icon: SearchIcon },
  { id: 'draw', label: 'DRAW', icon: PencilRuler },
];

const DRAW_TOOLS = [
  { id: 'highlight', label: 'Highlight', icon: Highlighter },
  { id: 'underline', label: 'Underline', icon: Underline },
  { id: 'strikeout', label: 'Strikeout', icon: Strikethrough },
  { id: 'square', label: 'Rectangle', icon: Square },
  { id: 'lineArrow', label: 'Arrow', icon: MoveUpRight },
  { id: 'ink', label: 'Ink', icon: LineSquiggle },
  { id: 'textComment', label: 'Comment', icon: MessageSquareMore },
  { id: 'freeText', label: 'Text', icon: Type },
];

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
      className={styles.iconButton}
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

  return { zoomPercent, zoomLevel, activeTool, spreadMode, scrollStrategy };
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
  colorPaletteOpen,
  panMode,
  onPanModeChange,
  onSearchOpenChange,
  onToggleThumbnails,
  onToggleColorPalette,
  onOpenPrint,
  onOpenProtect,
  onOpenMetadata,
  signatureCount,
  onOpenSignatures,
  onExport,
  onSave,
  onPinnedInsetChange,
}: ToolbarProps) {
  const [activeSection, setActiveSection] = useState<ToolbarSection | null>(null);
  const [selectedMode, setSelectedMode] = useState<PersistentToolbarMode>('view');
  const [pinned, setPinned] = useState(() => getStoredToolbarPinned());
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarHideTimerRef = useRef<number | undefined>(undefined);
  const { zoomPercent, zoomLevel, activeTool, spreadMode, scrollStrategy } = useToolbarState(registry, activeDocumentId);
  const mode: ToolbarMode = searchOpen ? 'search' : selectedMode;
  const canUseRegistry = Boolean(registry && activeDocumentId);

  useEffect(() => {
    if (!PINNED_TOOLBAR_RESIZES_VIEWPORT) {
      onPinnedInsetChange(0);
      return;
    }

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
      onPanModeChange(false);
      setSelectedMode('draw');
      setActiveSection('draw');
    }
  }, [activeTool, onPanModeChange, searchOpen]);

  useEffect(() => {
    setActiveSection((current) => (
      searchOpen ? 'search' : current === 'search' ? null : current
    ));
  }, [searchOpen]);

  const closeSearch = () => onSearchOpenChange(false);
  const setMode = (nextMode: ToolbarMode) => {
    setActiveSection(nextMode);

    if (nextMode !== 'draw') {
      getAnnotationScope(registry)?.scope.setActiveTool(null);
    }

    if (nextMode === 'search') {
      onSearchOpenChange(true);
      return;
    }

    setSelectedMode(nextMode);
    closeSearch();
  };

  const openSection = (section: ToolbarSection) => {
    if (section === 'document') {
      setActiveSection('document');
      return;
    }
    setMode(section);
  };

  const returnToPrimaryToolbar = () => {
    setActiveSection(null);
    if (searchOpen) closeSearch();
  };

  const togglePan = () => {
    const nextPanMode = !panMode;
    if (nextPanMode) {
      getAnnotationScope(registry)?.scope.setActiveTool(null);
    }
    onPanModeChange(nextPanMode);
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
    onPanModeChange(false);
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

  const openMetadataDialog = () => {
    closeSearch();
    onOpenMetadata();
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
  }, [pinned]);

  const renderPersistentControls = () => (
    <>
      <FloatingToolbarDivider />
      <FloatingToolbarGroup>
        <ToolbarButton label="Switch theme" icon={Palette} onClick={cycleViewerTheme} />
        <ToolbarButton label="Pan" icon={Hand} active={panMode} onClick={togglePan} disabled={!canUseRegistry} />
        <ToolbarButton label="Pin toolbar" icon={Pin} active={pinned} onClick={togglePinned} />
        {signatureCount > 0 ? (
          <Tooltip content={`Digitally signed document · ${signatureCount} signature${signatureCount === 1 ? '' : 's'}`}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={`Digital signatures (${signatureCount})`}
              onClick={onOpenSignatures}
            >
              <Signature size={14} strokeWidth={2} />
            </button>
          </Tooltip>
        ) : null}
      </FloatingToolbarGroup>
    </>
  );

  return (
    <div
      ref={toolbarRef}
      className={styles.root}
      data-pinned={pinned ? 'true' : undefined}
      data-visible={pinned ? 'true' : undefined}
      onMouseEnter={showToolbar}
      onMouseLeave={scheduleToolbarHide}
      onContextMenu={(event) => event.preventDefault()}
    >
      {activeSection === null ? (
        <FloatingToolbar label="PDF toolbar">
          <div className={styles.modeCluster}>
            {PRIMARY_ITEMS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={styles.modeButton}
                onClick={() => openSection(id)}
                aria-pressed={id === 'document' ? undefined : mode === id}
                aria-label={label}
              >
                <Icon className={styles.icon} size={14} strokeWidth={2} />
                <span className={styles.modeLabel}>{label}</span>
              </button>
            ))}
          </div>
          {renderPersistentControls()}
        </FloatingToolbar>
      ) : null}

      {activeSection === 'document' ? (
        <FloatingToolbar label="Document toolbar">
          <ToolbarButton label="Back" icon={ArrowLeft} onClick={returnToPrimaryToolbar} />
          <FloatingToolbarDivider />
          <FloatingToolbarGroup>
            <ToolbarButton label="Print" icon={Printer} onClick={printDocument} disabled={!canUseRegistry} />
            <ToolbarButton label="Security" icon={ShieldCheck} onClick={openSecurityDialog} disabled={!canUseRegistry} />
            <ToolbarButton label="Export" icon={Download} onClick={onExport} disabled={!canUseRegistry} />
            <ToolbarButton label="Save" icon={Save} onClick={onSave} disabled={!canUseRegistry} />
            <ToolbarButton label="Metadata" icon={Info} onClick={openMetadataDialog} disabled={!canUseRegistry} />
          </FloatingToolbarGroup>
          {renderPersistentControls()}
        </FloatingToolbar>
      ) : null}

      {activeSection === 'page' ? (
        <FloatingToolbar label="Page toolbar" overflow>
          <ToolbarButton label="Back" icon={ArrowLeft} onClick={returnToPrimaryToolbar} />
          <FloatingToolbarDivider />
          <FloatingToolbarGroup>
            <ToolbarButton label="Zoom out" icon={Minus} onClick={() => zoomByButton(-1)} disabled={!canUseRegistry} />
            <Select
              className={styles.zoomSelect}
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
          </FloatingToolbarGroup>
          <FloatingToolbarDivider />
          <FloatingToolbarGroup>
            <ToolbarButton label={spreadMode === SpreadMode.Odd ? 'Single page' : 'Two page'} icon={GalleryHorizontal} active={spreadMode === SpreadMode.Odd} onClick={() => setSpread(spreadMode === SpreadMode.Odd ? SpreadMode.None : SpreadMode.Odd)} disabled={!canUseRegistry} />
            <ToolbarButton label="Vertical scroll" icon={ArrowDownUp} active={scrollStrategy === ScrollStrategy.Vertical} onClick={() => setScroll(ScrollStrategy.Vertical)} disabled={!canUseRegistry} />
            <ToolbarButton label="Horizontal scroll" icon={ArrowLeftRight} active={scrollStrategy === ScrollStrategy.Horizontal} onClick={() => setScroll(ScrollStrategy.Horizontal)} disabled={!canUseRegistry} />
            <ToolbarButton label="Rotate" icon={RotateCw} onClick={rotateForward} disabled={!canUseRegistry} />
            <ToolbarButton label="Thumbnails" icon={BookImage} active={thumbnailsOpen} onClick={toggleThumbnailsPanel} disabled={!canUseRegistry} />
          </FloatingToolbarGroup>
          {renderPersistentControls()}
        </FloatingToolbar>
      ) : null}

      {activeSection === 'search' ? (
        <FloatingToolbar label="Search toolbar" overflow>
          <ToolbarButton label="Back" icon={ArrowLeft} onClick={returnToPrimaryToolbar} />
          <FloatingToolbarDivider />
          <Search registry={registry} open />
          {renderPersistentControls()}
        </FloatingToolbar>
      ) : null}

      {activeSection === 'draw' ? (
        <FloatingToolbar label="Draw toolbar" overflow>
          <ToolbarButton label="Back" icon={ArrowLeft} onClick={returnToPrimaryToolbar} />
          <FloatingToolbarDivider />
          <div className={styles.drawTools}>
            {DRAW_TOOLS.map(({ id, label, icon }) => (
              <ToolbarButton key={id} label={label} icon={icon} active={activeTool === id} onClick={() => selectDrawTool(id)} disabled={!canUseRegistry} />
            ))}
            <FloatingToolbarDivider />
            <ToolbarButton label="Colors" icon={PaintBucket} active={colorPaletteOpen} onClick={onToggleColorPalette} disabled={!canUseRegistry} />
            <ToolbarButton label="Undo" icon={Undo2} onClick={() => runAnnotationHistory('undo')} disabled={!canUseRegistry} />
            <ToolbarButton label="Redo" icon={Redo2} onClick={() => runAnnotationHistory('redo')} disabled={!canUseRegistry} />
          </div>
          {renderPersistentControls()}
        </FloatingToolbar>
      ) : null}
    </div>
  );
}
