import type { PluginRegistry } from '@embedpdf/core';
import type { PdfDocumentObject } from '@embedpdf/models';
import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import { getPluginCapability } from '../shared/utils';

export const DOCUMENT_ID = 'pdf-ts-document';

export function getDocumentState(
  registry: PluginRegistry | undefined,
  documentId: string | null | undefined,
) {
  return registry && documentId
    ? getPluginCapability<DocumentManagerCapability>(registry, 'document-manager')?.getDocumentState(documentId) ?? null
    : null;
}

export function getDocument(registry: PluginRegistry | undefined, documentId: string | null | undefined) {
  return getDocumentState(registry, documentId)?.document ?? null;
}

export function onDocumentLoaded(
  registry: PluginRegistry,
  documentId: string,
  listener: (document: PdfDocumentObject) => void,
) {
  const manager = getPluginCapability<DocumentManagerCapability>(registry, 'document-manager');
  const unsubscribe = manager?.onDocumentOpened((state) => {
    if (state.id === documentId && state.document) listener(state.document);
  });
  const current = manager?.getDocument(documentId);
  if (current) listener(current);
  return unsubscribe ?? (() => {});
}
