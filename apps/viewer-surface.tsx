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
import { createAnnotationPluginConfig } from './annotations';
import { UnlockDialog } from './protection-dialogs';
import { signatureWidgetRenderer } from './signatures';
import { themeAnnotationColorRenderer } from './theme-annotation-color';
import { themeCommentRenderer } from './theme-comment-renderer';
import {
  themeHighlightRenderer,
  themeStrikeoutRenderer,
  themeUnderlineRenderer,
} from './theme-highlight-renderer';
import type { ManagedResource } from './platform/types';
import type { PdfSearch } from './pdf-search';
import type { PdfScroll } from './pdf-scroll';
import { SearchLayer } from './search';
import { ViewerViewport } from './viewer-viewport';
import { ViewportInput } from './viewer-viewport-input';
import { PDF_TILE_SIZE_CSS_PX } from './viewer-diagnostics';
import { RasterLayer, TileLayer } from './viewer-render-layers';
import { DOCUMENT_ID } from './viewer-document';
import './viewer-surface.css';
import styles from './viewer.module.css';

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

function PdfPageLayers({
  documentId,
  pageIndex,
  width,
  height,
  renderThemeVersion,
  search,
  renderDpr,
}: {
  documentId: string;
  pageIndex: number;
  width: number;
  height: number;
  renderThemeVersion: number;
  search: PdfSearch;
  renderDpr: number;
}) {
  return (
    <Rotate documentId={documentId} pageIndex={pageIndex}>
      <PagePointerProvider
        documentId={documentId}
        pageIndex={pageIndex}
        className="pdf-page-surface"
        style={{
          position: 'relative',
          width,
          height,
          backgroundColor: 'var(--pdf-page-background)',
        }}
      >
        <RasterLayer
          key={`render-${renderThemeVersion}`}
          documentId={documentId}
          pageIndex={pageIndex}
          scale={0.5}
          dpr={renderDpr}
          className="pdf-page-render-image"
          draggable={false}
          style={{ pointerEvents: 'none' }}
        />
        <TileLayer
          key={`tiles-${renderThemeVersion}`}
          documentId={documentId}
          pageIndex={pageIndex}
          dpr={renderDpr}
          className="pdf-page-tiling-layer"
        />
        <SearchLayer
          search={search}
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
        />
      </PagePointerProvider>
    </Rotate>
  );
}

function LoadedPdfDocument({
  documentId,
  panMode,
  renderThemeVersion,
  search,
  scroll,
  resource,
  onResourceConsumed,
  renderDpr,
}: {
  documentId: string;
  panMode: boolean;
  renderThemeVersion: number;
  search: PdfSearch;
  scroll?: PdfScroll | null;
  resource?: ManagedResource;
  onResourceConsumed(resource?: ManagedResource): void;
  renderDpr: number;
}) {
  useEffect(() => onResourceConsumed(resource), [onResourceConsumed, resource]);

  return (
    <GlobalPointerProvider documentId={documentId}>
      <ViewerViewport
        documentId={documentId}
        scroll={scroll}
        className={`viewer${panMode ? ' is-pan-mode' : ''}`}
        onDragStart={(event) => event.preventDefault()}
      >
        <ViewportInput documentId={documentId} panMode={panMode} scroll={scroll} />
        <Scroller
          documentId={documentId}
          className="pdf-scroller"
          renderPage={({ pageIndex, width, height }) => (
            <PdfPageLayers
              documentId={documentId}
              pageIndex={pageIndex}
              width={width}
              height={height}
              renderThemeVersion={renderThemeVersion}
              search={search}
              renderDpr={renderDpr}
            />
          )}
        />
      </ViewerViewport>
    </GlobalPointerProvider>
  );
}

export const PdfSurface = memo(function PdfSurface({
  engine,
  registry,
  panMode,
  renderThemeVersion,
  search,
  scroll,
  documentResource,
  onInitialized,
  onResourceConsumed,
  renderDpr,
}: {
  engine: PdfEngine<Blob>;
  registry?: PluginRegistry;
  panMode: boolean;
  renderThemeVersion: number;
  search: PdfSearch;
  scroll?: PdfScroll | null;
  documentResource?: ManagedResource;
  onInitialized(registry: PluginRegistry): Promise<void>;
  onResourceConsumed(resource?: ManagedResource): void;
  renderDpr: number;
}) {
  const fileUrl = documentResource?.url;
  const plugins = useMemo(() => createPlugins(fileUrl), [fileUrl]);

  return (
    <EmbedPDF engine={engine} plugins={plugins} onInitialized={onInitialized}>
      {({ activeDocumentId: documentId }) => documentId ? (
        <DocumentContent documentId={documentId}>
          {({ documentState, isLoading, isError, isLoaded }) => (
            <>
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
                  search={search}
                  scroll={scroll}
                  resource={documentResource}
                  onResourceConsumed={onResourceConsumed}
                  renderDpr={renderDpr}
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
