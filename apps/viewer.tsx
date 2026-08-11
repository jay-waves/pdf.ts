import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PluginRegistry } from '@embedpdf/core';
import { FontCharset, type FontFallbackConfig } from '@embedpdf/engines/pdfium';
import pdfiumWasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import notoSansVariableUrl from '#noto-sans-variable.ttf';
import type { FormCapability } from '@embedpdf/plugin-form';
import { ScrollStrategy } from '@embedpdf/plugin-scroll/react';
import { ZoomMode, type ZoomCapability } from '@embedpdf/plugin-zoom/react';
import './viewer.css';
import {
  EMPTY_CLEANUP,
  getDocumentScope,
  getPluginCapability,
} from './utils';
import { getFileNameFromUrl } from './url';
import {
  Outline,
  getCurrentBookmark,
  installPageTracker,
  installOutlinePrefetch,
  type OutlineCache,
} from './outline';
import { BottomNav } from './bottom-navigation';
import { installSearchKey } from './search';
import { PdfSearch } from './pdf-search';
import { PdfScroll } from './pdf-scroll';
import { initializeViewerTheme } from './theme';
import { Toolbar } from './toolbar';
import { Thumbnails } from './thumbnails';
import { ColorPalette } from './color-palette';
import {
  installAnnotationDirty,
  installAnnotationLinks,
  installAnnotationPreview,
  installCommentEditor,
} from './annotations';
import { Comments } from './comments';
import { MetadataDialog } from './metadata-dialog';
import { PrintDialog } from './print-dialog';
import { ProtectDialog } from './protection-dialogs';
import { ThemeDialog } from './theme-dialog';
import { DeveloperDialog } from './developer-dialog';
import { ContextMenu } from './context-menu';
import { Dialog, TooltipProvider } from './components';
import { exportPdf } from './pdf-save';
import { usePdfRuntime, type PdfRuntime } from './pdf-engine';
import { useDocumentPersistence } from './viewer-document-persistence';
import { useRenderThemeVersion } from './viewer-render-theme';
import { SelectionTranslate, type SelectionTranslationRequest } from './selection-translate';
import { installReadingHistory as installPlatformReadingHistory } from './reading-history';
import {
  SignatureDialog,
  useDocumentSignatures,
} from './signatures';
import { platform } from '#platform';
import type { ManagedResource, PlatformDocument, ViewerResources } from './platform/types';
import {
  LoadingStatus,
  PdfSurface,
  RENDER_IMAGE_TYPE,
  VIEWER_STATUS_CLASS,
} from './viewer-surface';
import styles from './viewer.module.css';
import {
  getEffectiveRenderDpr,
  getRenderDprMode,
  installErrorDiagnostics,
  installInputEnvironmentSampling,
  installRenderDprOverride,
  setRenderDprMode,
  viewerDiagnostics,
  type RenderDprMode,
} from './viewer-diagnostics';
import { DOCUMENT_ID } from './viewer-document';

const BUNDLED_PDFIUM_WASM_URL = new URL(pdfiumWasmUrl, import.meta.url).href;
// The engine tracks fontFallback by reference. Keep it module-stable so
// ordinary React re-renders cannot tear down and recreate the WASM engine.
const PDFIUM_FONT_FALLBACK: FontFallbackConfig = {
  fonts: {
    [FontCharset.ANSI]: notoSansVariableUrl,
    [FontCharset.DEFAULT]: notoSansVariableUrl,
    [FontCharset.CYRILLIC]: notoSansVariableUrl,
    [FontCharset.GREEK]: notoSansVariableUrl,
    [FontCharset.VIETNAMESE]: notoSansVariableUrl,
    [FontCharset.EASTERNEUROPEAN]: notoSansVariableUrl,
  },
};
function installAll(installers: Array<() => () => void>) {
  const cleanups: Array<() => void> = [];
  const cleanup = () => {
    while (cleanups.length) cleanups.pop()!();
  };

  try {
    for (const install of installers) cleanups.push(install());
  } catch (error) {
    cleanup();
    throw error;
  }

  return cleanup;
}

