import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowLeftRight,
  BookImage,
  BookText,
  CornerDownLeft,
  CornerUpRight,
  ChevronDown,
  ChevronUp,
  Download,
  GalleryHorizontal,
  Hand,
  Info,
  LayoutTemplate,
  Minus,
  Moon,
  PenLine,
  Pin,
  Plus,
  Printer,
  RotateCw,
  Save,
  TextSearch,
  Wrench,
  X,
} from 'lucide-react';
import {
  useDocumentId,
  useDocuments,
  useLayout,
  useMetadata,
  usePages,
  useSearch,
  useSearchState,
  useStage,
  useTool,
  useZoom,
} from '@embedpdf/react';
import {
  Button,
  ControlButton,
  Dialog,
  DialogActions,
  FloatingSurface,
  FloatingToolbar,
  FloatingToolbarDivider,
  FloatingToolbarGroup,
  IconButton,
  TooltipProvider,
} from './components';
import { useViewerActivityAutoHide } from './components/use-auto-hide';
import { getStoredToolbarPinned, setStoredToolbarPinned } from './theme/theme';
import toolbarStyles from './toolbar/toolbar.module.css';
import navigationStyles from './navigation/bottom-navigation.module.css';
import documentStyles from './document/document-dialogs.module.css';
import { downloadPdf } from './platform/browser-download';
import type { PlatformDocument } from './platform/types';

type ToolbarSection = 'document' | 'page' | 'draw' | 'search';

const NOOP = () => {};
const PRIMARY_ITEMS = [
  { id: 'document', label: 'Docs', icon: BookText, enabled: true },
  { id: 'page', label: 'Page', icon: LayoutTemplate, enabled: true },
  { id: 'draw', label: 'Draw', icon: PenLine, enabled: false },
  { id: 'search', label: 'Find', icon: TextSearch, enabled: true },
] as const;

