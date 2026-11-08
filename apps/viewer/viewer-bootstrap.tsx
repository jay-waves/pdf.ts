import { useCallback, useEffect, useRef, useState } from 'react';
import { usePdfRuntime } from './use-pdf-runtime';
import { platform } from '#platform';
import type { ManagedResource, ViewerResources } from '../platform/types';
import { LoadingStatus, VIEWER_STATUS_CLASS } from './pdf-surface';
import { PDFIUM_FONT_FALLBACK } from '../fonts';
import { beginStartupLog, completeStartupLog, failStartupLog, writeStartupInfo, writeStartupLogOnce } from './startup-log';
import { ViewerApp } from './viewer-app';
import { Welcome } from './welcome';

function useViewerResources(wasmUrl: string) {
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
    platform.loadViewerResources(wasmUrl).then((loaded) => {
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
  }, [releaseResource, trackResource, wasmUrl]);

  useEffect(() => () => {
    for (const resource of managedResourcesRef.current) resource.release?.();
    managedResourcesRef.current.clear();
  }, []);

  return { resources, setResources, error, trackResource, releaseResource };
}

export function ViewerBootstrap({ wasmUrl }: { wasmUrl: string }) {
  const { resources, setResources, error, trackResource, releaseResource } = useViewerResources(wasmUrl);

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
    <ViewerApp
      key={resources.document?.resource.url}
      pdfium={pdfium}
      sourceDocument={resources.document}
      onResourceConsumed={releaseResource}
    />
  );
}