function installScrollAttribute(scroll: PdfScroll) {
  const sync = (strategy = scroll.getStrategy()) => {
    document.documentElement.dataset.pdfScrollStrategy = (
      strategy === ScrollStrategy.Horizontal ? 'horizontal' : 'vertical'
    );
  };

  sync();
  return scroll.onStrategyChange(sync);
}

function installFormDirty(registry: PluginRegistry, onDirty: () => void) {
  const form = getPluginCapability<FormCapability>(registry, 'form');
  return form?.onFieldValueChange(onDirty) ?? EMPTY_CLEANUP;
}

function installZoomKeys(registry: PluginRegistry, documentId: string) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    if (event.key !== '+' && event.key !== '=' && event.key !== '-' && event.key !== '_' && event.key !== '0') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const zoom = getDocumentScope<ZoomCapability>(registry, 'zoom', documentId);
    if (!zoom) {
      return;
    }

    if (event.key === '0') {
      zoom.requestZoom(ZoomMode.FitPage);
    } else if (event.key === '-' || event.key === '_') {
      zoom.zoomOut();
    } else {
      zoom.zoomIn();
    }
  };

  window.addEventListener('keydown', onKeyDown, { capture: true });

  return () => {
    window.removeEventListener('keydown', onKeyDown, { capture: true });
  };
}

interface AppProps {
  pdfium: PdfRuntime;
  sourceDocument?: PlatformDocument;
  onResourceConsumed(resource?: ManagedResource): void;
}

type CommentTarget = { annotationId: string; isNew: boolean };
type SidePanel =
  | { type: 'outline' | 'thumbnails' | 'colors' }
  | { type: 'comments'; target: CommentTarget | null };
type ActiveDialog = 'print' | 'protect' | 'metadata' | 'signatures' | 'theme' | 'developer';
type ViewerOverlay =
  | { type: 'side-panel'; panel: SidePanel }
  | { type: 'dialog'; dialog: ActiveDialog }
  | { type: 'translation'; request: SelectionTranslationRequest }
  | null;
type ViewerUiState = {
  panMode: boolean;
  searchOpen: boolean;
  overlay: ViewerOverlay;
};
type ViewerUiAction =
  | { type: 'reset' }
  | { type: 'set-pan'; enabled: boolean }
  | { type: 'set-search'; open: boolean }
  | { type: 'toggle-side-panel'; panel: 'thumbnails' | 'colors' }
  | { type: 'open-side-panel'; panel: SidePanel }
  | { type: 'open-dialog'; dialog: ActiveDialog }
  | { type: 'open-translation'; request: SelectionTranslationRequest }
  | { type: 'close-overlay' };
type DocumentPane = Exclude<SidePanel['type'], 'colors'>;
const DOCUMENT_PANE_TITLES: Record<DocumentPane, string> = {
  thumbnails: 'PDF Thumbnails',
  outline: 'PDF Outline',
  comments: 'PDF Comments',
};

const INITIAL_DOCUMENT_VIEW = { pageNumber: 1, totalPages: 0 };
const INITIAL_VIEWER_UI: ViewerUiState = { panMode: false, searchOpen: false, overlay: null };

function viewerUiReducer(state: ViewerUiState, action: ViewerUiAction): ViewerUiState {
  switch (action.type) {
    case 'reset': return INITIAL_VIEWER_UI;
    case 'set-pan': return { ...state, panMode: action.enabled };
    case 'set-search': return {
      ...state,
      searchOpen: action.open,
      overlay: action.open ? null : state.overlay,
    };
    case 'toggle-side-panel': {
      const current = state.overlay?.type === 'side-panel' ? state.overlay.panel : null;
      return {
        ...state,
        searchOpen: false,
        overlay: current?.type === action.panel
          ? null
          : { type: 'side-panel', panel: { type: action.panel } },
      };
    }
    case 'open-side-panel': return {
      ...state,
      searchOpen: false,
      overlay: { type: 'side-panel', panel: action.panel },
    };
    case 'open-dialog': return {
      ...state,
      searchOpen: false,
      overlay: { type: 'dialog', dialog: action.dialog },
    };
    case 'open-translation': return {
      ...state,
      searchOpen: false,
      overlay: { type: 'translation', request: action.request },
    };
    case 'close-overlay': return { ...state, overlay: null };
  }
}