function formatMetadataDate(value: string | null) {
  if (!value) return 'Not provided';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

function MetadataDialogV3({
  fileName,
  open,
  onClose,
}: {
  fileName?: string;
  open: boolean;
  onClose(): void;
}) {
  const { metadata } = useMetadata();
  const { pageCount } = usePages();
  const fields = metadata ? [
    ['File name', fileName],
    ['Pages', String(pageCount)],
    ['Title', metadata.title],
    ['Author', metadata.author],
    ['Creator', metadata.creator],
    ['Producer', metadata.producer],
    ['Created', formatMetadataDate(metadata.created)],
    ['Modified', formatMetadataDate(metadata.modified)],
  ] : [];

  return (
    <Dialog open={open} onClose={onClose} title="Metadata">
      <div className={documentStyles.metadataContent}>
        {!metadata ? <div className={documentStyles.metadataStatus}>Loading metadata…</div> : null}
        {metadata ? (
          <dl className={documentStyles.metadataDetails}>
            {fields.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value || 'Not provided'}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      <DialogActions>
        <Button variant="primary" onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function DocumentToolbar({
  busy,
  onBack,
  onExport,
  onMetadata,
}: {
  busy: boolean;
  onBack(): void;
  onExport(): void;
  onMetadata(): void;
}) {
  return (
    <FloatingToolbar label="Document toolbar">
      <IconButton label="Back" icon={ArrowLeft} onClick={onBack} />
      <FloatingToolbarDivider />
      <FloatingToolbarGroup>
        <IconButton label="Print (waiting for EmbedPDF v3 UI)" icon={Printer} disabled onClick={NOOP} />
        <IconButton label="Export" icon={Download} disabled={busy} onClick={onExport} />
        <IconButton label="Metadata" icon={Info} onClick={onMetadata} />
        <IconButton label="Developer diagnostics (waiting for EmbedPDF v3)" icon={Wrench} disabled onClick={NOOP} />
      </FloatingToolbarGroup>
    </FloatingToolbar>
  );
}

function SearchToolbar({ onBack }: { onBack(): void }) {
  const search = useSearch();
  const state = useSearchState();
  const [query, setQuery] = useState(state.query?.text ?? '');

  const close = () => {
    search.clear();
    onBack();
  };

  return (
    <FloatingToolbar label="Search toolbar" overflow>
      <IconButton label="Back" icon={ArrowLeft} onClick={close} />
      <FloatingToolbarDivider />
      <form
        className="inline-flex h-6.5 items-center gap-1 rounded-md border border-border-subtle bg-input px-1.5 focus-within:border-accent focus-within:shadow-control"
        onSubmit={(event) => {
          event.preventDefault();
          search.search({ text: query });
        }}
      >
        <TextSearch size={14} strokeWidth={2} aria-hidden="true" />
        <input
          autoFocus
          className="h-full w-42 border-0 bg-transparent px-1 text-foreground outline-none max-[640px]:w-28"
          value={query}
          placeholder="Find in document"
          aria-label="Find in document"
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') close();
          }}
        />
        <span className="min-w-12 text-center text-[10px] text-muted tabular-nums">
          {state.status === 'searching'
            ? `${state.progress.scanned}/${state.progress.total}`
            : state.hitCount > 0
              ? `${state.activeIndex + 1}/${state.hitCount}`
              : state.query ? '0/0' : ''}
        </span>
      </form>
      <FloatingToolbarGroup>
        <IconButton label="Previous result" icon={ChevronUp} disabled={!state.hitCount} onClick={() => search.prev()} />
        <IconButton label="Next result" icon={ChevronDown} disabled={!state.hitCount} onClick={() => search.next()} />
        <IconButton label="Close search" icon={X} onClick={close} />
      </FloatingToolbarGroup>
    </FloatingToolbar>
  );
}

function PageToolbar({ onBack }: { onBack(): void }) {
  const stage = useStage();
  const { layout, spread, setLayout, setSpread } = useLayout();
  const { zoom, mode, zoomIn, zoomOut, fitPage, fitWidth, zoomTo } = useZoom();
  const [draft, setDraft] = useState(`${Math.round(zoom * 100)}%`);

  useEffect(() => setDraft(`${Math.round(zoom * 100)}%`), [zoom]);

  const commitZoom = () => {
    const percent = Number(draft.trim().replace(/%$/, ''));
    if (Number.isFinite(percent) && percent > 0) zoomTo({ level: percent / 100 });
    else setDraft(`${Math.round(zoom * 100)}%`);
  };

  const preset = mode === 'fit-page' || mode === 'fit-width'
    ? mode
    : String(Math.round(zoom * 100) / 100);

  return (
    <FloatingToolbar label="Page toolbar" overflow>
      <IconButton label="Back" icon={ArrowLeft} onClick={onBack} />
      <FloatingToolbarDivider />
      <FloatingToolbarGroup>
        <IconButton label="Zoom out" icon={Minus} onClick={zoomOut} />
        <div className={toolbarStyles.zoomControl}>
          <input
            className={toolbarStyles.zoomInput}
            aria-label="Zoom percentage"
            inputMode="decimal"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={commitZoom}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                setDraft(`${Math.round(zoom * 100)}%`);
                event.currentTarget.blur();
              }
            }}
          />
          <select
            className={toolbarStyles.zoomMenu}
            aria-label="Zoom presets"
            value={preset}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === 'fit-page') fitPage();
              else if (value === 'fit-width') fitWidth();
              else zoomTo({ level: Number(value) });
            }}
          >
            <option value="fit-page">Fit page</option>
            <option value="fit-width">Fit width</option>
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((level) => (
              <option key={level} value={level}>{Math.round(level * 100)}%</option>
            ))}
            {!['fit-page', 'fit-width', '0.5', '0.75', '1', '1.25', '1.5', '2'].includes(preset) ? (
              <option value={preset}>{Math.round(zoom * 100)}%</option>
            ) : null}
          </select>
        </div>
        <IconButton label="Zoom in" icon={Plus} onClick={zoomIn} />
      </FloatingToolbarGroup>
      <FloatingToolbarDivider />
      <FloatingToolbarGroup>
        <IconButton
          label={spread === 'none' ? 'Two page' : 'Single page'}
          icon={GalleryHorizontal}
          active={spread !== 'none'}
          onClick={() => setSpread(spread === 'none' ? 'odd' : 'none')}
        />
        <IconButton
          label="Vertical scroll"
          icon={ArrowDownUp}
          active={layout === 'vertical'}
          onClick={() => setLayout('vertical')}
        />
        <IconButton
          label="Horizontal scroll"
          icon={ArrowLeftRight}
          active={layout === 'horizontal'}
          onClick={() => setLayout('horizontal')}
        />
        <IconButton label="Rotate view" icon={RotateCw} onClick={() => stage.rotateView(90)} />
        <IconButton label="Thumbnails (waiting for EmbedPDF v3)" icon={BookImage} disabled onClick={NOOP} />
      </FloatingToolbarGroup>
    </FloatingToolbar>
  );
}

