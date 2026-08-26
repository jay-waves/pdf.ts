import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useStore } from 'zustand';
import type { PluginRegistry } from '@embedpdf/core';
import pdfiumWasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import type { FormCapability } from '@embedpdf/plugin-form';
import { ScrollStrategy } from '@embedpdf/plugin-scroll/react';
import './viewer.css';
import { getPluginCapability } from './shared/utils';
import { getFileNameFromUrl } from './shared/url';
import {
  Outline,
  getCurrentBookmark,
  installPageTracker,
  installOutlinePrefetch,
  type OutlineCache,
} from './navigation/outline';
import { BottomNav } from './navigation/bottom-navigation';
import { pdfSearchStore } from './search/pdf-search';
import { PdfScroll } from './renderer/pdf-scroll';
import {
  initializeViewerTheme,
  isDarkViewerTheme,
  viewerThemeStore,
} from './theme/theme';
import { Toolbar } from './toolbar/toolbar';
import { Thumbnails } from './navigation/thumbnails';
import { ColorPalette } from './annotations/color-palette';
import {
  installAnnotationDirty,
  installAnnotationLinks,
  installAnnotationPreview,
  installCommentEditor,
} from './annotations/annotations';
import { Comments } from './annotations/comments';
import { MetadataDialog } from './document/metadata-dialog';
import { PrintDialog } from './document/print-dialog';
import { ProtectDialog } from './document/protection-dialogs';
import { ThemeDialog } from './theme/theme-dialog';
import { DeveloperDialog } from './viewer/developer-dialog';
import { ContextMenu } from './selection/context-menu';
import { Dialog, TooltipProvider } from './components';
import { exportPdf } from './document/pdf-save';
import { usePdfRuntime, useRenderThemeVersion, type PdfRuntime } from './renderer/pdf-engine';
import { useDocumentPersistence } from './document/viewer-document-persistence';
import { SelectionTranslate } from './selection/selection-translate';
import { installReadingHistory as installPlatformReadingHistory } from './navigation/reading-history';
import {
  SignatureDialog,
  useDocumentSignatures,
} from './document/signatures';
import { platform } from '#platform';
import type { ManagedResource, PlatformDocument, ViewerResources } from './platform/types';
import {
  LoadingStatus,
  PdfSurface,
  RENDER_IMAGE_TYPE,
  VIEWER_STATUS_CLASS,
} from './viewer/pdf-surface';
import styles from './viewer/viewer.module.css';
import {
  getEffectiveRenderDpr,
  installErrorDiagnostics,
  installRenderDprOverride,
  resetViewerDiagnostics,
  viewerDiagnosticsStore,
} from './renderer/viewer-diagnostics';
import { DOCUMENT_ID } from './document/viewer-document';
import {
  INITIAL_VIEWER_UI,
  installViewerCommandKeys,
  reduceViewerUi,
  useViewerController,
} from './viewer/viewer-controller';
import { PDFIUM_FONT_FALLBACK } from './fonts';
import {
  beginStartupLog,
  completeStartupLog,
  describeStartupUrl,
  failStartupLog,
  writeStartupInfo,
  writeStartupLogOnce,
} from './viewer/startup-log';

const BUNDLED_PDFIUM_WASM_URL = new URL(pdfiumWasmUrl, import.meta.url).href;

beginStartupLog(`PDF.ts ${__PDF_TS_BUILD_INFO__}`);
writeStartupInfo(
  'Viewer script loaded',
  `${window.location.origin}${window.location.pathname}; ${navigator.onLine ? 'online' : 'offline'}`,
);
writeStartupInfo('PDFium WASM asset resolved', describeStartupUrl(BUNDLED_PDFIUM_WASM_URL));

