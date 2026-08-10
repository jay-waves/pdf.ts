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
  BookText,
  Download,
  GalleryHorizontal,
  Hand,
  Highlighter,
  Info,
  LayoutTemplate,
  LineSquiggle,
  MessageSquareMore,
  Minus,
  MoveUpRight,
  Moon,
  Palette,
  PaintBucket,
  PenLine,
  Pin,
  Plus,
  Printer,
  Redo2,
  RotateCw,
  Save,
  ShieldCheck,
  Signature,
  Square,
  Strikethrough,
  Sun,
  TextSearch,
  Type,
  Underline,
  Undo2,
} from 'lucide-react';
import { getAnnotationScope } from './annotations';
import { getCurrentScrollAnchor, restoreScrollAnchor } from './page-navigation';
import {
  getActiveDocumentId,
  getDocumentCapability,
  getDocumentScrollStrategy,
  getPluginCapability,
  isEditableTarget,
  type ScrollCapability,
} from './utils';
import {
  getStoredToolbarPinned,
  isDarkViewerTheme,
  setStoredToolbarPinned,
  supportsViewerThemeSettings,
  toggleViewerColorMode,
  useViewerTheme,
} from './theme';
import type { PdfSearch } from './pdf-search';
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

type ToolbarSection = 'document' | 'page' | 'search' | 'draw';
const TOOLBAR_HIDE_DELAY_MS = 900;

interface ToolbarState {
  documentId?: string | null;
  searchOpen: boolean;
  thumbnailsOpen: boolean;
  colorPaletteOpen: boolean;
  panMode: boolean;
  signatureCount: number;
}

interface ToolbarActions {
  setPanMode(enabled: boolean): void;
  setSearchOpen(open: boolean): void;
  toggleThumbnails(): void;
  toggleColorPalette(): void;
  openPrint(): void;
  openProtect(): void;
  openMetadata(): void;
  openTheme(): void;
  openSignatures(): void;
  exportDocument(): void;
  saveDocument(): void;
}

interface ToolbarProps {
  registry?: PluginRegistry;
  search: PdfSearch;
  state: ToolbarState;
  actions: ToolbarActions;
}

interface ToolbarButtonProps {
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  active?: boolean;
  disabled?: boolean;
  iconSize?: number;
  onClick(): void;
}

