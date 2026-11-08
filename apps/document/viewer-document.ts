import type { Kernel, DocumentHandle } from '@embedpdf/core';
import { getRuntimeDocument } from '../engine/shared-document-client';
export const DOCUMENT_ID = 'pdf-ts-document';
export function getDocument(kernel: Kernel | undefined, documentId: string | null | undefined) {
  return kernel && documentId ? getRuntimeDocument(kernel.engine, documentId) : null;
}
export function onDocumentLoaded(kernel: Kernel, documentId: string, listener: (document: DocumentHandle) => void) {
  const notify = () => { const document = getDocument(kernel, documentId); if (document) listener(document); };
  const unsubscribe = kernel.documents.onOpened((event) => { if (event.documentId === documentId) notify(); });
  if (kernel.documents.get(documentId)?.status === 'ready') notify();
  return unsubscribe;
}
