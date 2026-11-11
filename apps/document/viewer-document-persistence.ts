import type { DraftState } from '../engine/persistence/document-draft';
import { getSharedDocumentClient } from '../engine/shared-document-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Kernel } from '@embedpdf/core';
import type { Engine } from '@embedpdf/core';
import { createDocumentOutput } from './pdf-save';
import type { PdfFileHandle } from '../platform/types';

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function useDocumentPersistence({
  engine,
  registry,
  documentId,
  fileHandle,
  title,
}: {
  engine: Engine;
  registry: Kernel | undefined;
  documentId: string | null;
  fileHandle?: PdfFileHandle;
  title: string;
}) {
  const output = useMemo(() => createDocumentOutput({ engine, registry, documentId, fileHandle }),
    [engine, registry, documentId, fileHandle]);
  const saveInProgressRef = useRef<Promise<boolean> | null>(null);
  const changesRef = useRef({ dirty: false });
  const [isDirty, setIsDirty] = useState(false);
  const [draft, setDraft] = useState<DraftState>({ draftStatus: 'clean', draftRevision: 0 });
  const titleRef = useRef(title);

  const renderTitle = useCallback(() => {
    document.title = `${changesRef.current.dirty ? '*' : ''}${titleRef.current}`;
  }, []);

  const setDirty = useCallback((dirty: boolean) => {
    const changes = changesRef.current;
    if (changes.dirty === dirty) return;
    changes.dirty = dirty;
    setIsDirty(dirty);

    renderTitle();
  }, [renderTitle]);

  useEffect(() => {
    titleRef.current = title;
    renderTitle();
  }, [renderTitle, title]);

  useEffect(() => {
    if (!documentId) return;
    const shared = getSharedDocumentClient(engine);
    if (!shared) return;
    const sync = (snapshot: NonNullable<ReturnType<typeof shared.getSnapshot>>) => {
      if (snapshot.documentId !== documentId) return;
      fileHandle?.observeSharedSave?.(snapshot);
      setDraft({ draftStatus: snapshot.draftStatus, draftRevision: snapshot.draftRevision, draftError: snapshot.draftError });
      const dirty = snapshot.revision !== snapshot.savedRevision;
      setDirty(dirty);
    };
    const snapshot = shared.getSnapshot(documentId);
    if (snapshot) sync(snapshot);
    const unsubscribe = shared.changes.on(sync);
    return () => { unsubscribe(); fileHandle?.observeSharedSave?.(undefined); };
  }, [documentId, engine, fileHandle, setDirty]);

  const saveDocument = useCallback(
    (): Promise<boolean> => {
      const changes = changesRef.current;
      if (!changes.dirty) return Promise.resolve(true);
      if (saveInProgressRef.current) return saveInProgressRef.current;

      const save = output.save()
        .catch((error) => {
          if (!isAbortError(error)) {
            console.error('[pdf-ts] failed to save PDF', error);
          }
          return false;
        })
        .finally(() => {
          saveInProgressRef.current = null;
        });
      saveInProgressRef.current = save;
      return save;
    },
    [output],
  );

  useEffect(() => {
    if (isDirty && draft.draftStatus !== 'saved') window.addEventListener('beforeunload', handleBeforeUnload);
    else window.removeEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty, draft.draftStatus]);

  const hasUnsavedChanges = useCallback(() => changesRef.current.dirty, []);

  return { isDirty, draft, saveDocument, exportDocument: output.export, saveCopy: output.saveCopy, setDirty, hasUnsavedChanges };
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = '';
}
