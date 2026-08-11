import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
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
  Lock,
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
  Signature,
  Square,
  Strikethrough,
  Sun,
  TextSearch,
  Type,
  Underline,
  Undo2,
  Wrench,
} from 'lucide-react';
import { getAnnotationScope } from './annotations';
import type { PdfScroll } from './pdf-scroll';
import {
  getDocumentScope,
  getPluginCapability,
  isEditableTarget,
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
import { usesTouchControls } from './viewer-diagnostics';
import { useAutoHide } from './components/use-auto-hide';
import styles from './toolbar.module.css';
import {
  FloatingToolbar,
  FloatingToolbarDivider,
  FloatingToolbarGroup,
  IconButton,
  PortalProvider,
  Select,
} from './components';

type ToolbarSection = 'document' | 'page' | 'search' | 'draw';

interface ToolbarState {
  documentId?: string | null;
  searchOpen: boolean;
  thumbnailsOpen: boolean;
  colorPaletteOpen: boolean;
  panMode: boolean;
  signatureCount: number;
  canSave: boolean;
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
  openDeveloper(): void;
  openSignatures(): void;
  exportDocument(): void;
  saveDocument(): void;
}

interface ToolbarProps {
  registry?: PluginRegistry;
  search: PdfSearch;
  scroll?: PdfScroll | null;
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

function ZoomControl({
  disabled,
  zoomLevel,
  zoomPercent,
  onPresetChange,
  onPercentChange,
}: {
  disabled: boolean;
  zoomLevel: ZoomLevel;
  zoomPercent: number;
  onPresetChange(value: string): void;
  onPercentChange(value: number): void;
}) {
  const [draft, setDraft] = useState(`${zoomPercent}%`);
  const [editing, setEditing] = useState(false);
  const cancelBlurRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(`${zoomPercent}%`);
  }, [editing, zoomPercent]);

  const commit = () => {
    setEditing(false);
    if (cancelBlurRef.current) {
      cancelBlurRef.current = false;
      setDraft(`${zoomPercent}%`);
      return;
    }
    const percent = Number(draft.trim().replace(/%$/, ''));
    if (!Number.isFinite(percent) || percent <= 0) {
      setDraft(`${zoomPercent}%`);
      return;
    }
    onPercentChange(percent);
  };

  return (
    <div className={styles.zoomControl}>
      <input
        className={styles.zoomInput}
        aria-label="Zoom percentage"
        disabled={disabled}
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onFocus={(event) => {
          setEditing(true);
          event.currentTarget.select();
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            cancelBlurRef.current = true;
            event.currentTarget.blur();
          }
        }}
      />
      <Select
        className={styles.zoomMenu}
        value={String(zoomLevel)}
        options={ZOOM_SELECT_OPTIONS}
        onValueChange={onPresetChange}
        label="Zoom presets"
        disabled={disabled}
        iconOnly
        sideOffset={7}
      />
    </div>
  );
}

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
      label={label}
      icon={Icon}
      active={active}
      disabled={disabled}
      iconSize={iconSize}
      onClick={onClick}
    />
  );
}

