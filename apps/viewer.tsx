import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  RenderLayer,
  SearchLayer,
  SelectionClipboard,
  SelectionLayer,
  Stage,
  Viewer,
} from '@embedpdf/react';
import './viewer.css';
import { platform } from '#platform';
import type { ManagedResource, PlatformDocument, ViewerResources } from './platform/types';
import { ViewerV3Controls } from './viewer-v3-controls';
import { createViewerEngine, viewerPlugins } from './engine/viewer-engine';
import { DocumentLifecycle, LoadingStatus, VIEWER_STATUS_CLASS } from './document/document-lifecycle';
import { createInitialDocument } from './document/document-session';
import { useDocumentSecurity } from './document/document-security';

function ReadyDocument({ sourceDocument }: { sourceDocument: PlatformDocument }) {
  const { canRender } = useDocumentSecurity();
  if (!canRender) {
    return <div className={`${VIEWER_STATUS_CLASS} text-danger`}>Document preview is not permitted.</div>;
  }

  return (
    <div className="pdf-v3-viewer">
      <Stage className="pdf-v3-stage" interaction>
        {() => (
          <div className="pdf-v3-page">
            <RenderLayer />
            <SearchLayer />
            <SelectionLayer />
          </div>
        )}
      </Stage>
      <SelectionClipboard />
      <ViewerV3Controls sourceDocument={sourceDocument} />
    </div>
  );
}

function CoreViewer({
  sourceDocument,
  onResourceConsumed,
}: {
  sourceDocument: PlatformDocument;
  onResourceConsumed(resource: ManagedResource): void;
}) {
  const documents = useMemo(
    () => [createInitialDocument(sourceDocument, onResourceConsumed)],
    [onResourceConsumed, sourceDocument],
  );

  return (
    <Viewer
      engine={createViewerEngine}
      plugins={viewerPlugins}
      initialDocuments={documents}
      fallback={<LoadingStatus label="Starting EmbedPDF v3…" />}
      renderError={(error) => (
        <div className={`${VIEWER_STATUS_CLASS} text-danger`}>
          Unable to start EmbedPDF v3: {error instanceof Error ? error.message : String(error)}
        </div>
      )}
    >
      <DocumentLifecycle>
        <ReadyDocument sourceDocument={sourceDocument} />
      </DocumentLifecycle>
    </Viewer>
  );
}

function WebDocumentPicker({ onOpen }: { onOpen(file?: File): Promise<void> }) {
  const [error, setError] = useState('');
  return (
    <main className="grid min-h-screen place-items-center bg-app p-6">
      <section className="text-center">
        <h1>PDF.ts Windows Viewer</h1>
        <button
          className="rounded-lg border border-accent bg-accent px-5 py-2 text-surface"
          type="button"
          onClick={() => void onOpen().catch((reason) => setError(String(reason)))}
        >
          Choose a PDF file
        </button>
        {error ? <p className="text-danger">{error}</p> : null}
      </section>
    </main>
  );
}

function ViewerBootstrap() {
  const [resources, setResources] = useState<ViewerResources>();
  const [error, setError] = useState<Error>();
  const trackedResources = useRef(new Set<ManagedResource>());

  const consume = (resource: ManagedResource) => {
    if (!trackedResources.current.delete(resource)) return;
    resource.release?.();
  };

  useEffect(() => {
    let cancelled = false;
    void platform.loadViewerResources('').then((loaded) => {
      if (loaded.document) trackedResources.current.add(loaded.document.resource);
      if (!cancelled) setResources(loaded);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason : new Error(String(reason)));
    });
    return () => {
      cancelled = true;
      for (const resource of trackedResources.current) resource.release?.();
      trackedResources.current.clear();
    };
  }, []);

  if (error) return <div className={`${VIEWER_STATUS_CLASS} text-danger`}>{error.message}</div>;
  if (!resources) return <LoadingStatus label="Loading viewer resources…" />;

  if (!resources.document && platform.openLocalDocument) {
    return (
      <WebDocumentPicker
        onOpen={async (file) => {
          const document = await platform.openLocalDocument?.(file);
          if (!document) return;
          trackedResources.current.add(document.resource);
          setResources({ ...resources, document });
        }}
      />
    );
  }

  if (!resources.document) return <LoadingStatus label="No PDF document." />;
  return (
    <CoreViewer
      key={resources.document.resource.url}
      sourceDocument={resources.document}
      onResourceConsumed={consume}
    />
  );
}

createRoot(document.getElementById('root')!).render(<ViewerBootstrap />);