function App({
  pdfium,
  sourceDocument,
  onResourceConsumed,
}: AppProps) {
  const engine = pdfium.engine;
  const {
    resource: documentResource,
    key: documentKey,
    name: documentName,
    fileHandle,
  } = sourceDocument ?? {};
  const fileUrl = documentResource?.url;
  const resolvedDocumentName = documentName ?? (fileUrl ? getFileNameFromUrl(fileUrl) : undefined);
  const documentId = fileUrl ? DOCUMENT_ID : null;
  const [registry, setRegistry] = useState<PluginRegistry>();
  const [pdfScroll, setPdfScroll] = useState<PdfScroll | null>(null);
  const [viewerUi, dispatchViewerUi] = useReducer(viewerUiReducer, INITIAL_VIEWER_UI);
  const [dprMode, setDprMode] = useState<RenderDprMode>(getRenderDprMode);
  const [outlineCache, setOutlineCache] = useState<OutlineCache>({
    status: 'idle',
    bookmarks: [],
  });
  const [documentView, setDocumentView] = useState(INITIAL_DOCUMENT_VIEW);
  const search = useMemo(() => new PdfSearch(pdfium), [pdfium]);
  const signatures = useDocumentSignatures(engine, registry, documentId);
  const renderThemeVersion = useRenderThemeVersion(engine);
  const { isDirty, saveDocument, setDirty } = useDocumentPersistence({
    engine,
    registry,
    documentId,
    fileHandle,
    title: resolvedDocumentName ?? 'PDF',
  });
  const { pageNumber: currentPageNumber, totalPages } = documentView;
  const { panMode, searchOpen } = viewerUi;
  const sidePanel = viewerUi.overlay?.type === 'side-panel' ? viewerUi.overlay.panel : null;
  const activeDialog = viewerUi.overlay?.type === 'dialog' ? viewerUi.overlay.dialog : null;
  const translationRequest = viewerUi.overlay?.type === 'translation'
    ? viewerUi.overlay.request
    : null;
  const currentBookmark = useMemo(
    () => getCurrentBookmark(outlineCache.bookmarks, currentPageNumber),
    [currentPageNumber, outlineCache.bookmarks],
  );
  const currentBookmarkKey = currentBookmark?.key ?? '';
  const currentTitle = currentBookmark?.title ?? '';
  const commentTarget = sidePanel?.type === 'comments' ? sidePanel.target : null;
  const documentPane: DocumentPane | null = sidePanel && sidePanel.type !== 'colors' ? sidePanel.type : null;
  const viewerRootRef = useRef<HTMLElement>(null);
  const registryCleanupRef = useRef<(() => void) | null>(null);
  const closeOverlay = () => dispatchViewerUi({ type: 'close-overlay' });
  const toggleSidePanel = (type: 'thumbnails' | 'colors') => {
    dispatchViewerUi({ type: 'toggle-side-panel', panel: type });
  };
  const openDialog = (dialog: ActiveDialog) => {
    dispatchViewerUi({ type: 'open-dialog', dialog });
  };
  const openNavigationPanel = (type: 'outline' | 'thumbnails') => {
    dispatchViewerUi({ type: 'open-side-panel', panel: { type } });
  };

  useEffect(() => {
    return () => {
      registryCleanupRef.current?.();
      registryCleanupRef.current = null;
      search.dispose();
    };
  }, [search]);

  const initializePlugins = useCallback(async (nextRegistry: PluginRegistry) => {
    registryCleanupRef.current?.();
    registryCleanupRef.current = null;

    const nextScroll = new PdfScroll(nextRegistry, DOCUMENT_ID);
    setRegistry(nextRegistry);
    setPdfScroll(nextScroll);
    setOutlineCache({ status: 'idle', bookmarks: [] });
    setDocumentView(INITIAL_DOCUMENT_VIEW);
    dispatchViewerUi({ type: 'reset' });
    viewerDiagnostics.resetRendering();
    search.clear();
    setDirty(false);

    const installers = [
      () => pdfium.bindRegistry(nextRegistry),
      () => installZoomKeys(nextRegistry, DOCUMENT_ID),
      () => nextScroll.installInput(),
      () => installScrollAttribute(nextScroll),
      () => installAnnotationLinks(nextRegistry, platform.openExternal),
      () => installAnnotationPreview(nextRegistry, DOCUMENT_ID),
      () => installCommentEditor(nextRegistry, (annotationId) => {
        dispatchViewerUi({
          type: 'open-side-panel',
          panel: { type: 'comments', target: { annotationId, isNew: true } },
        });
      }),
      () => installAnnotationDirty(nextRegistry, () => setDirty(true)),
      () => installFormDirty(nextRegistry, () => setDirty(true)),
      () => installPlatformReadingHistory(nextRegistry, nextScroll, documentKey),
      () => installPageTracker(nextScroll, setDocumentView),
      () => installSearchKey(() => dispatchViewerUi({ type: 'set-search', open: true })),
      () => installOutlinePrefetch(pdfium, {
        documentId: DOCUMENT_ID,
        scroll: nextScroll,
        cacheKey: documentKey,
        onLoaded: setOutlineCache,
      }),
    ];

    registryCleanupRef.current = installAll(installers);
  }, [documentKey, pdfium, search, setDirty]);

  const toolbarState = {
    documentId,
    searchOpen,
    thumbnailsOpen: sidePanel?.type === 'thumbnails',
    colorPaletteOpen: sidePanel?.type === 'colors',
    panMode,
    signatureCount: signatures.length,
    canSave: isDirty,
  };
  const toolbarActions = {
    setPanMode: (enabled: boolean) => dispatchViewerUi({ type: 'set-pan', enabled }),
    setSearchOpen: (open: boolean) => dispatchViewerUi({ type: 'set-search', open }),
    toggleThumbnails: () => {
      toggleSidePanel('thumbnails');
    },
    toggleColorPalette: () => toggleSidePanel('colors'),
    openPrint: () => openDialog('print'),
    openProtect: () => openDialog('protect'),
    openMetadata: () => openDialog('metadata'),
    openTheme: () => openDialog('theme'),
    openDeveloper: () => openDialog('developer'),
    openSignatures: () => openDialog('signatures'),
    exportDocument: () => {
      void exportPdf(engine, registry, documentId, resolvedDocumentName ?? 'document.pdf').catch((error) => {
        console.error('[pdf-ts] failed to export PDF', error);
      });
    },
    saveDocument: () => void saveDocument(),
  };

  return (
    <main ref={viewerRootRef} className="fixed inset-0 overflow-hidden">
      <PdfSurface
        engine={engine}
        registry={registry}
        panMode={panMode}
        renderThemeVersion={renderThemeVersion}
        search={search}
        scroll={pdfScroll}
        documentResource={documentResource}
        onInitialized={initializePlugins}
        onResourceConsumed={onResourceConsumed}
        renderDpr={getEffectiveRenderDpr(dprMode)}
      />
      <Toolbar
        registry={registry}
        search={search}
        scroll={pdfScroll}
        state={toolbarState}
        actions={toolbarActions}
      />
      <Dialog
        open={documentPane !== null}
        onClose={closeOverlay}
        title={documentPane ? DOCUMENT_PANE_TITLES[documentPane] : 'PDF Document'}
      >
        <Thumbnails
          registry={registry}
          documentId={documentId}
          scroll={pdfScroll}
          open={documentPane === 'thumbnails'}
          totalPages={totalPages}
          currentPageNumber={currentPageNumber}
          onClose={closeOverlay}
        />
        <Outline
          registry={registry}
          pdfium={pdfium}
          documentId={documentId}
          scroll={pdfScroll}
          open={documentPane === 'outline'}
          cache={outlineCache}
          currentBookmarkKey={currentBookmarkKey}
          onCacheChange={setOutlineCache}
        />
        <Comments
          engine={engine}
          registry={registry}
          documentId={documentId}
          scroll={pdfScroll}
          open={documentPane === 'comments'}
          currentPageNumber={currentPageNumber}
          targetAnnotationId={commentTarget?.annotationId}
          targetAnnotationIsNew={commentTarget?.isNew}
        />
      </Dialog>
      <ColorPalette
        registry={registry}
        documentId={documentId}
        open={sidePanel?.type === 'colors'}
        onClose={closeOverlay}
      />
      <ContextMenu
        engine={engine}
        registry={registry}
        documentId={documentId}
        scroll={pdfScroll}
        container={viewerRootRef.current}
        onOpenComments={(annotationId, isNew) => dispatchViewerUi({
          type: 'open-side-panel',
          panel: { type: 'comments', target: { annotationId, isNew } },
        })}
        onOpenColorPalette={() => dispatchViewerUi({
          type: 'open-side-panel',
          panel: { type: 'colors' },
        })}
        onTranslate={(documentId, anchor) => dispatchViewerUi({
          type: 'open-translation',
          request: { documentId, anchor },
        })}
      />
      {translationRequest ? (
        <SelectionTranslate
          registry={registry}
          request={translationRequest}
          onClose={() => dispatchViewerUi({ type: 'close-overlay' })}
        />
      ) : null}
      <PrintDialog
        registry={registry}
        documentId={documentId}
        open={activeDialog === 'print'}
        currentPageNumber={currentPageNumber}
        totalPages={totalPages}
        onClose={closeOverlay}
      />
      <ProtectDialog
        registry={registry}
        documentId={documentId}
        open={activeDialog === 'protect'}
        onClose={closeOverlay}
        onProtectionChanged={() => setDirty(true, true)}
      />
      <MetadataDialog
        registry={registry}
        documentId={documentId}
        open={activeDialog === 'metadata'}
        fileName={resolvedDocumentName}
        pageCount={totalPages}
        onClose={closeOverlay}
      />
      <SignatureDialog
        signatures={signatures}
        resource={documentResource}
        open={activeDialog === 'signatures'}
        onClose={closeOverlay}
      />
      <ThemeDialog
        open={activeDialog === 'theme'}
        onClose={closeOverlay}
      />
      <DeveloperDialog
        open={activeDialog === 'developer'}
        dprMode={dprMode}
        onDprModeChange={(nextMode) => {
          setRenderDprMode(nextMode);
          setDprMode(nextMode);
        }}
        onClose={closeOverlay}
      />
      <BottomNav
        scroll={pdfScroll}
        title={currentTitle}
        pageNumber={currentPageNumber}
        totalPages={totalPages}
        outlineStatus={outlineCache.status}
        onOpenOutline={() => openNavigationPanel('outline')}
        onOpenThumbnails={() => openNavigationPanel('thumbnails')}
      />
    </main>
  );
}

