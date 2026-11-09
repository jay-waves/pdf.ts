/**
 * Composition boundary for React, feature panels, themes and stage controls.
 * Keep feature wiring here; engine and renderer modules depend on capabilities
 * and data contracts, not this UI. Avoid compatibility re-exports and redundant
 * service layers around the SDK.
 */
import { useDocumentReplacement } from './use-document-replacement';
import { DraftNotice } from '../document/draft-notice';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { Kernel } from '@embedpdf/core';
import { KernelProvider, DocumentScope, DocumentGate } from '@embedpdf/react/runtime';
import { ScrollStrategy } from './viewer-stage';
import { getFileNameFromUrl } from '../shared/url';
import { Outline } from '../navigation/outline';
import { BottomNav } from '../navigation/bottom-navigation';
import { ViewerStage } from './viewer-stage';
import { installBrowserGestureZoomGuard } from '../renderer/stage-input-controller';
import { installStageNavigationInput, installViewerCommandKeys } from './viewer-input';
import { isDarkViewerTheme, viewerThemeStore } from '../theme/theme';
import { Toolbar, type ToolbarSnapshot } from '../toolbar/toolbar';
import { Thumbnails } from '../navigation/thumbnails';
import { ColorPalette } from '../annotations/color-palette';
import { installAnnotationDirty, installAnnotationLinks, initializeAnnotationPalette, installCommentEditor } from '../annotations/annotations';
import { CommentEditor } from '../annotations/comment-editor';
import { Comments } from '../annotations/comments';
import { PrintDialog } from '../document/print-dialog';
import { ExternalChangeDialog } from '../document/external-change-dialog';
import { ProtectDialog, UnlockDialog } from '../document/protection-dialogs';
import { ThemeDialog } from '../theme/theme-dialog';
import { DeveloperDialog } from './developer-dialog';
import { ContextMenu } from '../selection/context-menu';
import { Dialog } from '../components';
import { ViewerFocusContext } from '../components/viewer-focus';
import { exportPdf, savePdfCopy } from '../document/pdf-save';
import { useRenderThemeVersion } from './use-pdf-runtime';
import type { PdfRuntime } from '../engine/pdf-runtime';
import { useDocumentPersistence } from '../document/viewer-document-persistence';
import { SelectionTranslate } from '../selection/selection-translate';
import { installReadingHistory as installPlatformReadingHistory } from '../navigation/reading-history';
import { SignatureDialog, useDocumentSignatures } from '../document/signatures';
import { platform } from '#platform';
import type { ManagedResource, PlatformDocument } from '../platform/types';
import { PdfSurface } from './pdf-surface';
import { resetViewerDiagnostics } from '../renderer/viewer-diagnostics';
import { getEffectiveRenderDpr, renderSettingsStore } from '../renderer/render-settings';
import { DOCUMENT_ID } from '../document/viewer-document';
import { useViewerController } from './viewer-controller';
import { viewerControls } from '../components/control-visibility';

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


interface AppProps {
  pdfium: PdfRuntime;
  sourceDocument?: PlatformDocument;
  onResourceConsumed(resource?: ManagedResource): void;
}

type ViewerSession = Readonly<{
  registry: Kernel;
  stage: ViewerStage;
}>;

type DocumentPane = 'outline' | 'thumbnails' | 'comments';
const DOCUMENT_PANE_TITLES: Record<DocumentPane, string> = {
  thumbnails: 'PDF Thumbnails',
  outline: 'PDF Outline',
  comments: 'PDF Comments',
};