function useToolbarState(
  registry: PluginRegistry | undefined,
  documentId: string | null | undefined,
  scroll: PdfScroll | null | undefined,
) {
  const [zoomPercent, setZoomPercent] = useState(100);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>(1);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [spreadMode, setSpreadMode] = useState(SpreadMode.None);
  const [scrollStrategy, setScrollStrategy] = useState(ScrollStrategy.Vertical);

  useEffect(() => {
    const zoomScope = getDocumentScope<ZoomCapability>(registry, 'zoom', documentId);
    if (!zoomScope) {
      return;
    }

    const syncZoom = (state = zoomScope.getState()) => {
      setZoomPercent(Math.round((state.currentZoomLevel ?? 1) * 100));
      setZoomLevel(state.zoomLevel);
    };

    syncZoom();
    return zoomScope.onStateChange(syncZoom);
  }, [documentId, registry]);

  useEffect(() => {
    const annotation = getAnnotationScope(registry, documentId);
    if (!annotation) {
      return;
    }

    setActiveTool(annotation.scope.getActiveTool()?.id ?? null);
    return annotation.scope.onActiveToolChange((tool) => setActiveTool(tool?.id ?? null));
  }, [documentId, registry]);

  useEffect(() => {
    const spread = getPluginCapability<SpreadCapability>(registry, 'spread');
    if (!spread || !documentId) {
      return;
    }

    const spreadScope = spread.forDocument(documentId);
    setSpreadMode(spreadScope.getSpreadMode());
    return spreadScope.onSpreadChange(setSpreadMode);
  }, [documentId, registry]);

  useEffect(() => {
    if (!scroll) return;
    setScrollStrategy(scroll.getStrategy());
    return scroll.onStrategyChange(setScrollStrategy);
  }, [scroll]);

  return { zoomPercent, zoomLevel, activeTool, spreadMode, scrollStrategy };
}

