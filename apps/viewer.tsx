import { DraftNotice } from './document/draft-notice';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { nextDocumentFrame, waitForDocumentPaint } from './renderer/document-paint';
import { useStore } from 'zustand';
import type { PluginRegistry } from '@embedpdf/core';
import { PdfErrorCode } from '@embedpdf/models';
import pdfiumWasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import type { FormCapability } from '@embedpdf/plugin-form';
import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import type { RotateCapability } from '@embedpdf/plugin-rotate';
import type { ZoomCapability } from '@embedpdf/plugin-zoom';
import { ScrollStrategy } from '@embedpdf/plugin-scroll/react';
import './viewer.css';
import { getPluginCapability } from './shared/utils';
import { getFileNameFromUrl } from './shared/url';
import {
  Outline,
  getCurrentBookmark,
  installOutlinePrefetch,
  type OutlineCache,
} from './navigation/outline';
import { BottomNav } from './navigation/bottom-navigation';
import { pdfSearchStore } from './search/pdf-search';
import { ViewerStage } from './viewer/viewer-stage';
import { installBrowserGestureZoomGuard } from './renderer/stage-input-controller';
import { installStageNavigationInput, installViewerCommandKeys } from './viewer/viewer-input';
import {
  initializeViewerTheme,
  isDarkViewerTheme,
  viewerThemeStore,
} from './theme/theme';
import { Toolbar, type ToolbarSnapshot } from './toolbar/toolbar';
import { Thumbnails } from './navigation/thumbnails';
import { ColorPalette } from './annotations/color-palette';
import {
  installAnnotationDirty,
  installAnnotationLinks,
  initializeAnnotationPalette,
  installCommentEditor,
} from './annotations/annotations';
import { CommentEditor } from './annotations/comment-editor';
import { Comments } from './annotations/comments';
import { PrintDialog } from './document/print-dialog';
import { ExternalChangeDialog } from './document/external-change-dialog';
import { ProtectDialog, UnlockDialog } from './document/protection-dialogs';
import { ThemeDialog } from './theme/theme-dialog';
import { DeveloperDialog } from './viewer/developer-dialog';
import { ContextMenu } from './selection/context-menu';
import { Dialog, TooltipProvider } from './components';
import { ViewerFocusContext } from './components/viewer-focus';
import { exportPdf, savePdfCopy } from './document/pdf-save';
import { usePdfRuntime, useRenderThemeVersion, type PdfRuntime } from './renderer/pdf-engine';
import { useDocumentPersistence } from './document/viewer-document-persistence';
import { SelectionTranslate } from './selection/selection-translate';
import { installReadingHistory as installPlatformReadingHistory } from './navigation/reading-history';
import {
  SignatureDialog,
  useDocumentSignatures,
} from './document/signatures';
import { platform } from '#platform';
import type {
  ExternalDocumentChange,
  ManagedResource,
  PlatformDocument,
  ViewerResources,
} from './platform/types';
import {
  LoadingStatus,
  PdfSurface,
  RENDER_IMAGE_TYPE,
  VIEWER_STATUS_CLASS,
} from './viewer/pdf-surface';
import styles from './viewer/viewer.module.css';
import {
  installErrorDiagnostics,
  resetViewerDiagnostics,
} from './renderer/viewer-diagnostics';
import {
  getEffectiveRenderDpr,
  installRenderDprMonitor,
  renderSettingsStore,
} from './renderer/render-settings';
import { DOCUMENT_ID } from './document/viewer-document';
import { useViewerController } from './viewer/viewer-controller';
import { PDFIUM_FONT_FALLBACK } from './fonts';
import { viewerActivity, type ViewerInputSource } from './viewer/viewer-activity';
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