function installAll(installers: Array<() => (() => void) | undefined>) {
  const cleanups: Array<() => void> = [];
  const cleanup = () => {
    while (cleanups.length) cleanups.pop()!();
  };

  try {
    for (const install of installers) {
      const cleanup = install();
      if (cleanup) cleanups.push(cleanup);
    }
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
  return form?.onFieldValueChange(onDirty);
}

interface AppProps {
  pdfium: PdfRuntime;
  sourceDocument?: PlatformDocument;
  onResourceConsumed(resource?: ManagedResource): void;
}

type DocumentPane = 'outline' | 'thumbnails' | 'comments';
const DOCUMENT_PANE_TITLES: Record<DocumentPane, string> = {
  thumbnails: 'PDF Thumbnails',
  outline: 'PDF Outline',
  comments: 'PDF Comments',
};

const INITIAL_DOCUMENT_VIEW = { pageNumber: 1, totalPages: 0 };

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
  const [viewerUi, dispatchViewerUi] = useReducer(reduceViewerUi, INITIAL_VIEWER_UI);
  const dprMode = useStore(viewerDiagnosticsStore, (state) => state.renderDprMode);
  const [outlineCache, setOutlineCache] = useState<OutlineCache>({
    status: 'idle',
    bookmarks: [],
  });
  const [documentView, setDocumentView] = useState(INITIAL_DOCUMENT_VIEW);
  const signatures = useDocumentSignatures(engine, registry, documentId);
  const renderThemeVersion = useRenderThemeVersion(engine);
  const viewerTheme = useStore(viewerThemeStore, (state) => state.theme);
  const { isDirty, saveDocument, setDirty } = useDocumentPersistence({
    engine,
    registry,
    documentId,
    fileHandle,
    title: resolvedDocumentName ?? 'PDF',
  });
  const { dispatch: dispatchCommand, feedback: capabilityFeedback } = useViewerController({
    registry,
    documentId,
    scroll: pdfScroll,
    updateUi: dispatchViewerUi,
    saveDocument: () => void saveDocument(),
    exportDocument: () => {
      void exportPdf(engine, registry, documentId, resolvedDocumentName ?? 'document.pdf').catch((error) => {
        console.error('[pdf-ts] failed to export PDF', error);
      });
    },
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
  const closeOverlay = useCallback(() => {
    dispatchCommand({ type: 'ui/close-overlay' });
  }, [dispatchCommand]);

  useEffect(() => installViewerCommandKeys(dispatchCommand), [dispatchCommand]);

  useEffect(() => {
    return () => {
      registryCleanupRef.current?.();
      registryCleanupRef.current = null;
      pdfSearchStore.getState().dispose();
    };
  }, []);

  useEffect(() => {
    pdfSearchStore.getState().attach(pdfium);
  }, [pdfium]);

  const initializePlugins = useCallback(async (nextRegistry: PluginRegistry) => {
    registryCleanupRef.current?.();
    registryCleanupRef.current = null;

    const nextScroll = new PdfScroll(nextRegistry, DOCUMENT_ID);
    setRegistry(nextRegistry);
    setPdfScroll(nextScroll);
    setOutlineCache({ status: 'idle', bookmarks: [] });
    setDocumentView(INITIAL_DOCUMENT_VIEW);
    dispatchViewerUi({ type: 'ui/reset' });
    resetViewerDiagnostics();
    pdfSearchStore.getState().clear();
    setDirty(false);

    const installers = [
      () => pdfium.bindRegistry(nextRegistry),
      () => nextScroll.installNavigationInput((delta, source) => {
        dispatchCommand({ type: 'navigation/move-pages', delta, source });
      }),
      () => installScrollAttribute(nextScroll),
      () => installAnnotationLinks(nextRegistry, platform.openExternal),
      () => installAnnotationPreview(nextRegistry, DOCUMENT_ID),
      () => installCommentEditor(nextRegistry, (annotationId) => {
        dispatchCommand({ type: 'ui/open-comments', annotationId, isNew: true });
      }),
      () => installAnnotationDirty(nextRegistry, () => setDirty(true)),
      () => installFormDirty(nextRegistry, () => setDirty(true)),
      () => installPlatformReadingHistory(nextRegistry, nextScroll, documentKey),
      () => installPageTracker(nextScroll, setDocumentView),
      () => installOutlinePrefetch(pdfium, {
        documentId: DOCUMENT_ID,
        scroll: nextScroll,
        cacheKey: documentKey,
        onLoaded: setOutlineCache,
      }),
    ];

    registryCleanupRef.current = installAll(installers);
  }, [dispatchCommand, documentKey, pdfium, setDirty]);

  const toolbarFeedback = {
    ...capabilityFeedback,
    documentId,
    searchOpen,
    thumbnailsOpen: sidePanel?.type === 'thumbnails',
    colorPaletteOpen: sidePanel?.type === 'colors',
    panMode,
    signatureCount: signatures.length,
    canSave: isDirty,
    canConfigureTheme: true,
    darkAppearance: isDarkViewerTheme(viewerTheme),
  };

  return (
    <main ref={viewerRootRef} className="fixed inset-0 overflow-hidden">
      <PdfSurface
        engine={engine}
        registry={registry}
        panMode={panMode}
        renderThemeVersion={renderThemeVersion}
        scroll={pdfScroll}
        documentResource={documentResource}
        onInitialized={initializePlugins}
        onResourceConsumed={onResourceConsumed}
        renderDpr={getEffectiveRenderDpr(dprMode)}
      />
      <Toolbar
        scroll={pdfScroll}
        feedback={toolbarFeedback}
        dispatch={dispatchCommand}
      />
      <Dialog
        open={documentPane !== null}
        onClose={closeOverlay}
        title={documentPane ? DOCUMENT_PANE_TITLES[documentPane] : 'PDF Document'}
      >
        {documentPane === 'thumbnails' ? (
          <Thumbnails
            registry={registry}
            documentId={documentId}
            dispatch={dispatchCommand}
            totalPages={totalPages}
            currentPageNumber={currentPageNumber}
          />
        ) : null}
        {documentPane === 'outline' ? (
          <Outline
            pdfium={pdfium}
            documentId={documentId}
            scroll={pdfScroll}
            cache={outlineCache}
            currentBookmarkKey={currentBookmarkKey}
            onCacheChange={setOutlineCache}
          />
        ) : null}
        {documentPane === 'comments' ? (
          <Comments
            engine={engine}
            registry={registry}
            documentId={documentId}
            scroll={pdfScroll}
            currentPageNumber={currentPageNumber}
            targetAnnotationId={commentTarget?.annotationId}
            targetAnnotationIsNew={commentTarget?.isNew}
          />
        ) : null}
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
        dispatch={dispatchCommand}
      />
      {translationRequest ? (
        <SelectionTranslate
          registry={registry}
          request={translationRequest}
          onClose={closeOverlay}
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
        pdfium={pdfium}
        onClose={closeOverlay}
      />
      <BottomNav
        dispatch={dispatchCommand}
        title={currentTitle}
        pageNumber={currentPageNumber}
        totalPages={totalPages}
        outlineStatus={outlineCache.status}
      />
    </main>
  );
}

function Welcome({
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
        aria-label="Choose or drop a PDF file"
        className={styles.welcomeCard}
        data-dragging={dragging ? 'true' : undefined}
        onClick={() => void openDocument()}
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
          event.stopPropagation();
          setDragging(false);
          void openDocument(event.dataTransfer.files[0]);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          void openDocument();
        }}
        role="button"
        tabIndex={0}
      >
        <img className="size-13.5" src="./icon.png" alt="" />
        <h1 className="mt-4.5 mb-0 text-[25px]">PDF.ts</h1>
        <p className="mt-3 mb-0 text-[13px] font-semibold text-muted">
          Click to choose or drop a PDF
        </p>
        {selectionError ? (
          <p className="mt-3 mb-0 text-xs text-danger" role="alert">
            {selectionError}
          </p>
        ) : null}
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
    writeStartupLogOnce('viewer-resources', 'Loading viewer resources');
    platform.loadViewerResources(BUNDLED_PDFIUM_WASM_URL).then((loaded) => {
      trackResource(loaded.wasm);
      trackResource(loaded.document?.resource);
      if (cancelled) {
        releaseResource(loaded.wasm);
        releaseResource(loaded.document?.resource);
      } else {
        writeStartupInfo(
          'Viewer resources ready',
          loaded.document ? 'PDF source attached' : 'waiting for a document',
        );
        setResources(loaded);
      }
    }).catch((reason: unknown) => {
      if (!cancelled) {
        const nextError = reason instanceof Error ? reason : new Error(String(reason));
        failStartupLog('Unable to load viewer resources', nextError.message);
        setError(nextError);
      }
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

  useEffect(() => {
    if (pdfium && platform.openLocalDocument && !resources.document) {
      completeStartupLog('Viewer ready', 'choose a PDF document');
    }
  }, [pdfium, resources.document]);

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

  if (platform.openLocalDocument && !resources.document) {
    const openLocalDocument = platform.openLocalDocument;
    const useDocument = (document: NonNullable<ViewerResources['document']>) => {
      beginStartupLog(`PDF.ts ${__PDF_TS_BUILD_INFO__}`);
      writeStartupInfo('Local document selected', document.name ?? 'PDF document');
      trackResource(document.resource);
      setResources({ ...resources, document });
    };
    return <Welcome
      onOpen={async (file) => {
        const document = await openLocalDocument(file);
        if (document) useDocument(document);
      }}
    />;
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

const disposeTheme = initializeViewerTheme();
const disposeDiagnostics = installErrorDiagnostics();
const disposeDpr = installRenderDprOverride();
writeStartupInfo('Viewer environment ready', navigator.platform || 'Web');

function ViewerLifecycle() {
  useEffect(() => () => {
    disposeDpr();
    disposeDiagnostics();
    disposeTheme();
  }, []);

  return (
    <TooltipProvider>
      <ViewerBootstrap />
    </TooltipProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <ViewerLifecycle />,
);
