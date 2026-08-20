import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { localEngine } from '@embedpdf/engine';
import { renderPlugin } from '@embedpdf/plugin-render';
import { stagePlugin } from '@embedpdf/plugin-stage';
import { interactionPlugin } from '@embedpdf/plugin-interaction';
import { metadataPlugin } from '@embedpdf/plugin-metadata';
import { searchPlugin } from '@embedpdf/plugin-search';
import { selectionPlugin } from '@embedpdf/plugin-selection';
import {
  DocumentGate,
  DocumentScope,
  RenderLayer,
  SearchLayer,
  SelectionClipboard,
  SelectionLayer,
  Stage,
  Viewer,
  useDocumentId,
  useDocumentStatus,
  useDocuments,
  type InitialDocument,
} from '@embedpdf/react';
import './viewer.css';
import { platform } from '#platform';
import type { ManagedResource, PlatformDocument, ViewerResources } from './platform/types';
import { ViewerV3Controls } from './viewer-v3-controls';
import notoSansUrl from '../assets/NotoSans-VariableFont_wdth,wght.ttf?url';

const DOCUMENT_ID = 'pdf-ts-document';
const VIEWER_STATUS_CLASS = 'grid size-full place-items-center bg-app text-xs text-secondary';

// v3 owns the worker and WASM lifecycle. The Windows launcher permits its
// blob worker; disabling the encoder pool keeps this first slice to one worker.
const createEngine = () => localEngine({
  encoderWorker: false,
  fallbackFonts: [{
    key: 'pdf-ts-noto-sans',
    familyName: 'Noto Sans',
    url: notoSansUrl,
  }],
});

// Stage replaces the v2 viewport/scroll/zoom/spread/rotate/tiling stack.
// Editing plugins intentionally stay out until their v3 APIs settle.
const plugins = [
  interactionPlugin(),
  stagePlugin({
    interaction: true,
    flow: 'continuous',
    layout: 'vertical',
    spread: 'none',
    padding: 20,
    gap: { px: 12 },
    zoom: { mode: 'fit-page' },
  }),
  selectionPlugin(),
  searchPlugin(),
  metadataPlugin(),
  renderPlugin(),
];

function LoadingStatus({ label }: { label: string }) {
  return (
    <div className={VIEWER_STATUS_CLASS} role="status" aria-live="polite">
      {label}
    </div>
  );
}

async function readDocument(resource: ManagedResource, signal: AbortSignal) {
  if (resource.openStream) {
    return new Uint8Array(await new Response(resource.openStream()).arrayBuffer());
  }
  const response = await fetch(resource.url, { signal });
  if (!response.ok) throw new Error(`Unable to open PDF: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function initialDocument(
  document: PlatformDocument,
  onResourceConsumed: (resource: ManagedResource) => void,
): InitialDocument {
  return {
    name: document.name ?? 'PDF',
    source: async (signal) => {
      const bytes = await readDocument(document.resource, signal);
      onResourceConsumed(document.resource);
      return { kind: 'bytes', id: DOCUMENT_ID, bytes };
    },
  };
}

function PasswordPrompt() {
  const documentId = useDocumentId();
  const { unlock } = useDocuments();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!documentId) return <LoadingStatus label="No PDF document." />;

  return (
    <form
      className="pdf-v3-password"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        void unlock(documentId, { password })
          .catch(() => setError('Incorrect password.'))
          .finally(() => setBusy(false));
      }}
    >
      <strong>Password required</strong>
      <input
        autoFocus
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <button type="submit" disabled={busy || !password}>
        {busy ? 'Opening…' : 'Open PDF'}
      </button>
      {error ? <span className="text-danger">{error}</span> : null}
    </form>
  );
}

function DocumentFallback() {
  const status = useDocumentStatus();
  if (status === 'locked') return <PasswordPrompt />;
  if (status === 'error') {
    return <div className={`${VIEWER_STATUS_CLASS} text-danger`}>Unable to open PDF.</div>;
  }
  return <LoadingStatus label="Opening PDF document…" />;
}

function ReadyDocument({ sourceDocument }: { sourceDocument: PlatformDocument }) {
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

function ViewerWorkspace({ sourceDocument }: { sourceDocument: PlatformDocument }) {
  const { docs, activeId } = useDocuments();
  const active = docs.find((doc) => doc.id === activeId);
  if (!activeId) return <LoadingStatus label="Opening PDF document…" />;

  return (
    <DocumentScope id={activeId}>
      <DocumentGate fallback={<DocumentFallback />}>
        <ReadyDocument sourceDocument={sourceDocument} />
      </DocumentGate>
      {active?.name ? <span className="sr-only">{active.name}</span> : null}
    </DocumentScope>
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
    () => [initialDocument(sourceDocument, onResourceConsumed)],
    [onResourceConsumed, sourceDocument],
  );

  return (
    <Viewer
      engine={createEngine}
      plugins={plugins}
      initialDocuments={documents}
      fallback={<LoadingStatus label="Starting EmbedPDF v3…" />}
      renderError={(error) => (
        <div className={`${VIEWER_STATUS_CLASS} text-danger`}>
          Unable to start EmbedPDF v3: {error instanceof Error ? error.message : String(error)}
        </div>
      )}
    >
      <ViewerWorkspace sourceDocument={sourceDocument} />
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
