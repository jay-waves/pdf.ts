import { useCallback, useEffect, useRef } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import type { PdfEngine } from '@embedpdf/models';
import { platform } from '#platform';
import { savePdf } from './pdf-save';
import type { PdfFileHandle } from './platform/types';

type SaveOptions = {
  fromHost?: boolean;
  preserveDirty?: boolean;
};

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function useDocumentPersistence({
  engine,
  registry,
  fileHandle,
  title,
}: {
  engine: PdfEngine<Blob>;
  registry: PluginRegistry | undefined;
  fileHandle?: PdfFileHandle;
  title: string;
}) {
  const saveInProgressRef = useRef<Promise<boolean> | null>(null);
  const changesRef = useRef({ dirty: false, version: 0, forceFullSave: false });
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

    if (dirtyStateChanged) {
      if (dirty) {
        window.addEventListener('beforeunload', handleBeforeUnload);
      } else {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      }
      platform.setDocumentDirty?.(dirty);
    }
    renderTitle();
  }, [renderTitle]);

  useEffect(() => {
    titleRef.current = title;
    renderTitle();
  }, [renderTitle, title]);

  const saveDocument = useCallback(
    (options: SaveOptions = {}): Promise<boolean> => {
      const changes = changesRef.current;
      if (!changes.dirty) return Promise.resolve(true);
      if (platform.requestDocumentSave && !options.fromHost) {
        platform.requestDocumentSave();
        return Promise.resolve(false);
      }
      if (saveInProgressRef.current) return saveInProgressRef.current;

      const versionAtStart = changes.version;
      const save = savePdf(engine, registry, fileHandle, {
        forceFullSave: changes.forceFullSave,
      })
        .then((saved) => {
          // Preserve edits made while serialization or disk I/O was in progress.
          if (saved && !options.preserveDirty && changesRef.current.version === versionAtStart) {
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
    [engine, fileHandle, registry, setDirty],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveDocument();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveDocument]);

  useEffect(() => {
    return platform.onDocumentSaveRequested?.(
      (preserveDirty) => saveDocument({ fromHost: true, preserveDirty }),
    );
  }, [saveDocument]);

  useEffect(() => {
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  return { saveDocument, setDirty };
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = '';
}
