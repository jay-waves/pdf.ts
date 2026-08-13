import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { ScrollStrategy } from '@embedpdf/plugin-scroll';
import { SpreadMode } from '@embedpdf/plugin-spread';
import { ZoomMode, type ZoomLevel } from '@embedpdf/plugin-zoom';
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
import type { PdfScroll } from './pdf-scroll';
import {
  getStoredToolbarPinned,
  setStoredToolbarPinned,
} from './theme';
import { Search } from './search';
import { useViewerActivityAutoHide } from './components/use-auto-hide';
import type {
  ViewerCapabilityFeedback,
  ViewerCommandDispatch,
} from './viewer-controller';
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

interface ToolbarFeedback extends ViewerCapabilityFeedback {
  documentId?: string | null;
  searchOpen: boolean;
  thumbnailsOpen: boolean;
  colorPaletteOpen: boolean;
  panMode: boolean;
  signatureCount: number;
  canSave: boolean;
  canConfigureTheme: boolean;
  darkAppearance: boolean;
}

interface ToolbarProps {
  scroll?: PdfScroll | null;
  feedback: ToolbarFeedback;
  dispatch: ViewerCommandDispatch;
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

export function Toolbar({
  scroll,
  feedback: {
    documentId,
    searchOpen,
    thumbnailsOpen,
    colorPaletteOpen,
    panMode,
    signatureCount,
    canSave,
    canConfigureTheme,
    darkAppearance,
    zoomPercent,
    zoomLevel,
    activeTool,
    spreadMode,
    scrollStrategy,
  },
  dispatch,
}: ToolbarProps) {
  const [activeSection, setActiveSection] = useState<ToolbarSection | null>(null);
  const [pinned, setPinned] = useState(() => getStoredToolbarPinned());
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const searchWasOpenRef = useRef(false);
  const pointerHoveringRef = useRef(false);
  const canUseDocument = Boolean(documentId);
  const {
    visible: toolbarVisible,
    reveal: showToolbar,
    scheduleHide: scheduleToolbarHide,
  } = useViewerActivityAutoHide(
    'toolbar',
    () => !pinned && !pointerHoveringRef.current && !portalContainer?.matches(':focus-within'),
  );

  useEffect(() => {
    if (activeTool && !searchOpen) {
      setActiveSection('draw');
    }
  }, [activeTool, searchOpen]);

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
  }, [scheduleToolbarHide, searchOpen, showToolbar]);

  useEffect(() => {
    if (!pinned) scheduleToolbarHide();
  }, [pinned, scheduleToolbarHide]);

  const closeSearch = () => dispatch({ type: 'ui/set-search', open: false });
  const openSection = (section: ToolbarSection) => {
    setActiveSection(section);

    if (section === 'search') {
      dispatch({ type: 'ui/set-search', open: true });
      return;
    }

    if (section === 'page') dispatch({ type: 'annotation/clear-tool' });
    if (section !== 'document') closeSearch();
  };

  const returnToPrimaryToolbar = () => {
    setActiveSection(null);
    if (searchOpen) closeSearch();
  };

  const togglePan = () => {
    dispatch({ type: 'ui/set-pan', enabled: !panMode });
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

  const selectDrawTool = (toolId: string) => {
    dispatch({ type: 'annotation/toggle-tool', toolId });
  };

  const selectZoom = (value: string) => {
    const level = ZOOM_LEVELS.get(value);
    if (level !== undefined) dispatch({ type: 'view/set-zoom', level });
  };

  const enterZoom = (percent: number) => {
    dispatch({ type: 'view/set-zoom', level: percent / 100 });
  };

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      if (pinned || event.clientY <= 40) {
        showToolbar();
      } else if (!pointerHoveringRef.current && !portalContainer?.matches(':focus-within')) {
        scheduleToolbarHide();
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, [pinned, portalContainer, scheduleToolbarHide, showToolbar]);

  const renderPersistentControls = () => (
    <div className={styles.persistentControls}>
      <FloatingToolbarDivider />
      <FloatingToolbarGroup>
        <IconButton
          label="Save"
          icon={Save}
          disabled={!canSave}
          onClick={() => dispatch({ type: 'document/save' })}
        />
        {canConfigureTheme ? (
          <IconButton
            label={darkAppearance ? 'Light theme' : 'Dark theme'}
            icon={darkAppearance ? Sun : Moon}
            iconSize={15.5}
            onClick={() => dispatch({ type: 'theme/toggle' })}
          />
        ) : null}
        <IconButton
          label="Pan"
          icon={Hand}
          active={panMode}
          disabled={!canUseDocument}
          onClick={togglePan}
        />
        <IconButton
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
      <IconButton label="Back" icon={ArrowLeft} onClick={returnToPrimaryToolbar} />
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
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse') return;
        pointerHoveringRef.current = true;
        showToolbar();
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'mouse') return;
        pointerHoveringRef.current = false;
        scheduleToolbarHide();
      }}
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
            <IconButton
              label="Print"
              icon={Printer}
              disabled={!canUseDocument}
              onClick={() => dispatch({ type: 'ui/open-dialog', dialog: 'print' })}
            />
            <IconButton
              label="Security"
              icon={Lock}
              disabled={!canUseDocument}
              onClick={() => dispatch({ type: 'ui/open-dialog', dialog: 'protect' })}
            />
            <IconButton
              label="Export"
              icon={Download}
              disabled={!canUseDocument}
              onClick={() => dispatch({ type: 'document/export' })}
            />
            <IconButton
              label="Metadata"
              icon={Info}
              disabled={!canUseDocument}
              onClick={() => dispatch({ type: 'ui/open-dialog', dialog: 'metadata' })}
            />
            {canConfigureTheme ? (
              <IconButton
                label="Themes"
                icon={Palette}
                onClick={() => dispatch({ type: 'ui/open-dialog', dialog: 'theme' })}
              />
            ) : null}
            <IconButton
              label="Developer"
              icon={Wrench}
              onClick={() => dispatch({ type: 'ui/open-dialog', dialog: 'developer' })}
            />
            {signatureCount > 0 ? (
              <IconButton
                label={`Digital signatures (${signatureCount})`}
                icon={Signature}
                onClick={() => dispatch({ type: 'ui/open-dialog', dialog: 'signatures' })}
              />
            ) : null}
          </FloatingToolbarGroup>
        )) : null}

        {activeSection === 'page' ? renderSection('Page toolbar', (
          <>
            <FloatingToolbarGroup>
              <IconButton
                label="Zoom out"
                icon={Minus}
                disabled={!canUseDocument}
                onClick={() => dispatch({ type: 'view/zoom-step', direction: -1 })}
              />
              <ZoomControl
                disabled={!canUseDocument}
                zoomLevel={zoomLevel}
                zoomPercent={zoomPercent}
                onPresetChange={selectZoom}
                onPercentChange={enterZoom}
              />
              <IconButton
                label="Zoom in"
                icon={Plus}
                disabled={!canUseDocument}
                onClick={() => dispatch({ type: 'view/zoom-step', direction: 1 })}
              />
            </FloatingToolbarGroup>
            <FloatingToolbarDivider />
            <FloatingToolbarGroup>
              <IconButton
                label={spreadMode === SpreadMode.Odd ? 'Single page' : 'Two page'}
                icon={GalleryHorizontal}
                active={spreadMode === SpreadMode.Odd}
                disabled={!canUseDocument}
                onClick={() => dispatch({ type: 'view/toggle-spread' })}
              />
              <IconButton
                label="Vertical scroll"
                icon={ArrowDownUp}
                active={scrollStrategy === ScrollStrategy.Vertical}
                disabled={!canUseDocument}
                onClick={() => dispatch({ type: 'view/set-scroll', strategy: ScrollStrategy.Vertical })}
              />
              <IconButton
                label="Horizontal scroll"
                icon={ArrowLeftRight}
                active={scrollStrategy === ScrollStrategy.Horizontal}
                disabled={!canUseDocument}
                onClick={() => dispatch({ type: 'view/set-scroll', strategy: ScrollStrategy.Horizontal })}
              />
              <IconButton
                label="Rotate"
                icon={RotateCw}
                disabled={!canUseDocument}
                onClick={() => dispatch({ type: 'view/rotate' })}
              />
              <IconButton
                label="Thumbnails"
                icon={BookImage}
                active={thumbnailsOpen}
                disabled={!canUseDocument}
                onClick={() => dispatch({ type: 'ui/toggle-panel', panel: 'thumbnails' })}
              />
            </FloatingToolbarGroup>
          </>
        ), true) : null}

        {activeSection === 'search' ? renderSection('Search toolbar', (
          <Search
            scroll={scroll}
            documentId={documentId}
            onSearch={pinForSearch}
          />
        ), true) : null}

        {activeSection === 'draw' ? renderSection('Draw toolbar', (
          <div className={styles.drawTools}>
            {DRAW_TOOLS.map(({ id, label, icon }) => (
              <IconButton
                key={id}
                label={label}
                icon={icon}
                active={activeTool === id}
                disabled={!canUseDocument}
                onClick={() => selectDrawTool(id)}
              />
            ))}
            <FloatingToolbarDivider />
            <IconButton
              label="Colors"
              icon={PaintBucket}
              active={colorPaletteOpen}
              disabled={!canUseDocument}
              onClick={() => dispatch({ type: 'ui/toggle-panel', panel: 'colors' })}
            />
            <IconButton
              label="Undo"
              icon={Undo2}
              disabled={!canUseDocument}
              onClick={() => dispatch({ type: 'annotation/history', direction: 'undo' })}
            />
            <IconButton
              label="Redo"
              icon={Redo2}
              disabled={!canUseDocument}
              onClick={() => dispatch({ type: 'annotation/history', direction: 'redo' })}
            />
          </div>
        ), true) : null}
      </PortalProvider>
    </div>
  );
}
