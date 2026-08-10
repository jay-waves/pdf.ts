import { memo, useEffect } from 'react';
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
import { RenderLayer, RenderPluginPackage } from '@embedpdf/plugin-render/react';
import { Rotate, RotatePluginPackage } from '@embedpdf/plugin-rotate/react';
import { Scroller, ScrollPluginPackage, ScrollStrategy } from '@embedpdf/plugin-scroll/react';
import { SelectionLayer, SelectionPluginPackage } from '@embedpdf/plugin-selection/react';
import { SpreadMode, SpreadPluginPackage } from '@embedpdf/plugin-spread/react';
import { TilingLayer, TilingPluginPackage } from '@embedpdf/plugin-tiling/react';
import { ViewportPluginPackage } from '@embedpdf/plugin-viewport/react';
import { ZoomMode, ZoomPluginPackage } from '@embedpdf/plugin-zoom/react';
import { createAnnotationPluginConfig } from './annotations';
import { OpenPasswordDialog } from './protection-dialogs';
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
import { PdfSearchLayer } from './search';
import { ViewerViewport } from './viewer-viewport';
import { ViewportInput } from './viewer-viewport-input';
import './viewer-surface.css';
import styles from './viewer.module.css';

export const RENDER_IMAGE_TYPE = 'image/bmp';
const TILING_TILE_SIZE = 768;
const TILING_OVERLAP_PX = 2;
const TILING_EXTRA_RINGS = 0;
const SEARCH_HIGHLIGHT_COLOR = 'color-mix(in srgb, var(--pdf-annotation-auto-stroke) 38%, transparent)';
const SEARCH_ACTIVE_HIGHLIGHT_COLOR = 'color-mix(in srgb, var(--pdf-danger-primary) 62%, transparent)';
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

export function createViewerPlugins(fileUrl?: string) {
  return [
    createPluginRegistration(DocumentManagerPluginPackage, {
      initialDocuments: fileUrl ? [{ url: fileUrl }] : [],
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
      tileSize: TILING_TILE_SIZE,
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

function ActiveDocumentTracker({ documentId, onChange }: {
  documentId: string | null;
  onChange(documentId: string | null): void;
}) {
  useEffect(() => onChange(documentId), [documentId, onChange]);
  return null;
}

function ResourceConsumedNotifier({ resource, onConsumed }: {
  resource?: ManagedResource;
  onConsumed(resource?: ManagedResource): void;
}) {
  useEffect(() => onConsumed(resource), [onConsumed, resource]);
  return null;
}

function PdfPageLayers({
  documentId,
  pageIndex,
  width,
  height,
  renderThemeVersion,
  search,
}: {
  documentId: string;
  pageIndex: number;
  width: number;
  height: number;
  renderThemeVersion: number;
  search: PdfSearch;
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
        <RenderLayer
          key={`render-${renderThemeVersion}`}
          documentId={documentId}
          pageIndex={pageIndex}
          scale={0.5}
          className="pdf-page-render-image"
          draggable={false}
          style={{ pointerEvents: 'none' }}
        />
        <TilingLayer
          key={`tiles-${renderThemeVersion}`}
          documentId={documentId}
          pageIndex={pageIndex}
          className="pdf-page-tiling-layer"
        />
        <PdfSearchLayer
          search={search}
          documentId={documentId}
          pageIndex={pageIndex}
          highlightColor={SEARCH_HIGHLIGHT_COLOR}
          activeHighlightColor={SEARCH_ACTIVE_HIGHLIGHT_COLOR}
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
  resource,
  onResourceConsumed,
}: {
  documentId: string;
  panMode: boolean;
  renderThemeVersion: number;
  search: PdfSearch;
  resource?: ManagedResource;
  onResourceConsumed(resource?: ManagedResource): void;
}) {
  return (
    <>
      <ResourceConsumedNotifier resource={resource} onConsumed={onResourceConsumed} />
      <GlobalPointerProvider documentId={documentId}>
        <ViewerViewport
          documentId={documentId}
          className={`viewer${panMode ? ' is-pan-mode' : ''}`}
          onDragStart={(event) => event.preventDefault()}
        >
          <ViewportInput documentId={documentId} panMode={panMode}>
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
                />
              )}
            />
          </ViewportInput>
        </ViewerViewport>
      </GlobalPointerProvider>
    </>
  );
}

export const PdfSurface = memo(function PdfSurface({
  engine,
  plugins,
  registry,
  panMode,
  renderThemeVersion,
  search,
  documentResource,
  onInitialized,
  onActiveDocumentChange,
  onResourceConsumed,
}: {
  engine: PdfEngine<Blob>;
  plugins: ReturnType<typeof createViewerPlugins>;
  registry?: PluginRegistry;
  panMode: boolean;
  renderThemeVersion: number;
  search: PdfSearch;
  documentResource?: ManagedResource;
  onInitialized(registry: PluginRegistry): Promise<void>;
  onActiveDocumentChange(documentId: string | null): void;
  onResourceConsumed(resource?: ManagedResource): void;
}) {
  return (
    <EmbedPDF engine={engine} plugins={plugins} onInitialized={onInitialized}>
      {({ activeDocumentId }) => (
        <>
          <ActiveDocumentTracker documentId={activeDocumentId} onChange={onActiveDocumentChange} />
          {activeDocumentId ? (
            <DocumentContent documentId={activeDocumentId}>
              {({ documentState, isLoading, isError, isLoaded }) => (
                <>
                  {isLoading && <LoadingStatus label="Loading document…" />}
                  {isError && documentState.errorCode === PdfErrorCode.Password ? (
                    <OpenPasswordDialog
                      registry={registry}
                      documentId={activeDocumentId}
                      incorrect={documentState.passwordProvided === true}
                    />
                  ) : null}
                  {isError && documentState.errorCode !== PdfErrorCode.Password ? (
                    <div className={`${VIEWER_STATUS_CLASS} text-danger`}>Unable to load PDF.</div>
                  ) : null}
                  {isLoaded ? (
                    <LoadedPdfDocument
                      documentId={activeDocumentId}
                      panMode={panMode}
                      renderThemeVersion={renderThemeVersion}
                      search={search}
                      resource={documentResource}
                      onResourceConsumed={onResourceConsumed}
                    />
                  ) : null}
                </>
              )}
            </DocumentContent>
          ) : (
            <div className={VIEWER_STATUS_CLASS}>No PDF document.</div>
          )}
        </>
      )}
    </EmbedPDF>
  );
});
