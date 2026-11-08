import { getSharedDocumentClient } from '../renderer/shared-document-client';
import type { PluginRegistry } from '@embedpdf/core';
import type { PdfEngine } from '@embedpdf/models';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import { getAnnotationScope } from '../annotations/annotations';
import { downloadPdf } from '../platform/browser-download';
import type { PdfFileHandle } from '../platform/types';
import { getDocument } from './viewer-document';

async function commitPendingAnnotations(annotationScope: ReturnType<AnnotationCapability['forDocument']>) {
  // commit() resolves immediately when an auto-commit is already running, so
  // keep retrying until the document state confirms that PDFium has caught up.
  while (annotationScope.getState().hasPendingChanges) {
    await annotationScope.commit().toPromise();
    if (annotationScope.getState().hasPendingChanges) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }
}

async function getDocumentForSerialization(
  registry: PluginRegistry | undefined,
  documentId: string | null | undefined,
) {
  if (!registry) return null;

  const document = getDocument(registry, documentId);
  if (!documentId || !document) return null;

  const annotation = getAnnotationScope(registry, documentId);
  const shared = getSharedDocumentClient(registry.getEngine() as PdfEngine<Blob>);
  if (shared) await shared.flush();
  else if (annotation) await commitPendingAnnotations(annotation.scope);
  return document;
}

export async function exportPdf(
  engine: PdfEngine<Blob>,
  registry: PluginRegistry | undefined,
  documentId: string | null | undefined,
  fileName: string,
) {
  const document = await getDocumentForSerialization(registry, documentId);
  if (!document) return false;

  const data = await engine.saveAsCopy(document).toPromise();
  if (!data) return false;

  downloadPdf(data, fileName);
  return true;
}

export async function savePdfCopy(
  engine: PdfEngine<Blob>,
  registry: PluginRegistry | undefined,
  documentId: string | null | undefined,
  fileHandle: PdfFileHandle | undefined,
) {
  if (!fileHandle?.saveCopy) return null;
  const document = await getDocumentForSerialization(registry, documentId);
  if (!document) return null;
  const data = await engine.saveAsCopy(document).toPromise();
  return data ? fileHandle.saveCopy(data) : null;
}

export async function savePdf(
  engine: PdfEngine<Blob>,
  registry: PluginRegistry | undefined,
  documentId: string | null | undefined,
  fileHandle: PdfFileHandle | undefined,
) {
  if (!registry || !fileHandle) return false;

  // Browser-backed handles must acquire permission while the save gesture is
  // still active, before PDF serialization yields to the engine.
  const target = await fileHandle.prepareWrite();
  if (!target) return false;

  const document = await getDocumentForSerialization(registry, documentId);
  if (!document) return false;

  const shared = getSharedDocumentClient(engine);
  if (shared) return shared.save(document.id, target);

  const data = await engine.saveAsCopy(document).toPromise();
  return data ? target.save(data) : false;
}