export function ViewerApp({
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
  const renderDpr = useStore(renderSettingsStore, (state) => (
    getEffectiveRenderDpr(state.dprMode, state.systemDpr)
  ));
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
    stageSnapshot,
  } = useViewerController({
    registry,
    documentId,
    stage,
    saveDocument: () => void saveDocument(),
    exportDocument: () => {
      void exportPdf(registry, documentId, resolvedDocumentName ?? 'document.pdf').catch((error) => {
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
      viewerControls.show();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [presentationPage, totalPages]);
  const { panMode, toolbarSection } = uiSnapshot;
  const sidePanel = uiSnapshot.overlay?.type === 'side-panel' ? uiSnapshot.overlay.panel : null;
  const activeDialog = uiSnapshot.overlay?.type === 'dialog' ? uiSnapshot.overlay.dialog : null;
  const translationRequest = uiSnapshot.overlay?.type === 'translation'
    ? uiSnapshot.overlay.request
    : null;
  const commentTarget = uiSnapshot.overlay?.type === 'comment-editor' ? uiSnapshot.overlay : null;
  const documentPane: DocumentPane | null = sidePanel && sidePanel.type !== 'colors' ? sidePanel.type : null;
  const viewerRootRef = useRef<HTMLElement>(null);
  const sessionCleanupRef = useRef<(() => void) | null>(null);
  const closeOverlay = useCallback(() => {
    dispatchCommand({ type: 'ui/close-overlay' });
  }, [dispatchCommand]);

  const navigatePresentation = useCallback((delta: -1 | 1) => {
    dispatchCommand({ type: 'navigation/move-pages', delta });
  }, [dispatchCommand]);

  useEffect(() => {
    if (presentationPage === null) delete document.documentElement.dataset.viewerPresentation;
    else document.documentElement.dataset.viewerPresentation = 'true';
    return () => { delete document.documentElement.dataset.viewerPresentation; };
  }, [presentationPage]);


  const activateDocument = useCallback((
    nextRegistry: Kernel,
    nextStage = new ViewerStage(nextRegistry, DOCUMENT_ID),
    stagedCleanup?: () => void,
  ) => {
    sessionCleanupRef.current?.();
    sessionCleanupRef.current = null;
    const nextDocumentId = nextStage.documentId;
    dispatchCommand({ type: stagedCleanup ? 'ui/close-overlay' : 'ui/reset' });
    resetViewerDiagnostics();
    setDirty(false);
    initializeAnnotationPalette(nextRegistry, nextDocumentId);

    const installers = [
      () => stagedCleanup ?? nextStage.install(),
      () => installStageNavigationInput(nextStage, dispatchCommand),
      () => installScrollAttribute(nextStage),
      () => nextRegistry.documents.onOpened(({ documentId }) => initializeAnnotationPalette(nextRegistry, documentId)),
      () => installAnnotationLinks(nextRegistry, platform.openExternal),
      () => installCommentEditor(nextRegistry, (annotationId) => {
        dispatchCommand({ type: 'ui/open-comments', annotationId });
      }),
      () => installAnnotationDirty(nextRegistry, () => setDirty(true)),
      () => installPlatformReadingHistory(nextStage, documentKey, !stagedCleanup),
    ];

    sessionCleanupRef.current = installAll(installers);
    setSession({ registry: nextRegistry, stage: nextStage });
  }, [dispatchCommand, documentKey, setDirty]);

  const initializePlugins = useCallback(async (nextRegistry: Kernel) => {
    activateDocument(nextRegistry);
  }, [activateDocument]);

  const {
    currentResource, pendingDocument, reloadPasswordId, reloadFailure, externalChange,
    reloadExternalDocument, handleExternalChange, cancelReload,
  } = useDocumentReplacement({
    registry, stage, documentId, sourceDocument, resolvedDocumentName,
    viewerRootRef, hasUnsavedChanges, activateDocument, onResourceConsumed, closeOverlay,
  });

  useEffect(() => {
    return () => {
      sessionCleanupRef.current?.();
      sessionCleanupRef.current = null;
    };
  }, []);

  useEffect(() => pendingDocument ? undefined : installViewerCommandKeys(dispatchCommand), [dispatchCommand, pendingDocument]);

  const toolbarSnapshot: ToolbarSnapshot = {
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
    <main data-draft-status={draft.draftStatus} ref={viewerRootRef} inert={pendingDocument !== null} className="fixed inset-0 overflow-hidden">
      <DraftNotice key={documentId} draft={draft} dirty={isDirty} engine={engine} documentId={documentId} name={resolvedDocumentName ?? 'document.pdf'} />
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
      {registry && documentId ? <KernelProvider kernel={registry}>
      <DocumentScope key={documentId} id={documentId}>
      <DocumentGate fallback={null}>
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
          <Outline />
        ) : null}
        {documentPane === 'comments' ? (
          <Comments
            registry={registry}
            documentId={documentId}
            stage={stage}
            currentPageNumber={currentPageNumber}
          />
        ) : null}
      </Dialog>
      <ColorPalette
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
        incorrect={false} onCancel={cancelReload} /> : null}
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
          const name = await savePdfCopy(registry, documentId, fileHandle);
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
        pageNumber={currentPageNumber}
        totalPages={totalPages}
      />
      </DocumentGate>
      </DocumentScope>
      </KernelProvider> : null}
    </main>
    </ViewerFocusContext.Provider>
  );
}
