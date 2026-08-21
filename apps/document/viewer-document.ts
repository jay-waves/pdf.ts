import type { PluginRegistry } from '@embedpdf/core';
import type { PdfDocumentObject } from '@embedpdf/models';

export const DOCUMENT_ID = 'pdf-ts-document';

export function getDocumentState(
  registry: PluginRegistry | undefined,
  documentId: string | null | undefined,
) {
  return documentId ? registry?.getStore().getState().core.documents[documentId] ?? null : null;
}

export function getDocument(registry: PluginRegistry | undefined, documentId: string | null | undefined) {
  return getDocumentState(registry, documentId)?.document ?? null;
}

export function onDocumentLoaded(
  registry: PluginRegistry,
  documentId: string,
  listener: (document: PdfDocumentObject) => void,
) {
  let current = getDocument(registry, documentId);
  if (current) listener(current);

  return registry.getStore().subscribe((_action, state) => {
    const next = state.core.documents[documentId]?.document ?? null;
    if (next === current) return;
    current = next;
    if (next) listener(next);
  });
}
