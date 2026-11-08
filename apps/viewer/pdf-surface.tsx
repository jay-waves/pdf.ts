import { cloneElement, isValidElement, memo, useEffect, useMemo, type ReactElement } from 'react';
import type { Engine, Kernel } from '@embedpdf/core';
import { Viewer, DocumentScope, DocumentGate, useActiveDocumentId, useDocument } from '@embedpdf/react/runtime';
import { AnnotationLayer, annotationPlugin } from '@embedpdf/react/annotation';
import { SelectionLayer, selectionPlugin } from '@embedpdf/react/selection';
import { FormLayer, formPlugin } from '@embedpdf/react/form';
import { LinkLayer, linkPlugin, type LinkRenderProps } from '@embedpdf/react/link';
import { actionsPlugin } from '@embedpdf/plugin-actions';
import { platform } from '#platform';
import { interactionPlugin } from '@embedpdf/plugin-interaction';
import { stagePlugin } from '@embedpdf/plugin-stage';
import { renderPlugin, RenderToken } from '@embedpdf/plugin-render';
import { getSharedDocumentClient, sharedHistoryPlugin } from '../renderer/shared-document-client';
import { PDF_TILE_SIZE_CSS_PX } from '../renderer/render-settings';
import { NativePdfStage } from '../renderer/native-pdf-stage';
import { ReadingRegionLayer, ReadingRegionControls } from '../renderer/reading-region-layer';
import { createAnnotationPluginConfig } from '../annotations/annotations';
import { themeAnnotationRenderers, AnnotationThemeStyles } from '../annotations/theme-renderers';
import { SignatureFallbackLayer } from '../document/signatures/signature-fallback-layer';
import { UnlockDialog } from '../document/protection-dialogs';
import type { ManagedResource } from '../platform/types';
import type { ViewerStage } from './viewer-stage';
import { SearchLayer } from '../search/search';
import { DOCUMENT_ID } from '../document/viewer-document';
import { completeStartupLog, failStartupLog, writeStartupLogOnce } from './startup-log';
import { PresentationView } from './presentation-view';
import './pdf-surface.css';
import styles from './viewer.module.css';

export const VIEWER_STATUS_CLASS = 'grid size-full place-items-center bg-app text-xs text-secondary';

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


function createPlugins() {
  return [stagePlugin({ padding: 10, gap: { px: 10 }, zoom: { mode: 'fit-page' }, minZoom: 0.2, maxZoom: 60, viewUnitsPerPoint: 1 }),
    renderPlugin({ format: 'bmp', tiles: { size: PDF_TILE_SIZE_CSS_PX, bleedPx: 2, prefetch: { margin: 0, velocityBias: false } } }),
    interactionPlugin(), selectionPlugin({ color: 'var(--pdf-text-selection-color)' }), actionsPlugin(), linkPlugin(),
    annotationPlugin(createAnnotationPluginConfig()), sharedHistoryPlugin(), formPlugin()];
}

function renderPlatformLink({ link, native }: LinkRenderProps) {
  if (link.target?.kind !== 'uri' || !isValidElement(native)) return undefined;
  const uri = link.target.uri;
  return cloneElement(native as ReactElement<{ onClick(event: React.MouseEvent): void }>, {
    onClick(event) { event.preventDefault(); event.stopPropagation(); platform.openExternal(uri); },
  });
}

function DocumentStatus() {
  const info = useDocument();
  useEffect(() => {
    if (info.status === 'ready') writeStartupLogOnce('document-opened', 'Document opened', `${info.pageCount} pages`);
    else if (info.status === 'locked') completeStartupLog('Document requires a password');
    else if (info.status === 'error') { failStartupLog('Unable to open PDF document', info.error?.message); console.error('[pdf-ts] document open failed', info.error); }
    else writeStartupLogOnce('document-loading', 'Opening PDF document');
  }, [info.status, info.pageCount]);
  return null;
}

