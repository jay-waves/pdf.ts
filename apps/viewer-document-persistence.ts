import { useCallback, useEffect, useRef, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import type { PdfEngine } from '@embedpdf/models';
import { savePdf } from './pdf-save';
import type { PdfFileHandle } from './platform/types';

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
  engine: PdfEngine<Blob>;
  registry: PluginRegistry | undefined;
  documentId: string | null;
  fileHandle?: PdfFileHandle;
  title: string;
}) {
  const saveInProgressRef = useRef<Promise<boolean> | null>(null);
  const changesRef = useRef({ dirty: false, version: 0, forceFullSave: false });
  const [isDirty, setIsDirty] = useState(false);
  const titleRef = useRef(title);

  const renderTitle = useCallback(() => {
    document.title = `${changesRef.current.dirty ? '*' : ''}${titleRef.current}`;
  }, []);

  const setDirty = useCallback((dirty: boolean, forceFullSave = false) => {
    const changes = changesRef.current;
    const dirtyStateChanged = changes.dirty !== dirty;
    if (dirty) {
      changes.version++;
      changes.forceFullSave ||= forceFullSave;
    } else {
      changes.forceFullSave = false;
    }
    changes.dirty = dirty;
    setIsDirty(dirty);

    if (dirtyStateChanged) {
      if (dirty) {
        window.addEventListener('beforeunload', handleBeforeUnload);
      } else {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      }
    }
    renderTitle();
  }, [renderTitle]);

  useEffect(() => {
    titleRef.current = title;
    renderTitle();
  }, [renderTitle, title]);

  const saveDocument = useCallback(
    (): Promise<boolean> => {
      const changes = changesRef.current;
      if (!changes.dirty) return Promise.resolve(true);
      if (saveInProgressRef.current) return saveInProgressRef.current;

      const versionAtStart = changes.version;
      const save = savePdf(engine, registry, documentId, fileHandle, {
        forceFullSave: changes.forceFullSave,
      })
        .then((saved) => {
          // Preserve edits made while serialization or disk I/O was in progress.
          if (saved && changesRef.current.version === versionAtStart) {
            setDirty(false);
          }
          return saved;
        })
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
    [documentId, engine, fileHandle, registry, setDirty],
  );

  useEffect(() => {
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  return { isDirty, saveDocument, setDirty };
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = '';
}
