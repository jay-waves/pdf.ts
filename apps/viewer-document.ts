import type { PluginRegistry } from '@embedpdf/core';
import type { PdfDocumentObject } from '@embedpdf/models';
import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';

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

/**
 * The only application-facing bridge to EmbedPDF's document manager. Loading
 * remains owned by EmbedPDF, while features operate on one explicit document.
 */
export function getDocumentOps(
  registry: PluginRegistry | undefined,
  documentId: string | null | undefined,
) {
  const manager = registry?.getPlugin('document-manager')?.provides?.() as
    | DocumentManagerCapability
    | undefined;
  if (!manager || !documentId) return null;

  return {
    document: manager.getDocument(documentId),
    retry: (password: string) => manager.retryDocument(documentId, { password }),
    setEncryption: (options: Parameters<DocumentManagerCapability['setDocumentEncryption']>[1]) =>
      manager.setDocumentEncryption(documentId, options),
    unlockOwnerPermissions: (password: string) =>
      manager.unlockOwnerPermissions(documentId, password),
    removeEncryption: () => manager.removeEncryption(documentId),
  };
}