const WEB_FILE_CONTROL_CLASS = [
  'inline-flex min-h-9.5 cursor-pointer items-center justify-center',
  'rounded-lg border border-accent bg-accent px-5.5',
  'text-[13px] font-semibold text-surface',
].join(' ');

function WebDocumentPicker({
  onOpen,
}: {
  onOpen(file?: File): Promise<void>;
}) {
  const [dragging, setDragging] = useState(false);
  const [selectionError, setSelectionError] = useState('');

  const openDocument = async (file?: File) => {
    try {
      await onOpen(file);
      setSelectionError('');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setSelectionError(error instanceof Error ? error.message : 'Unable to open PDF.');
      }
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-app p-6">
      <section
        className={styles.welcomeCard}
        data-dragging={dragging ? 'true' : undefined}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void openDocument(event.dataTransfer.files[0]);
        }}
      >
        <img className="size-13.5" src="./icon.png" alt="" />
        <h1 className="mt-4.5 mb-6.5 text-[25px]">PDF.ts Web Viewer</h1>
        <button
          className={WEB_FILE_CONTROL_CLASS}
          type="button"
          onClick={() => void openDocument()}
        >
          Choose a PDF file
        </button>
        <span className="mt-2.5 mb-6.5 block text-[11px] text-muted">or drop a PDF here</span>
        {selectionError ? (
          <p className="mt-3 mb-0 text-xs text-danger" role="alert">
            {selectionError}
          </p>
        ) : null}
        <small className="mt-5.5 block leading-[1.6] text-muted">
          Local files are processed only in this browser tab and are never uploaded.
        </small>
      </section>
    </main>
  );
}