function ViewerToolbar({ sourceDocument }: { sourceDocument: PlatformDocument }) {
  const [activeSection, setActiveSection] = useState<ToolbarSection | null>(null);
  const [pinned, setPinned] = useState(() => getStoredToolbarPinned());
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const hovering = useRef(false);
  const { activeToolId, activate } = useTool();
  const documentId = useDocumentId();
  const { download } = useDocuments();
  const { visible, reveal, scheduleHide } = useViewerActivityAutoHide(
    'toolbar',
    () => !pinned && !hovering.current,
  );

  useEffect(() => {
    reveal();
    if (!pinned) scheduleHide();
  }, [pinned, reveal, scheduleHide]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setActiveSection('search');
        reveal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [reveal]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      if (pinned || event.clientY <= 40) reveal();
      else if (!hovering.current) scheduleHide();
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, [pinned, reveal, scheduleHide]);

  const togglePinned = () => {
    const next = !pinned;
    setPinned(next);
    setStoredToolbarPinned(next);
  };

  const serialize = useCallback(async () => {
    if (!documentId) throw new Error('No PDF document is open.');
    const bytes = await download(documentId, { mode: 'incremental' });
    return bytes.slice().buffer as ArrayBuffer;
  }, [documentId, download]);

  const saveDocument = useCallback(async () => {
    const target = await sourceDocument.fileHandle.prepareWrite();
    if (!target) return false;
    setBusy(true);
    try {
      const data = await serialize();
      return target.saveIncrementalDocument
        ? await target.saveIncrementalDocument(data)
        : await target.save(data);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to save the PDF.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [serialize, sourceDocument.fileHandle]);

  const exportDocument = useCallback(async () => {
    setBusy(true);
    try {
      downloadPdf(await serialize(), sourceDocument.name ?? 'document.pdf');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to export the PDF.');
    } finally {
      setBusy(false);
    }
  }, [serialize, sourceDocument.name]);

  return (
    <div
      className={toolbarStyles.root}
      data-toolbar-level={activeSection === null ? 'primary' : 'secondary'}
      data-visible={pinned || visible ? 'true' : undefined}
      onPointerEnter={() => {
        hovering.current = true;
        reveal();
      }}
      onPointerLeave={() => {
        hovering.current = false;
        scheduleHide();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {activeSection === 'document' ? (
        <DocumentToolbar
          busy={busy}
          onBack={() => setActiveSection(null)}
          onExport={() => void exportDocument()}
          onMetadata={() => setMetadataOpen(true)}
        />
      ) : activeSection === 'page' ? <PageToolbar onBack={() => setActiveSection(null)} />
        : activeSection === 'search' ? <SearchToolbar onBack={() => setActiveSection(null)} /> : (
        <FloatingToolbar label="PDF toolbar">
          <FloatingToolbarGroup>
            {PRIMARY_ITEMS.map(({ id, label, icon: Icon, enabled }) => (
              <button
                key={id}
                type="button"
                className={toolbarStyles.modeButton}
                disabled={!enabled}
                onClick={() => enabled && setActiveSection(id)}
                aria-label={enabled ? label : `${label} (waiting for EmbedPDF v3)`}
                title={enabled ? undefined : `${label} is waiting for EmbedPDF v3`}
              >
                <Icon
                  className={`${toolbarStyles.icon} ${id === 'search' ? toolbarStyles.searchModeIcon : ''}`}
                  size={id === 'search' ? 16 : 14}
                  strokeWidth={2}
                />
                <span className={toolbarStyles.modeLabel}>{label}</span>
              </button>
            ))}
          </FloatingToolbarGroup>
          <div className={toolbarStyles.persistentControls}>
            <FloatingToolbarDivider />
            <FloatingToolbarGroup>
              <IconButton label="Save" icon={Save} disabled={busy} onClick={() => void saveDocument()} />
              <IconButton label="Theme rendering (waiting for EmbedPDF v3)" icon={Moon} disabled onClick={NOOP} />
              <IconButton
                label="Pan"
                icon={Hand}
                active={activeToolId === 'pan'}
                onClick={() => activate(activeToolId === 'pan' ? 'pointer' : 'pan')}
              />
              <IconButton label="Pin toolbar" icon={Pin} active={pinned} onClick={togglePinned} />
            </FloatingToolbarGroup>
          </div>
        </FloatingToolbar>
      )}
      <MetadataDialogV3
        fileName={sourceDocument.name}
        open={metadataOpen}
        onClose={() => setMetadataOpen(false)}
      />
    </div>
  );
}

function ViewerBottomNavigation() {
  const { currentPage, pageCount, goToPage, next, prev } = usePages();
  const [pageInput, setPageInput] = useState(String(currentPage + 1));
  const interacting = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { visible, reveal, scheduleHide } = useViewerActivityAutoHide(
    'navigation',
    () => !interacting.current,
  );

  useEffect(() => setPageInput(String(currentPage + 1)), [currentPage]);

  const revealTemporarily = useCallback(() => {
    reveal();
    scheduleHide();
  }, [reveal, scheduleHide]);

  useEffect(() => {
    revealTemporarily();
    let atEdge = false;
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const nextAtEdge = window.innerHeight - event.clientY <= 96;
      if (nextAtEdge && !atEdge) revealTemporarily();
      atEdge = nextAtEdge;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, [revealTemporarily]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const page = Number(pageInput);
    if (Number.isInteger(page) && page >= 1 && page <= pageCount) goToPage(page - 1);
    else setPageInput(String(currentPage + 1));
  };

  return (
    <FloatingSurface
      as="nav"
      className={navigationStyles.navigation}
      data-visible={visible ? 'true' : undefined}
      aria-label="PDF navigation"
      onPointerEnter={() => {
        interacting.current = true;
        reveal();
      }}
      onPointerLeave={() => {
        interacting.current = false;
        scheduleHide();
      }}
    >
      <div className={navigationStyles.navigationButtons}>
        <ControlButton
          className="min-w-0 leading-none"
          onClick={() => prev()}
          disabled={currentPage <= 0}
          aria-label="Previous page"
        >
          <CornerDownLeft size={16} strokeWidth={1.8} />
        </ControlButton>
        <ControlButton
          className="min-w-0 leading-none"
          onClick={() => next()}
          disabled={currentPage + 1 >= pageCount}
          aria-label="Next page"
        >
          <CornerUpRight size={16} strokeWidth={1.8} />
        </ControlButton>
      </div>
      <div className={navigationStyles.navigationContent}>
        <button
          type="button"
          className={`${navigationStyles.outlineButton} ${navigationStyles.thumbnailButton}`}
          aria-label="Thumbnails (waiting for EmbedPDF v3)"
          title="Thumbnails are waiting for EmbedPDF v3"
          disabled
        >
          <BookImage size={14} strokeWidth={1.8} />
        </button>
        <form
          className={navigationStyles.pageForm}
          aria-label="Page jump"
          onSubmit={submit}
          onClick={(event) => {
            reveal();
            if (event.target === inputRef.current) return;
            inputRef.current?.focus();
            inputRef.current?.select();
          }}
        >
          <input
            ref={inputRef}
            className={navigationStyles.pageInput}
            style={{ width: `${Math.max(pageInput.length, 1)}ch` }}
            value={pageInput}
            inputMode="numeric"
            aria-label="Current page"
            onChange={(event) => {
              if (/^\d*$/.test(event.currentTarget.value)) setPageInput(event.currentTarget.value);
            }}
            onBlur={() => setPageInput(String(currentPage + 1))}
          />
          <span className={navigationStyles.pageTotal}>
            <span>/</span>
            <span>{pageCount || '-'}</span>
          </span>
        </form>
      </div>
    </FloatingSurface>
  );
}

export function ViewerV3Controls({ sourceDocument }: { sourceDocument: PlatformDocument }) {
  return (
    <TooltipProvider>
      <ViewerToolbar sourceDocument={sourceDocument} />
      <ViewerBottomNavigation />
    </TooltipProvider>
  );
}