function installScrollAttribute(stage: ViewerStage) {
  const sync = (strategy = stage.getSnapshot().strategy) => {
    document.documentElement.dataset.pdfScrollStrategy = (
      strategy === ScrollStrategy.Horizontal ? 'horizontal' : 'vertical'
    );
  };

  sync();
  return stage.onStrategyChange(sync);
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

type ViewerSession = Readonly<{
  registry: PluginRegistry;
  stage: ViewerStage;
}>;

type DocumentPane = 'outline' | 'thumbnails' | 'comments';
const DOCUMENT_PANE_TITLES: Record<DocumentPane, string> = {
  thumbnails: 'PDF Thumbnails',
  outline: 'PDF Outline',
  comments: 'PDF Comments',
};


function App({
  pdfium,
  sourceDocument,
  onResourceConsumed,
}: AppProps) {
  const engine = pdfium.engine;
  useEffect(() => installBrowserGestureZoomGuard(), []);
  const {
    resource: documentResource,
    key: documentKey,
    name: documentName,
    fileHandle,
  } = sourceDocument ?? {};
  const fileUrl = documentResource?.url;
  const resolvedDocumentName = documentName ?? (fileUrl ? getFileNameFromUrl(fileUrl) : undefined);
  const [session, setSession] = useState<ViewerSession | null>(null);
  const documentId = session?.stage.documentId ?? (fileUrl ? DOCUMENT_ID : null);
  const [currentResource, setCurrentResource] = useState(documentResource);
  const [pendingDocument, setPendingDocument] = useState<{
    documentId: string; stage: ViewerStage; presentationPage: number | null;
  } | null>(null);
  const renderDpr = useStore(renderSettingsStore, (state) => (
    getEffectiveRenderDpr(state.dprMode, state.systemDpr)
  ));
  const [outlineCache, setOutlineCache] = useState<OutlineCache>({
    status: 'idle',
    bookmarks: [],
  });
  const registry = session?.registry;
  const stage = session?.stage ?? null;
  const signatures = useDocumentSignatures(engine, registry, documentId);
  const renderThemeVersion = useRenderThemeVersion(engine);
  const viewerTheme = useStore(viewerThemeStore, (state) => state.theme);
  const { isDirty, draft, saveDocument, setDirty, hasUnsavedChanges } = useDocumentPersistence({
    engine,
    registry,
    documentId,
    fileHandle,
    title: resolvedDocumentName ?? 'PDF',
  });
  const {
    dispatch: dispatchCommand,
    uiSnapshot,
    capabilitySnapshot,
    stageSnapshot,
  } = useViewerController({
    registry,
    documentId,
    stage,
    saveDocument: () => void saveDocument(),
    exportDocument: () => {
      void exportPdf(engine, registry, documentId, resolvedDocumentName ?? 'document.pdf').catch((error) => {
        console.error('[pdf-ts] failed to export PDF', error);
      });
    },
  });
  const { pageNumber: currentPageNumber, totalPages } = stageSnapshot;
  const presentationPage = stageSnapshot.mode === 'presentation' ? stageSnapshot.pageNumber : null;
  const controlsDiscoveredRef = useRef(false);
  useEffect(() => {
    if (totalPages <= 0 || presentationPage !== null || controlsDiscoveredRef.current) return;
    // Defer until both controls have subscribed, including under StrictMode.
    const timer = window.setTimeout(() => {
      controlsDiscoveredRef.current = true;
      viewerActivity.pulse('Mouse', ['Discovery']);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [presentationPage, totalPages]);
  const { panMode, toolbarSection } = uiSnapshot;
  const sidePanel = uiSnapshot.overlay?.type === 'side-panel' ? uiSnapshot.overlay.panel : null;
  const activeDialog = uiSnapshot.overlay?.type === 'dialog' ? uiSnapshot.overlay.dialog : null;
  const translationRequest = uiSnapshot.overlay?.type === 'translation'
    ? uiSnapshot.overlay.request
    : null;
  const currentBookmark = useMemo(
    () => getCurrentBookmark(outlineCache.bookmarks, currentPageNumber),
    [currentPageNumber, outlineCache.bookmarks],
  );
  const currentBookmarkKey = currentBookmark?.key ?? '';
  const currentTitle = currentBookmark?.title ?? '';
  const commentTarget = uiSnapshot.overlay?.type === 'comment-editor' ? uiSnapshot.overlay : null;
  const documentPane: DocumentPane | null = sidePanel && sidePanel.type !== 'colors' ? sidePanel.type : null;
  const viewerRootRef = useRef<HTMLElement>(null);
  const sessionCleanupRef = useRef<(() => void) | null>(null);
  const reloadInProgressRef = useRef(false);
  const [reloadRunning, setReloadRunning] = useState(false);
  const reloadAbortRef = useRef<AbortController | null>(null);
  const queuedChangeRef = useRef<ExternalDocumentChange | null>(null);
  const [reloadFailure, setReloadFailure] = useState<{ change: ExternalDocumentChange; message: string } | null>(null);
  const [reloadPasswordId, setReloadPasswordId] = useState<string | null>(null);
  const [externalChange, setExternalChange] = useState<ExternalDocumentChange | null>(null);
  const closeOverlay = useCallback(() => {
    dispatchCommand({ type: 'ui/close-overlay' });
  }, [dispatchCommand]);

  const navigatePresentation = useCallback((delta: -1 | 1, source: ViewerInputSource) => {
    dispatchCommand({ type: 'navigation/move-pages', delta, source });
  }, [dispatchCommand]);

  useEffect(() => {
    if (presentationPage === null) delete document.documentElement.dataset.viewerPresentation;
    else document.documentElement.dataset.viewerPresentation = 'true';
    return () => { delete document.documentElement.dataset.viewerPresentation; };
  }, [presentationPage]);

  useEffect(() => pendingDocument ? undefined : installViewerCommandKeys(dispatchCommand), [dispatchCommand, pendingDocument]);

  useEffect(() => {
    return () => {
      reloadAbortRef.current?.abort();
      sessionCleanupRef.current?.();
      sessionCleanupRef.current = null;
      pdfSearchStore.getState().dispose();
    };
  }, []);

  useEffect(() => {
    pdfSearchStore.getState().attach(pdfium);
  }, [pdfium]);

  const activateDocument = useCallback((
    nextRegistry: PluginRegistry,
    nextStage = new ViewerStage(nextRegistry, DOCUMENT_ID),
    stagedCleanup?: () => void,
  ) => {
    sessionCleanupRef.current?.();
    sessionCleanupRef.current = null;
    const nextDocumentId = nextStage.documentId;
    setOutlineCache({ status: 'idle', bookmarks: [] });
    dispatchCommand({ type: stagedCleanup ? 'ui/close-overlay' : 'ui/reset' });
    resetViewerDiagnostics();
    pdfSearchStore.getState().clear();
    setDirty(false);
    initializeAnnotationPalette(nextRegistry, nextDocumentId);

    const installers = [
      () => pdfium.bindRegistry(nextRegistry),
      () => stagedCleanup ?? nextStage.install(),
      () => installStageNavigationInput(nextStage, dispatchCommand),
      () => installScrollAttribute(nextStage),
      () => installAnnotationLinks(nextRegistry, platform.openExternal),
      () => installCommentEditor(nextRegistry, (annotationId) => {
        dispatchCommand({ type: 'ui/open-comments', annotationId });
      }),
      () => installAnnotationDirty(nextRegistry, () => setDirty(true)),
      () => installFormDirty(nextRegistry, () => setDirty(true)),
      () => installPlatformReadingHistory(nextStage, documentKey, !stagedCleanup),
      () => installOutlinePrefetch(pdfium, {
        documentId: nextDocumentId,
        stage: nextStage,
        cacheKey: documentKey,
        refresh: !!stagedCleanup,
        onLoaded: setOutlineCache,
      }),
    ];

    sessionCleanupRef.current = installAll(installers);
    setSession({ registry: nextRegistry, stage: nextStage });
  }, [dispatchCommand, documentKey, pdfium, setDirty]);

  const initializePlugins = useCallback(async (nextRegistry: PluginRegistry) => {
    activateDocument(nextRegistry);
  }, [activateDocument]);

  const reloadExternalDocument = useCallback(async (change: ExternalDocumentChange) => {
    if (!registry || !stage || !documentId) return;
    if (reloadInProgressRef.current) { queuedChangeRef.current = change; return; }
    const manager = getPluginCapability<DocumentManagerCapability>(registry, 'document-manager');
    if (!manager?.isDocumentOpen(documentId)) return;

    reloadInProgressRef.current = true;
    setReloadRunning(true);
    const controller = new AbortController();
    reloadAbortRef.current = controller;
    const { signal } = controller;
    const discardConfirmed = hasUnsavedChanges();
    let replacementId: string | undefined;
    let stagedCleanup: (() => void) | undefined;
    let committed = false;
    setReloadFailure(null);
    try {
      // EmbedPDF owns loading, IDs, document state and native handle lifetime.
      // Keep the old document active until the replacement has actually painted.
      const opened = await manager.openDocumentUrl({
        url: change.resource.url,
        name: resolvedDocumentName ?? 'document.pdf',
        autoActivate: false,
        mode: 'full-fetch',
      }).toPromise();
      replacementId = opened.documentId;
      try {
        await opened.task.toPromise();
      } catch (error) {
        if (manager.getDocumentState(replacementId)?.errorCode !== PdfErrorCode.Password) throw error;
        // Retry through the SDK's password flow without removing the old view.
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => { unsubscribe(); signal.removeEventListener('abort', abort); };
          const abort = () => { cleanup(); reject(new DOMException('Reload cancelled.', 'AbortError')); };
          const unsubscribe = manager.onDocumentOpened((state) => {
            if (state.id === replacementId) { cleanup(); resolve(); }
          });
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort(); else setReloadPasswordId(replacementId!);
        });
        setReloadPasswordId(null);
      }
      signal.throwIfAborted();
      if (!discardConfirmed && hasUnsavedChanges()) {
        setExternalChange(change);
        return;
      }
      const snapshot = stage.getSnapshot();
      const readingPosition = stage.captureReadingPosition();
      const zoomLevel = getPluginCapability<ZoomCapability>(registry, 'zoom')
        ?.forDocument(documentId).getState().zoomLevel;
      const rotation = getPluginCapability<RotateCapability>(registry, 'rotate')
        ?.forDocument(documentId).getRotation();
      const nextStage = new ViewerStage(registry, replacementId);
      stagedCleanup = nextStage.install();
      const nextPage = Math.min(snapshot.pageNumber, manager.getDocument(replacementId)!.pageCount);
      flushSync(() => setPendingDocument({
        documentId: replacementId!, stage: nextStage,
        presentationPage: snapshot.mode === 'presentation' ? nextPage : null,
      }));
      await nextDocumentFrame(signal);
      nextStage.applyLayout(snapshot.strategy, snapshot.spread);
      if (rotation !== undefined) {
        getPluginCapability<RotateCapability>(registry, 'rotate')?.forDocument(replacementId).setRotation(rotation);
      }
      if (zoomLevel !== undefined) nextStage.setZoom(zoomLevel);
      await nextDocumentFrame(signal);
      await nextDocumentFrame(signal);
      if (snapshot.mode === 'presentation') {
        nextStage.setPresentation(true);
        nextStage.goToPage(nextPage);
      } else {
        nextStage.restoreReadingPosition(readingPosition);
      }
      await waitForDocumentPaint(viewerRootRef.current!, replacementId, signal);
      signal.throwIfAborted();
      if (!discardConfirmed && hasUnsavedChanges()) {
        setExternalChange(change);
        return;
      }
      flushSync(() => {
        manager.setActiveDocument(replacementId!);
        activateDocument(registry, nextStage, stagedCleanup);
        setPendingDocument(null);
        setCurrentResource(change.resource);
        setExternalChange(null);
      });
      stagedCleanup = undefined; // Active session now owns its cleanup.
      committed = true;
      change.accept();
      onResourceConsumed(change.resource);
      await manager.closeDocument(documentId).toPromise();
    } finally {
      if (!committed) {
        stagedCleanup?.();
        setPendingDocument(null);
        if (replacementId && manager.isDocumentOpen(replacementId)) {
          await manager.closeDocument(replacementId).toPromise();
        }
      }
      if (reloadAbortRef.current === controller) reloadAbortRef.current = null;
      reloadInProgressRef.current = false;
      setReloadPasswordId(null);
      setReloadRunning(false);
    }
  }, [activateDocument, documentId, hasUnsavedChanges, onResourceConsumed, registry, resolvedDocumentName, stage]);

  const handleExternalChange = useCallback((change: ExternalDocumentChange) => {
    if (reloadInProgressRef.current) { queuedChangeRef.current = change; return; }
    if (hasUnsavedChanges()) {
      dispatchCommand({ type: 'ui/close-overlay' });
      setExternalChange(change);
      return;
    }
    void reloadExternalDocument(change).catch((error) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error('[pdf-ts] failed to reload externally updated PDF', error);
      setReloadFailure({ change, message: 'Could not load the updated PDF. The current version is still open.' });
    });
  }, [dispatchCommand, hasUnsavedChanges, reloadExternalDocument]);

  useEffect(() => sourceDocument?.watchForChanges?.(handleExternalChange), [handleExternalChange, sourceDocument]);
  useEffect(() => {
    if (reloadInProgressRef.current || !queuedChangeRef.current) return;
    const change = queuedChangeRef.current;
    queuedChangeRef.current = null;
    handleExternalChange(change);
  }, [handleExternalChange, reloadRunning]);

  const toolbarSnapshot: ToolbarSnapshot = {
    ...capabilitySnapshot,
    section: toolbarSection,
    documentId,
    thumbnailsOpen: sidePanel?.type === 'thumbnails',
    panMode,
    signatureCount: signatures.length,
    canSave: isDirty,
    canPresent: totalPages > 0,
    darkAppearance: isDarkViewerTheme(viewerTheme),
  };

  return (
    <ViewerFocusContext.Provider value={stage ? () => stage.focusViewportAfterAction() : null}>
    <main ref={viewerRootRef} inert={pendingDocument !== null} className="fixed inset-0 overflow-hidden">
      <DraftNotice draft={draft} dirty={isDirty} engine={engine} documentId={documentId} name={resolvedDocumentName ?? 'document.pdf'} />
      <PdfSurface
        engine={engine}
        registry={registry}
        pendingDocument={pendingDocument}
        panMode={panMode}
        renderThemeVersion={renderThemeVersion}
        stage={stage}
        documentResource={documentResource}
        onInitialized={initializePlugins}
        onResourceConsumed={onResourceConsumed}
        renderDpr={renderDpr}
        presentationPage={presentationPage}
        onNavigatePresentation={navigatePresentation}
        onExitPresentation={() => dispatchCommand({ type: 'view/set-presentation', enabled: false })}
      />
      {presentationPage === null ? <Toolbar
        stage={stage}
        snapshot={toolbarSnapshot}
        dispatch={dispatchCommand}
      /> : null}
      <Dialog
        open={documentPane !== null}
        variant="flatPanel"
        contentClassName={documentPane === 'thumbnails' || documentPane === 'outline' ? 'pdf-navigation-panel' : ''}
        overlayClassName={documentPane === 'thumbnails' || documentPane === 'outline' ? 'pdf-navigation-overlay' : ''}
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
            stage={stage}
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
            stage={stage}
            currentPageNumber={currentPageNumber}
          />
        ) : null}
      </Dialog>
      <ColorPalette
        registry={registry}
        documentId={documentId}
        open={sidePanel?.type === 'colors'}
        onClose={closeOverlay}
      />
      {commentTarget && registry && documentId ? (
        <CommentEditor
          key={`${documentId}:${commentTarget.annotationId}`}
          registry={registry}
          documentId={documentId}
          annotationId={commentTarget.annotationId}
          pointerX={commentTarget.pointerX}
          onClose={closeOverlay}
        />
      ) : null}
      <ContextMenu
        engine={engine}
        registry={registry}
        documentId={documentId}
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
      {reloadPasswordId ? <UnlockDialog registry={registry} documentId={reloadPasswordId}
        incorrect={false} onCancel={() => reloadAbortRef.current?.abort()} /> : null}
      {reloadFailure ? <div role="alert" className="fixed bottom-16 left-1/2 z-50 -translate-x-1/2 rounded bg-surface p-3 text-xs shadow">
        {reloadFailure.message}{' '}
        <button type="button" onClick={() => handleExternalChange(reloadFailure.change)}>Retry</button>
      </div> : null}
      <ExternalChangeDialog
        open={externalChange !== null}
        onDiscard={async () => {
          if (externalChange) await reloadExternalDocument(externalChange);
        }}
        onSaveCopy={async () => {
          if (!externalChange) return;
          const name = await savePdfCopy(engine, registry, documentId, fileHandle);
          if (!name) throw new Error('Saving a copy is not available.');
          await reloadExternalDocument(externalChange);
          window.alert(`Your changes were saved as:\n${name}`);
        }}
      />
      <ProtectDialog
        registry={registry}
        documentId={documentId}
        open={activeDialog === 'protect'}
        onClose={closeOverlay}
        onProtectionChanged={() => setDirty(true)}
      />
      <SignatureDialog
        signatures={signatures}
        resource={currentResource}
        open={activeDialog === 'signatures'}
        onClose={closeOverlay}
      />
      <ThemeDialog
        open={activeDialog === 'theme'}
        onClose={closeOverlay}
      />
      <DeveloperDialog
        registry={registry}
        documentId={documentId}
        fileName={resolvedDocumentName}
        pageCount={totalPages}
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
    </ViewerFocusContext.Provider>
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
    <main className={styles.welcome}>
      <section
        aria-label="Choose or drop a PDF file"
        className={`pdf-glass-surface ${styles.welcomeCard}`}
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
        <img className="size-13.5" src="./logo.png" alt="" />
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
const disposeDpr = installRenderDprMonitor();
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