function useViewerResources() {
  const [resources, setResources] = useState<ViewerResources>();
  const [error, setError] = useState<Error>();
  const managedResourcesRef = useRef(new Set<ManagedResource>());

  const trackResource = useCallback((resource?: ManagedResource) => {
    if (resource) managedResourcesRef.current.add(resource);
  }, []);

  const releaseResource = useCallback((resource?: ManagedResource) => {
    if (!resource || !managedResourcesRef.current.delete(resource)) return;
    resource.release?.();
  }, []);

  useEffect(() => {
    let cancelled = false;
    platform.loadViewerResources(BUNDLED_PDFIUM_WASM_URL).then((loaded) => {
      trackResource(loaded.wasm);
      trackResource(loaded.document?.resource);
      if (cancelled) {
        releaseResource(loaded.wasm);
        releaseResource(loaded.document?.resource);
      } else {
        setResources(loaded);
      }
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason : new Error(String(reason)));
    });

    return () => {
      cancelled = true;
    };
  }, [releaseResource, trackResource]);

  useEffect(() => () => {
    for (const resource of managedResourcesRef.current) resource.release?.();
    managedResourcesRef.current.clear();
  }, []);

  return { resources, setResources, error, trackResource, releaseResource };
}

function ViewerBootstrap() {
  const { resources, setResources, error, trackResource, releaseResource } = useViewerResources();

  if (error) {
    return <div className={`${VIEWER_STATUS_CLASS} text-danger`}>Unable to load PDF resources: {error.message}</div>;
  }

  if (!resources) {
    return <LoadingStatus label="Loading PDF resources…" />;
  }

  return (
    <ReadyViewer
      resources={resources}
      setResources={setResources}
      trackResource={trackResource}
      releaseResource={releaseResource}
    />
  );
}

