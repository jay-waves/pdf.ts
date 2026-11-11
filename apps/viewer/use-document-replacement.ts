import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import type { Kernel } from '@embedpdf/core';
import type { ExternalDocumentChange, ManagedResource, PlatformDocument } from '../platform/types';
import { ViewerStage } from './viewer-stage';
import { waitForDocumentPaint } from './document-paint';

/** Stage external updates offscreen; the active view owns the old document until commit. */
export function useDocumentReplacement({
  registry, stage, documentId, sourceDocument, resolvedDocumentName,
  viewerRootRef, hasUnsavedChanges, activateDocument, onResourceConsumed, closeOverlay,
}: {
  registry?: Kernel;
  stage: ViewerStage | null;
  documentId: string | null;
  sourceDocument?: PlatformDocument;
  resolvedDocumentName?: string;
  viewerRootRef: RefObject<HTMLElement | null>;
  hasUnsavedChanges(): boolean;
  activateDocument(registry: Kernel, stage: ViewerStage, cleanup?: () => void): void;
  onResourceConsumed(resource?: ManagedResource): void;
  closeOverlay(): void;
}) {
  const [currentResource, setCurrentResource] = useState(sourceDocument?.resource);
  const [pendingDocument, setPendingDocument] = useState<{
    documentId: string; stage: ViewerStage; presentationPage: number | null;
  } | null>(null);
  const reloadInProgressRef = useRef(false);
  const [reloadRunning, setReloadRunning] = useState(false);
  const reloadAbortRef = useRef<AbortController | null>(null);
  const queuedChangeRef = useRef<ExternalDocumentChange | null>(null);
  const [reloadFailure, setReloadFailure] = useState<{ change: ExternalDocumentChange; message: string } | null>(null);
  const [reloadPasswordId, setReloadPasswordId] = useState<string | null>(null);
  const [externalChange, setExternalChange] = useState<ExternalDocumentChange | null>(null);
  useEffect(() => () => { reloadAbortRef.current?.abort(); }, []);

  const reloadExternalDocument = useCallback(async (change: ExternalDocumentChange) => {
    if (!registry || !stage || !documentId) return;
    if (reloadInProgressRef.current) { queuedChangeRef.current = change; return; }
    const manager = registry.documents;
    if (!manager.has(documentId)) return;

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
      replacementId = crypto.randomUUID();
      const opened = await manager.open({ kind: 'url', url: change.resource.url, id: replacementId }, {
        name: resolvedDocumentName ?? 'document.pdf', activate: false, signal,
      });
      if (opened.document.status === 'locked') {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => { unsubscribe(); signal.removeEventListener('abort', abort); };
          const abort = () => { cleanup(); reject(new DOMException('Reload cancelled.', 'AbortError')); };
          const unsubscribe = manager.onOpened((event) => {
            if (event.documentId === replacementId) { cleanup(); resolve(); }
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
      const snapshot = stage.captureView();
      const nextStage = new ViewerStage(registry, replacementId);
      stagedCleanup = nextStage.install();
      const nextPage = Math.min(snapshot.pageNumber, manager.get(replacementId)!.pageCount);
      flushSync(() => setPendingDocument({
        documentId: replacementId!, stage: nextStage,
        presentationPage: snapshot.mode === 'presentation' ? nextPage : null,
      }));
      await nextStage.restoreView(snapshot, signal);
      await waitForDocumentPaint(viewerRootRef.current!, replacementId, signal);
      signal.throwIfAborted();
      if (!discardConfirmed && hasUnsavedChanges()) {
        setExternalChange(change);
        return;
      }
      flushSync(() => {
        manager.setActive(replacementId!);
        activateDocument(registry, nextStage, stagedCleanup);
        setPendingDocument(null);
        setCurrentResource(change.resource);
        setExternalChange(null);
      });
      stagedCleanup = undefined; // Active session now owns its cleanup.
      committed = true;
      change.accept();
      onResourceConsumed(change.resource);
      await manager.close(documentId);
    } finally {
      if (!committed) {
        stagedCleanup?.();
        setPendingDocument(null);
        if (replacementId && manager.has(replacementId)) {
          await manager.close(replacementId);
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
      closeOverlay();
      setExternalChange(change);
      return;
    }
    void reloadExternalDocument(change).catch((error) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error('[pdf-ts] failed to reload externally updated PDF', error);
      setReloadFailure({ change, message: 'Could not load the updated PDF. The current version is still open.' });
    });
  }, [closeOverlay, hasUnsavedChanges, reloadExternalDocument]);

  useEffect(() => sourceDocument?.watchForChanges?.(handleExternalChange), [handleExternalChange, sourceDocument]);
  useEffect(() => {
    if (reloadInProgressRef.current || !queuedChangeRef.current) return;
    const change = queuedChangeRef.current;
    queuedChangeRef.current = null;
    handleExternalChange(change);
  }, [handleExternalChange, reloadRunning]);

  return {
    currentResource, pendingDocument, reloadPasswordId, reloadFailure, externalChange,
    reloadExternalDocument, handleExternalChange,
    cancelReload: () => reloadAbortRef.current?.abort(),
  };
}