export function Toolbar({
  registry,
  search,
  scroll,
  state: {
    documentId,
    searchOpen,
    thumbnailsOpen,
    colorPaletteOpen,
    panMode,
    signatureCount,
    canSave,
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
    openDeveloper,
    openSignatures,
    exportDocument,
    saveDocument,
  },
}: ToolbarProps) {
  const [activeSection, setActiveSection] = useState<ToolbarSection | null>(null);
  const [pinned, setPinned] = useState(() => getStoredToolbarPinned());
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const searchWasOpenRef = useRef(false);
  const viewerTheme = useViewerTheme();
  const {
    zoomPercent,
    zoomLevel,
    activeTool,
    spreadMode,
    scrollStrategy,
  } = useToolbarState(registry, documentId, scroll);
  const canUseDocument = Boolean(registry && documentId);
  const canConfigureTheme = supportsViewerThemeSettings();
  const darkAppearance = isDarkViewerTheme(viewerTheme);
  const {
    visible: toolbarVisible,
    reveal: showToolbar,
    scheduleHide: scheduleToolbarHide,
  } = useAutoHide(
    () => !pinned && !portalContainer?.matches(':hover, :focus-within'),
  );

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

  useEffect(() => {
    const searchWasOpen = searchWasOpenRef.current;
    if (!searchOpen && searchWasOpen && pinned) {
      setPinned(false);
      setStoredToolbarPinned(false);
    }
    searchWasOpenRef.current = searchOpen;
  }, [pinned, searchOpen]);

  useEffect(() => {
    if (searchOpen) showToolbar();
    else scheduleToolbarHide();
  }, [searchOpen]);

  useEffect(() => {
    if (!pinned) scheduleToolbarHide();
  }, [pinned, scheduleToolbarHide]);

  const closeSearch = () => setSearchOpen(false);
  const openSection = (section: ToolbarSection) => {
    setActiveSection(section);

    if (section !== 'draw' && section !== 'document') {
      getAnnotationScope(registry, documentId)?.scope.setActiveTool(null);
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
      getAnnotationScope(registry, documentId)?.scope.setActiveTool(null);
    }
    setPanMode(nextPanMode);
  };

  const togglePinned = () => {
    const nextPinned = !pinned;
    setPinned(nextPinned);
    setStoredToolbarPinned(nextPinned);
  };

  const pinForSearch = () => {
    if (pinned) return;
    setPinned(true);
    setStoredToolbarPinned(true);
  };

  const zoomByButton = (direction: 1 | -1) => {
    const zoomScope = getDocumentScope<ZoomCapability>(registry, 'zoom', documentId);
    if (!zoomScope) {
      return;
    }

    if (direction > 0) {
      zoomScope.zoomIn();
    } else {
      zoomScope.zoomOut();
    }
  };

  const selectDrawTool = (toolId: string) => {
    closeSearch();
    setPanMode(false);
    const annotation = getAnnotationScope(registry, documentId);
    if (!annotation) {
      return;
    }

    annotation.scope.setActiveTool(activeTool === toolId ? null : toolId);
  };

  const selectZoom = (value: string) => {
    const level = ZOOM_LEVELS.get(value);
    const zoomScope = getDocumentScope<ZoomCapability>(registry, 'zoom', documentId);
    if (level === undefined || !zoomScope) return;
    zoomScope.requestZoom(level);
  };

  const enterZoom = (percent: number) => {
    getDocumentScope<ZoomCapability>(registry, 'zoom', documentId)?.requestZoom(percent / 100);
  };

  const toggleSpread = () => {
    const spread = getPluginCapability<SpreadCapability>(registry, 'spread');
    if (!spread) return;
    const nextMode = spreadMode === SpreadMode.Odd ? SpreadMode.None : SpreadMode.Odd;
    if (scroll) scroll.preserveView(() => spread.setSpreadMode(nextMode));
    else spread.setSpreadMode(nextMode);
  };

  const rotateForward = () => {
    getPluginCapability<RotateCapability>(registry, 'rotate')?.rotateForward();
  };

  const setScroll = (nextStrategy: ScrollStrategy) => {
    scroll?.setStrategy(nextStrategy);
  };

  const runAnnotationHistory = (direction: 'undo' | 'redo') => {
    const historyScope = getDocumentScope<HistoryCapability>(registry, 'history', documentId);
    if (!historyScope) {
      return;
    }

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
      if (usesTouchControls()) return;
      if (pinned || event.clientY <= 40) {
        showToolbar();
      } else if (!portalContainer?.matches(':hover, :focus-within')) {
        scheduleToolbarHide();
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, [pinned, portalContainer]);

  useEffect(() => scroll?.onInteraction((source) => {
    if (source === 'touch' && !usesTouchControls()) return;
    showToolbar();
    scheduleToolbarHide();
  }), [pinned, portalContainer, scroll]);

  const renderPersistentControls = () => (
    <div className={styles.persistentControls}>
      <FloatingToolbarDivider />
      <FloatingToolbarGroup>
        <ToolbarButton
          label="Save"
          icon={Save}
          disabled={!canSave}
          onClick={saveDocument}
        />
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
          disabled={!canUseDocument}
          onClick={togglePan}
        />
        <ToolbarButton
          label="Pin toolbar"
          icon={Pin}
          active={pinned}
          onClick={togglePinned}
        />
      </FloatingToolbarGroup>
    </div>
  );

  const renderSection = (label: string, children: ReactNode, overflow = false) => (
    <FloatingToolbar label={label} overflow={overflow}>
      <ToolbarButton label="Back" icon={ArrowLeft} onClick={returnToPrimaryToolbar} />
      <FloatingToolbarDivider />
      {children}
      {renderPersistentControls()}
    </FloatingToolbar>
  );

  return (
    <div
      ref={setPortalContainer}
      className={styles.root}
      data-toolbar-level={activeSection === null ? 'primary' : 'secondary'}
      data-visible={pinned || toolbarVisible ? 'true' : undefined}
      onMouseEnter={showToolbar}
      onMouseLeave={scheduleToolbarHide}
      onContextMenu={(event) => event.preventDefault()}
    >
      <PortalProvider container={portalContainer}>
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

        {activeSection === 'document' ? renderSection('Document toolbar', (
          <FloatingToolbarGroup>
            <ToolbarButton
              label="Print"
              icon={Printer}
              disabled={!canUseDocument}
              onClick={openPrint}
            />
            <ToolbarButton
              label="Security"
              icon={Lock}
              disabled={!canUseDocument}
              onClick={openProtect}
            />
            <ToolbarButton
              label="Export"
              icon={Download}
              disabled={!canUseDocument}
              onClick={exportDocument}
            />
            <ToolbarButton
              label="Metadata"
              icon={Info}
              disabled={!canUseDocument}
              onClick={openMetadata}
            />
            {canConfigureTheme ? (
              <ToolbarButton
                label="Themes"
                icon={Palette}
                onClick={openTheme}
              />
            ) : null}
            <ToolbarButton
              label="Developer"
              icon={Wrench}
              onClick={openDeveloper}
            />
            {signatureCount > 0 ? (
              <ToolbarButton
                label={`Digital signatures (${signatureCount})`}
                icon={Signature}
                onClick={openSignatures}
              />
            ) : null}
          </FloatingToolbarGroup>
        )) : null}

        {activeSection === 'page' ? renderSection('Page toolbar', (
          <>
            <FloatingToolbarGroup>
              <ToolbarButton
                label="Zoom out"
                icon={Minus}
                disabled={!canUseDocument}
                onClick={() => zoomByButton(-1)}
              />
              <ZoomControl
                disabled={!canUseDocument}
                zoomLevel={zoomLevel}
                zoomPercent={zoomPercent}
                onPresetChange={selectZoom}
                onPercentChange={enterZoom}
              />
              <ToolbarButton
                label="Zoom in"
                icon={Plus}
                disabled={!canUseDocument}
                onClick={() => zoomByButton(1)}
              />
            </FloatingToolbarGroup>
            <FloatingToolbarDivider />
            <FloatingToolbarGroup>
              <ToolbarButton
                label={spreadMode === SpreadMode.Odd ? 'Single page' : 'Two page'}
                icon={GalleryHorizontal}
                active={spreadMode === SpreadMode.Odd}
                disabled={!canUseDocument}
                onClick={toggleSpread}
              />
              <ToolbarButton
                label="Vertical scroll"
                icon={ArrowDownUp}
                active={scrollStrategy === ScrollStrategy.Vertical}
                disabled={!canUseDocument}
                onClick={() => setScroll(ScrollStrategy.Vertical)}
              />
              <ToolbarButton
                label="Horizontal scroll"
                icon={ArrowLeftRight}
                active={scrollStrategy === ScrollStrategy.Horizontal}
                disabled={!canUseDocument}
                onClick={() => setScroll(ScrollStrategy.Horizontal)}
              />
              <ToolbarButton
                label="Rotate"
                icon={RotateCw}
                disabled={!canUseDocument}
                onClick={rotateForward}
              />
              <ToolbarButton
                label="Thumbnails"
                icon={BookImage}
                active={thumbnailsOpen}
                disabled={!canUseDocument}
                onClick={toggleThumbnails}
              />
            </FloatingToolbarGroup>
          </>
        ), true) : null}

        {activeSection === 'search' ? renderSection('Search toolbar', (
          <Search
            search={search}
            scroll={scroll}
            documentId={documentId}
            open
            onSearch={pinForSearch}
          />
        ), true) : null}

        {activeSection === 'draw' ? renderSection('Draw toolbar', (
          <div className={styles.drawTools}>
            {DRAW_TOOLS.map(({ id, label, icon }) => (
              <ToolbarButton
                key={id}
                label={label}
                icon={icon}
                active={activeTool === id}
                disabled={!canUseDocument}
                onClick={() => selectDrawTool(id)}
              />
            ))}
            <FloatingToolbarDivider />
            <ToolbarButton
              label="Colors"
              icon={PaintBucket}
              active={colorPaletteOpen}
              disabled={!canUseDocument}
              onClick={toggleColorPalette}
            />
            <ToolbarButton
              label="Undo"
              icon={Undo2}
              disabled={!canUseDocument}
              onClick={() => runAnnotationHistory('undo')}
            />
            <ToolbarButton
              label="Redo"
              icon={Redo2}
              disabled={!canUseDocument}
              onClick={() => runAnnotationHistory('redo')}
            />
          </div>
        ), true) : null}
      </PortalProvider>
    </div>
  );
}
