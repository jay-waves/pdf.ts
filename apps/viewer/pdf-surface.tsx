import { memo, useEffect, useMemo } from 'react';
import { createPluginRegistration, type PluginRegistry } from '@embedpdf/core';
import { EmbedPDF } from '@embedpdf/core/react';
import { PdfErrorCode, Rotation, type PdfEngine } from '@embedpdf/models';
import { AnnotationLayer, AnnotationPluginPackage } from '@embedpdf/plugin-annotation/react';
import { DocumentContent, DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager/react';
import { FormPluginPackage } from '@embedpdf/plugin-form/react';
import { HistoryPluginPackage } from '@embedpdf/plugin-history/react';
import {
  GlobalPointerProvider,
  InteractionManagerPluginPackage,
  PagePointerProvider,
} from '@embedpdf/plugin-interaction-manager/react';
import { RenderPluginPackage } from '@embedpdf/plugin-render/react';
import { Rotate, RotatePluginPackage } from '@embedpdf/plugin-rotate/react';
import { Scroller, ScrollPluginPackage, ScrollStrategy } from '@embedpdf/plugin-scroll/react';
import { SelectionLayer, SelectionPluginPackage } from '@embedpdf/plugin-selection/react';
import { SpreadMode, SpreadPluginPackage } from '@embedpdf/plugin-spread/react';
import { TilingPluginPackage } from '@embedpdf/plugin-tiling/react';
import { ViewportPluginPackage } from '@embedpdf/plugin-viewport/react';
import { ZoomMode, ZoomPluginPackage } from '@embedpdf/plugin-zoom/react';
import { createAnnotationPluginConfig } from '../annotations/annotations';
import { UnlockDialog } from '../document/protection-dialogs';
import { signatureWidgetRenderer } from '../document/signatures';
import {
  themeAnnotationColorRenderer,
  themeCommentRenderer,
  themeHighlightRenderer,
  themeStrikeoutRenderer,
  themeUnderlineRenderer,
} from '../annotations/theme-renderers';
import type { ManagedResource } from '../platform/types';
import type { ViewerStage } from './viewer-stage';
import { SearchLayer } from '../search/search';
import { StageViewport } from '../renderer/stage-viewport';
import { StageSurface } from '../renderer/stage-surface';
import { PDF_TILE_SIZE_CSS_PX } from '../renderer/render-settings';
import { RenderLayer } from '../renderer/viewer-render-layers';
import { DOCUMENT_ID } from '../document/viewer-document';
import './pdf-surface.css';
import styles from './viewer.module.css';
import { completeStartupLog, failStartupLog, writeStartupLogOnce } from './startup-log';
import { PresentationView } from './presentation-view';

export const RENDER_IMAGE_TYPE = 'image/bmp';
const TILING_OVERLAP_PX = 2;
const TILING_EXTRA_RINGS = 0;
export const VIEWER_STATUS_CLASS = 'grid size-full place-items-center bg-app text-xs text-secondary';
const ANNOTATION_RENDERERS = [
  themeHighlightRenderer,
  themeUnderlineRenderer,
  themeStrikeoutRenderer,
  themeCommentRenderer,
  signatureWidgetRenderer,
];

function StartupDocumentStatus({
  status,
  pageCount,
  errorCode,
}: {
  status: 'loading' | 'loaded' | 'error';
  pageCount?: number;
  errorCode?: PdfErrorCode;
}) {
  useEffect(() => {
    if (status === 'loading') {
      writeStartupLogOnce('document-loading', 'Opening PDF document');
    } else if (status === 'loaded') {
      writeStartupLogOnce(
        'document-opened',
        'Document opened',
        pageCount ? `${pageCount} pages` : undefined,
      );
    } else if (errorCode === PdfErrorCode.Password) {
      completeStartupLog('Document requires a password');
    } else {
      failStartupLog('Unable to open PDF document');
    }
  }, [errorCode, pageCount, status]);
  return null;
}

export function LoadingStatus({ label }: { label: string }) {
  return (
    <div className={VIEWER_STATUS_CLASS} role="status" aria-live="polite">
      <div className={styles.loadingStatus}>
        <span className={styles.loadingSpinner} aria-hidden="true" />
        <span>{label}</span>
      </div>
    </div>
  );
}

function createPlugins(fileUrl?: string) {
  return [
    createPluginRegistration(DocumentManagerPluginPackage, {
      maxDocuments: 1,
      initialDocuments: fileUrl ? [{ url: fileUrl, documentId: DOCUMENT_ID }] : [],
    }),
    createPluginRegistration(ViewportPluginPackage, { viewportGap: 10 }),
    createPluginRegistration(ScrollPluginPackage, {
      defaultStrategy: ScrollStrategy.Vertical,
      defaultPageGap: 10,
      defaultBufferSize: 2,
    }),
    createPluginRegistration(RenderPluginPackage, { defaultImageType: RENDER_IMAGE_TYPE }),
    createPluginRegistration(TilingPluginPackage, {
      defaultImageType: RENDER_IMAGE_TYPE,
      tileSize: PDF_TILE_SIZE_CSS_PX,
      overlapPx: TILING_OVERLAP_PX,
      extraRings: TILING_EXTRA_RINGS,
    }),
    createPluginRegistration(ZoomPluginPackage, { defaultZoomLevel: ZoomMode.FitPage }),
    createPluginRegistration(SpreadPluginPackage, { defaultSpreadMode: SpreadMode.None }),
    createPluginRegistration(RotatePluginPackage, { defaultRotation: Rotation.Degree0 }),
    createPluginRegistration(InteractionManagerPluginPackage),
    createPluginRegistration(SelectionPluginPackage, { maxCachedGeometries: 8 }),
    createPluginRegistration(
      AnnotationPluginPackage,
      createAnnotationPluginConfig(),
    ),
    createPluginRegistration(HistoryPluginPackage),
    createPluginRegistration(FormPluginPackage),
  ];
}

function PageSurface({
  documentId,
  pageIndex,
  width,
  height,
  renderThemeVersion,
  renderDpr,
}: {
  documentId: string;
  pageIndex: number;
  width: number;
  height: number;
  renderThemeVersion: number;
  renderDpr: number;
}) {
  return (
    <Rotate documentId={documentId} pageIndex={pageIndex}>
      <PagePointerProvider
        documentId={documentId}
        pageIndex={pageIndex}
        data-pdf-page-index={pageIndex}
        className="pdf-page-surface"
        style={{
          position: 'relative',
          width,
          height,
          backgroundColor: 'var(--pdf-page-background)',
        }}
      >
        <RenderLayer
          key={`render-${renderThemeVersion}`}
          documentId={documentId}
          pageIndex={pageIndex}
          dpr={renderDpr}
          baseScale={0.5}
        />
        <SearchLayer
          documentId={documentId}
          pageIndex={pageIndex}
        />
        <div className="pdf-text-selection-layer">
          <SelectionLayer
            documentId={documentId}
            pageIndex={pageIndex}
            background="var(--pdf-text-selection-color)"
          />
        </div>
        <AnnotationLayer
          className="pdf-annotation-layer"
          documentId={documentId}
          pageIndex={pageIndex}
          annotationRenderers={ANNOTATION_RENDERERS}
          customAnnotationRenderer={themeAnnotationColorRenderer}
          selectionOutline={{ color: 'var(--pdf-accent-primary)' }}
          groupSelectionOutline={{ color: 'var(--pdf-accent-primary)' }}
          resizeUI={{ color: 'var(--pdf-accent-primary)' }}
          vertexUI={{ color: 'var(--pdf-accent-primary)' }}
          rotationUI={{
            color: 'var(--pdf-background-surface)',
            border: { color: 'var(--pdf-accent-primary)' },
            connectorColor: 'var(--pdf-accent-primary)',
            iconColor: 'var(--pdf-accent-primary)',
          }}
        />
      </PagePointerProvider>
    </Rotate>
  );
}

function LoadedPdfDocument({
  documentId,
  panMode,
  renderThemeVersion,
  stage,
  resource,
  onResourceConsumed,
  renderDpr,
  presentationPage,
  onNavigatePresentation,
  onExitPresentation,
}: {
  documentId: string;
  panMode: boolean;
  renderThemeVersion: number;
  stage?: ViewerStage | null;
  resource?: ManagedResource;
  onResourceConsumed(resource?: ManagedResource): void;
  renderDpr: number;
  presentationPage: number | null;
  onNavigatePresentation(delta: -1 | 1, source: 'Mouse'): void;
  onExitPresentation(): void;
}) {
  useEffect(() => onResourceConsumed(resource), [onResourceConsumed, resource]);

  return (
    <GlobalPointerProvider documentId={documentId}>
      <StageViewport
        documentId={documentId}
        stage={stage}
        className={`viewer${panMode ? ' is-pan-mode' : ''}`}
        inert={presentationPage !== null}
        aria-hidden={presentationPage !== null}
        onDragStart={(event) => event.preventDefault()}
      >
        {presentationPage === null ? <StageSurface documentId={documentId} panMode={panMode} stage={stage} /> : null}
        <Scroller
          documentId={documentId}
          className="pdf-scroller"
          renderPage={({ pageIndex, width, height }) => (
            <PageSurface
              documentId={documentId}
              pageIndex={pageIndex}
              width={width}
              height={height}
              renderThemeVersion={renderThemeVersion}
              renderDpr={renderDpr}
            />
          )}
        />
      </StageViewport>
      {presentationPage !== null ? (
        <PresentationView
          documentId={documentId}
          pageNumber={presentationPage}
          renderDpr={renderDpr}
          onNavigate={onNavigatePresentation}
          onExit={onExitPresentation}
        />
      ) : null}
    </GlobalPointerProvider>
  );
}

export const PdfSurface = memo(function PdfSurface({
  engine,
  registry,
  panMode,
  renderThemeVersion,
  stage,
  documentResource,
  onInitialized,
  onResourceConsumed,
  renderDpr,
  presentationPage,
  onNavigatePresentation,
  onExitPresentation,
}: {
  engine: PdfEngine<Blob>;
  registry?: PluginRegistry;
  panMode: boolean;
  renderThemeVersion: number;
  stage?: ViewerStage | null;
  documentResource?: ManagedResource;
  onInitialized(registry: PluginRegistry): Promise<void>;
  onResourceConsumed(resource?: ManagedResource): void;
  renderDpr: number;
  presentationPage: number | null;
  onNavigatePresentation(delta: -1 | 1, source: 'Mouse'): void;
  onExitPresentation(): void;
}) {
  const fileUrl = documentResource?.url;
  const plugins = useMemo(() => createPlugins(fileUrl), [fileUrl]);

  return (
    <EmbedPDF engine={engine} plugins={plugins} onInitialized={onInitialized}>
      {({ activeDocumentId: documentId }) => documentId ? (
        <DocumentContent documentId={documentId}>
          {({ documentState, isLoading, isError, isLoaded }) => (
            <>
              <StartupDocumentStatus
                status={documentState.status}
                pageCount={documentState.document?.pageCount}
                errorCode={documentState.errorCode}
              />
              {isLoading && <LoadingStatus label="Loading document…" />}
              {isError && documentState.errorCode === PdfErrorCode.Password ? (
                <UnlockDialog
                  registry={registry}
                  documentId={documentId}
                  incorrect={documentState.passwordProvided === true}
                />
              ) : null}
              {isError && documentState.errorCode !== PdfErrorCode.Password ? (
                <div className={`${VIEWER_STATUS_CLASS} text-danger`}>Unable to load PDF.</div>
              ) : null}
              {isLoaded ? (
                <LoadedPdfDocument
                  documentId={documentId}
                  panMode={panMode}
                  renderThemeVersion={renderThemeVersion}
                  stage={stage}
                  resource={documentResource}
                  onResourceConsumed={onResourceConsumed}
                  renderDpr={renderDpr}
                  presentationPage={presentationPage}
                  onNavigatePresentation={onNavigatePresentation}
                  onExitPresentation={onExitPresentation}
                />
              ) : null}
            </>
          )}
        </DocumentContent>
      ) : (
        <div className={VIEWER_STATUS_CLASS}>No PDF document.</div>
      )}
    </EmbedPDF>
  );
});