type SurfaceProps = {
  engine: Engine;
  registry?: Kernel;
  pendingDocument?: { documentId: string; stage: ViewerStage; presentationPage: number | null } | null;
  panMode: boolean;
  renderThemeVersion: number;
  stage?: ViewerStage | null;
  documentResource?: ManagedResource;
  onInitialized(registry: Kernel): Promise<void>;
  onResourceConsumed(resource?: ManagedResource): void;
  renderDpr: number;
  presentationPage: number | null;
  onNavigatePresentation(delta: -1 | 1): void;
  onExitPresentation(): void;
};

function LoadedPdfDocument({ documentId, stage, presentationPage, ...props }: SurfaceProps & { documentId: string }) {
  useEffect(() => props.onResourceConsumed(props.documentResource), [props.onResourceConsumed, props.documentResource]);
  return <>
    <AnnotationThemeStyles />
    <NativePdfStage documentId={documentId} stage={stage} panMode={props.panMode} renderDpr={props.renderDpr}
      className={`viewer${props.panMode ? ' is-pan-mode' : ''}`}
      inert={presentationPage !== null} aria-hidden={presentationPage !== null}
      renderPage={({ pageIndex }) => <>
        <SearchLayer documentId={documentId} pageIndex={pageIndex} />
        <div className="pdf-text-selection-layer"><SelectionLayer /></div>
        <div className="pdf-annotation-layer"><AnnotationLayer renderers={themeAnnotationRenderers} /></div>
        <FormLayer />
        <SignatureFallbackLayer />
        <LinkLayer renderLink={renderPlatformLink} />
        <ReadingRegionLayer documentId={documentId} pageIndex={pageIndex} stage={stage} />
      </>} />
    <ReadingRegionControls stage={stage} />
    {presentationPage !== null ? <PresentationView documentId={documentId} pageNumber={presentationPage}
      onNavigate={props.onNavigatePresentation} onExit={props.onExitPresentation} /> : null}
  </>;
}

function DocumentLayers(props: SurfaceProps) {
  const activeDocumentId = useActiveDocumentId();
  if (!activeDocumentId) return <div className={VIEWER_STATUS_CLASS}>No PDF document.</div>;
  return [...new Set([activeDocumentId, props.pendingDocument?.documentId].filter((id): id is string => !!id))].map((id) => {
    const pending = props.pendingDocument?.documentId === id ? props.pendingDocument : null;
    const hidden = id !== activeDocumentId;
    return <div key={id} data-pdf-document-layer={id} aria-hidden={hidden} inert={hidden}
      style={{ position: 'absolute', inset: 0, visibility: hidden ? 'hidden' : 'visible' }}>
      <DocumentScope id={id}>
        <DocumentStatus />
        <DocumentGate fallback={<LoadingStatus label="Loading document…" />}
          locked={(info) => <UnlockDialog registry={props.registry} documentId={id} incorrect={info.passwordProvided} />}
          error={() => <div className={`${VIEWER_STATUS_CLASS} text-danger`}>Unable to load PDF.</div>}>
          <LoadedPdfDocument {...props} documentId={id} stage={pending?.stage ?? props.stage}
            presentationPage={pending ? pending.presentationPage : props.presentationPage} />
        </DocumentGate>
      </DocumentScope>
    </div>;
  });
}

export const PdfSurface = memo(function PdfSurface(props: SurfaceProps) {
  const plugins = useMemo(createPlugins, []);
  useEffect(() => {
    for (const info of props.registry?.documents.list() ?? []) {
      props.registry?.tryCapability(RenderToken, info.id)?.invalidate({ scope: 'content' });
    }
  }, [props.registry, props.renderThemeVersion]);
  const initialDocuments = useMemo(() => {
    const resource = props.documentResource;
    getSharedDocumentClient(props.engine)?.setIdentity(resource?.sharedIdentity ?? resource?.url ?? crypto.randomUUID(), resource?.draftLocation);
    return resource?.url ? [{ source: { kind: 'url' as const, url: resource.url, id: DOCUMENT_ID } }] : [];
  }, [props.engine, props.documentResource]);
  return <Viewer engine={props.engine} plugins={plugins} initialDocuments={initialDocuments}
    accent="var(--pdf-accent-primary)" page={{ background: 'var(--pdf-page-background)' }}
    onReady={(kernel) => { void props.onInitialized(kernel); }}>
    <DocumentLayers {...props} />
  </Viewer>;
});