const PRIMARY_ITEMS: Array<{
  id: ToolbarSection;
  label: string;
  icon: ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;
}> = [
  { id: 'document', label: 'Docs', icon: BookText },
  { id: 'page', label: 'Page', icon: LayoutTemplate },
  { id: 'draw', label: 'Draw', icon: PenLine },
  { id: 'search', label: 'Find', icon: TextSearch },
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

function ToolbarButton({
  label,
  icon: Icon,
  active,
  disabled,
  iconSize,
  onClick,
}: ToolbarButtonProps) {
  return (
    <IconButton
      className={styles.iconButton}
      label={label}
      icon={Icon}
      active={active}
      disabled={disabled}
      iconSize={iconSize}
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

function switchLayoutPreservingAnchor(
  registry: PluginRegistry | undefined,
  updateLayout: (documentId: string) => void,
) {
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
  search,
  state: {
    documentId,
    searchOpen,
    thumbnailsOpen,
    colorPaletteOpen,
    panMode,
    signatureCount,
  },
  actions: {
    setPanMode,
    setSearchOpen,
    toggleThumbnails,
    toggleColorPalette,
    openPrint,
    openProtect,
    openMetadata,
    openTheme,
    openSignatures,
    exportDocument,
    saveDocument,
  },
}: ToolbarProps) {
  const [activeSection, setActiveSection] = useState<ToolbarSection | null>(null);
  const [pinned, setPinned] = useState(() => getStoredToolbarPinned());
  const viewerTheme = useViewerTheme();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarHideTimerRef = useRef<number | undefined>(undefined);
  const {
    zoomPercent,
    zoomLevel,
    activeTool,
    spreadMode,
    scrollStrategy,
  } = useToolbarState(registry, documentId);
  const canUseRegistry = Boolean(registry && documentId);
  const canConfigureTheme = supportsViewerThemeSettings();
  const darkAppearance = isDarkViewerTheme(viewerTheme);

  const clearToolbarHideTimer = () => {
    if (toolbarHideTimerRef.current !== undefined) {
      window.clearTimeout(toolbarHideTimerRef.current);
      toolbarHideTimerRef.current = undefined;
    }
  };

  const showToolbar = () => {
    clearToolbarHideTimer();
    if (toolbarRef.current?.getAttribute('data-visible') !== 'true') {
      toolbarRef.current?.setAttribute('data-visible', 'true');
    }
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

    if (toolbarHideTimerRef.current !== undefined) return;
    toolbarHideTimerRef.current = window.setTimeout(hideToolbar, TOOLBAR_HIDE_DELAY_MS);
  };

  useEffect(() => {
    if (activeTool && !searchOpen) {
      setPanMode(false);
      setActiveSection('draw');
    }
  }, [activeTool, searchOpen, setPanMode]);

  useEffect(() => {
    setActiveSection((current) => {
      if (searchOpen) return 'search';
      return current === 'search' ? null : current;
    });
  }, [searchOpen]);

  const closeSearch = () => setSearchOpen(false);
  const openSection = (section: ToolbarSection) => {
    setActiveSection(section);

    if (section !== 'draw' && section !== 'document') {
      getAnnotationScope(registry)?.scope.setActiveTool(null);
    }

    if (section === 'search') {
      setSearchOpen(true);
      return;
    }

    if (section !== 'document') closeSearch();
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
    setPanMode(nextPanMode);
  };

  const togglePinned = () => {
    const nextPinned = !pinned;
    setPinned(nextPinned);
    setStoredToolbarPinned(nextPinned);
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
    setPanMode(false);
    const scopeInfo = getAnnotationScope(registry);
    if (!scopeInfo) {
      return;
    }

    scopeInfo.scope.setActiveTool(activeTool === toolId ? null : toolId);
  };

  const selectZoom = (value: string) => {
    const level = ZOOM_LEVELS.get(value);
    const scopeInfo = getDocumentCapability<ZoomCapability>(registry, 'zoom');
    if (level === undefined || !scopeInfo) return;
    scopeInfo.capability.forDocument(scopeInfo.documentId).requestZoom(level);
  };

  const toggleSpread = () => {
    const spread = getPluginCapability<SpreadCapability>(registry, 'spread');
    if (!spread) return;
    const nextMode = spreadMode === SpreadMode.Odd ? SpreadMode.None : SpreadMode.Odd;
    switchLayoutPreservingAnchor(registry, () => spread.setSpreadMode(nextMode));
  };

  const rotateForward = () => {
    getPluginCapability<RotateCapability>(registry, 'rotate')?.rotateForward();
  };

  const setScroll = (nextStrategy: ScrollStrategy) => {
    const scroll = getPluginCapability<ScrollCapability>(registry, 'scroll');
    if (!scroll) {
      return;
    }

    switchLayoutPreservingAnchor(registry, (documentId) => scroll.setScrollStrategy(nextStrategy, documentId));
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
      let direction: 'undo' | 'redo' | null = null;
      if (key === 'y' || (key === 'z' && event.shiftKey)) {
        direction = 'redo';
      } else if (key === 'z') {
        direction = 'undo';
      }
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
      } else if (toolbarHideTimerRef.current === undefined
        && !toolbarRef.current?.matches(':hover, :focus-within')) {
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
        {canConfigureTheme ? (
          <ToolbarButton
            label={darkAppearance ? 'Light theme' : 'Dark theme'}
            icon={darkAppearance ? Sun : Moon}
            iconSize={15.5}
            onClick={toggleViewerColorMode}
          />
        ) : null}
        <ToolbarButton
          label="Pan"
          icon={Hand}
          active={panMode}
          disabled={!canUseRegistry}
          onClick={togglePan}
        />
        <ToolbarButton
          label="Pin toolbar"
          icon={Pin}
          active={pinned}
          onClick={togglePinned}
        />
      </FloatingToolbarGroup>
    </>
  );

  return (
    <div
      ref={toolbarRef}
      className={styles.root}
      data-visible={pinned ? 'true' : undefined}
      onMouseEnter={showToolbar}
      onMouseLeave={scheduleToolbarHide}
      onContextMenu={(event) => event.preventDefault()}
    >
      {activeSection === null ? (
        <FloatingToolbar label="PDF toolbar">
          <FloatingToolbarGroup>
            {PRIMARY_ITEMS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={styles.modeButton}
                onClick={() => openSection(id)}
                aria-label={label}
              >
                <Icon
                  className={`${styles.icon} ${id === 'search' ? styles.searchModeIcon : ''}`}
                  size={id === 'search' ? 16 : 14}
                  strokeWidth={2}
                />
                <span className={styles.modeLabel}>{label}</span>
              </button>
            ))}
          </FloatingToolbarGroup>
          {renderPersistentControls()}
        </FloatingToolbar>
      ) : null}

      {activeSection === 'document' ? (
        <FloatingToolbar label="Document toolbar">
          <ToolbarButton
            label="Back"
            icon={ArrowLeft}
            onClick={returnToPrimaryToolbar}
          />
          <FloatingToolbarDivider />
          <FloatingToolbarGroup>
            <ToolbarButton
              label="Print"
              icon={Printer}
              disabled={!canUseRegistry}
              onClick={openPrint}
            />
            <ToolbarButton
              label="Security"
              icon={ShieldCheck}
              disabled={!canUseRegistry}
              onClick={openProtect}
            />
            <ToolbarButton
              label="Export"
              icon={Download}
              disabled={!canUseRegistry}
              onClick={exportDocument}
            />
            <ToolbarButton
              label="Save"
              icon={Save}
              disabled={!canUseRegistry}
              onClick={saveDocument}
            />
            <ToolbarButton
              label="Metadata"
              icon={Info}
              disabled={!canUseRegistry}
              onClick={openMetadata}
            />
            {canConfigureTheme ? (
              <ToolbarButton
                label="Themes"
                icon={Palette}
                onClick={openTheme}
              />
            ) : null}
            {signatureCount > 0 ? (
              <Tooltip content={`Signatures (${signatureCount})`}>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={`Digital signatures (${signatureCount})`}
                  onClick={openSignatures}
                >
                  <Signature size={14} strokeWidth={2} />
                </button>
              </Tooltip>
            ) : null}
          </FloatingToolbarGroup>
          {renderPersistentControls()}
        </FloatingToolbar>
      ) : null}

      {activeSection === 'page' ? (
        <FloatingToolbar label="Page toolbar" overflow>
          <ToolbarButton
            label="Back"
            icon={ArrowLeft}
            onClick={returnToPrimaryToolbar}
          />
          <FloatingToolbarDivider />
          <FloatingToolbarGroup>
            <ToolbarButton
              label="Zoom out"
              icon={Minus}
              disabled={!canUseRegistry}
              onClick={() => zoomByButton(-1)}
            />
            <Select
              className={styles.zoomSelect}
              value={typeof zoomLevel === 'number' ? String(zoomLevel) : zoomLevel}
              displayValue={`${zoomPercent}%`}
              options={ZOOM_SELECT_OPTIONS}
              onValueChange={selectZoom}
              label="Zoom"
              disabled={!canUseRegistry}
            />
            <ToolbarButton
              label="Zoom in"
              icon={Plus}
              disabled={!canUseRegistry}
              onClick={() => zoomByButton(1)}
            />
          </FloatingToolbarGroup>
          <FloatingToolbarDivider />
          <FloatingToolbarGroup>
            <ToolbarButton
              label={spreadMode === SpreadMode.Odd ? 'Single page' : 'Two page'}
              icon={GalleryHorizontal}
              active={spreadMode === SpreadMode.Odd}
              disabled={!canUseRegistry}
              onClick={toggleSpread}
            />
            <ToolbarButton
              label="Vertical scroll"
              icon={ArrowDownUp}
              active={scrollStrategy === ScrollStrategy.Vertical}
              disabled={!canUseRegistry}
              onClick={() => setScroll(ScrollStrategy.Vertical)}
            />
            <ToolbarButton
              label="Horizontal scroll"
              icon={ArrowLeftRight}
              active={scrollStrategy === ScrollStrategy.Horizontal}
              disabled={!canUseRegistry}
              onClick={() => setScroll(ScrollStrategy.Horizontal)}
            />
            <ToolbarButton
              label="Rotate"
              icon={RotateCw}
              disabled={!canUseRegistry}
              onClick={rotateForward}
            />
            <ToolbarButton
              label="Thumbnails"
              icon={BookImage}
              active={thumbnailsOpen}
              disabled={!canUseRegistry}
              onClick={toggleThumbnails}
            />
          </FloatingToolbarGroup>
          {renderPersistentControls()}
        </FloatingToolbar>
      ) : null}

      {activeSection === 'search' ? (
        <FloatingToolbar label="Search toolbar" overflow>
          <ToolbarButton
            label="Back"
            icon={ArrowLeft}
            onClick={returnToPrimaryToolbar}
          />
          <FloatingToolbarDivider />
          <Search registry={registry} search={search} documentId={documentId} open />
          {renderPersistentControls()}
        </FloatingToolbar>
      ) : null}

      {activeSection === 'draw' ? (
        <FloatingToolbar label="Draw toolbar" overflow>
          <ToolbarButton
            label="Back"
            icon={ArrowLeft}
            onClick={returnToPrimaryToolbar}
          />
          <FloatingToolbarDivider />
          <div className={styles.drawTools}>
            {DRAW_TOOLS.map(({ id, label, icon }) => (
              <ToolbarButton
                key={id}
                label={label}
                icon={icon}
                active={activeTool === id}
                disabled={!canUseRegistry}
                onClick={() => selectDrawTool(id)}
              />
            ))}
            <FloatingToolbarDivider />
            <ToolbarButton
              label="Colors"
              icon={PaintBucket}
              active={colorPaletteOpen}
              disabled={!canUseRegistry}
              onClick={toggleColorPalette}
            />
            <ToolbarButton
              label="Undo"
              icon={Undo2}
              disabled={!canUseRegistry}
              onClick={() => runAnnotationHistory('undo')}
            />
            <ToolbarButton
              label="Redo"
              icon={Redo2}
              disabled={!canUseRegistry}
              onClick={() => runAnnotationHistory('redo')}
            />
          </div>
          {renderPersistentControls()}
        </FloatingToolbar>
      ) : null}
    </div>
  );
}
