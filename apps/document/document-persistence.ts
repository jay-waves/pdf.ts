import { useCallback, useState } from 'react';
import { useDocumentId, useDocuments } from '@embedpdf/react';
import { downloadPdf } from '../platform/browser-download';
import type { PlatformDocument } from '../platform/types';

export function useDocumentPersistence(document: PlatformDocument, permitted: boolean) {
  const documentId = useDocumentId();
  const { download } = useDocuments();
  const [busy, setBusy] = useState(false);

  const serialize = useCallback(async () => {
    if (!documentId) throw new Error('No PDF document is open.');
    if (!permitted) throw new Error('This document does not allow downloading.');
    const bytes = await download(documentId, { mode: 'incremental' });
    return bytes.slice().buffer as ArrayBuffer;
  }, [documentId, download, permitted]);

  const run = useCallback(async (operation: () => Promise<boolean>) => {
    setBusy(true);
    try {
      return await operation();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to save the PDF.');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const save = useCallback(() => run(async () => {
    const writer = await document.fileHandle.prepareWrite();
    if (!writer) return false;
    const data = await serialize();
    return writer.saveIncrementalDocument
      ? writer.saveIncrementalDocument(data)
      : writer.save(data);
  }), [document.fileHandle, run, serialize]);

  const exportCopy = useCallback(() => run(async () => {
    downloadPdf(await serialize(), document.name ?? 'document.pdf');
    return true;
  }), [document.name, run, serialize]);

  return { busy, canSave: permitted && !busy, exportCopy, save };
}