function ReadyViewer({
  resources,
  setResources,
  trackResource,
  releaseResource,
}: {
  resources: ViewerResources;
  setResources(resources: ViewerResources): void;
  trackResource(resource?: ManagedResource): void;
  releaseResource(resource?: ManagedResource): void;
}) {
  const { pdfium, isLoading, error } = usePdfRuntime({
    wasmUrl: resources.wasm.url,
    fontFallback: PDFIUM_FONT_FALLBACK,
    defaultImageType: RENDER_IMAGE_TYPE,
  });

  useEffect(() => {
    if (!isLoading) releaseResource(resources.wasm);
  }, [isLoading, releaseResource, resources.wasm]);

  if (platform.openLocalDocument && !resources.document) {
    const openLocalDocument = platform.openLocalDocument;
    const useDocument = (document: NonNullable<ViewerResources['document']>) => {
      trackResource(document.resource);
      setResources({ ...resources, document });
    };
    return <WebDocumentPicker
      onOpen={async (file) => {
        const document = await openLocalDocument(file);
        if (document) useDocument(document);
      }}
    />;
  }

  if (!pdfium) {
    if (isLoading) {
      return <LoadingStatus label="Starting PDF engine…" />;
    }
    return (
      <div className={`${VIEWER_STATUS_CLASS} ${error ? 'text-danger' : ''}`}>
        {error ? `Unable to initialize PDF engine: ${error.message}` : 'PDF engine unavailable.'}
      </div>
    );
  }

  return (
    <App
      key={resources.document?.resource.url}
      pdfium={pdfium}
      sourceDocument={resources.document}
      onResourceConsumed={releaseResource}
    />
  );
}

initializeViewerTheme();
installErrorDiagnostics();
installInputEnvironmentSampling();
installRenderDprOverride();

createRoot(document.getElementById('root')!).render(
  <TooltipProvider>
    <ViewerBootstrap />
  </TooltipProvider>,
);
