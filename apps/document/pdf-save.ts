import type { PluginRegistry } from '@embedpdf/core';
import type { PdfEngine } from '@embedpdf/models';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import { getAnnotationScope } from '../annotations/annotations';
import { downloadPdf } from '../platform/browser-download';
import { savePdfIncrementally } from '../renderer/pdf-engine';
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
  if (annotation) await commitPendingAnnotations(annotation.scope);
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

export async function savePdf(
  engine: PdfEngine<Blob>,
  registry: PluginRegistry | undefined,
  documentId: string | null | undefined,
  fileHandle: PdfFileHandle | undefined,
  { forceFullSave = false }: { forceFullSave?: boolean } = {},
) {
  if (!registry || !fileHandle) return false;

  // Browser-backed handles must acquire permission while the save gesture is
  // still active, before PDF serialization yields to the engine.
  const target = await fileHandle.prepareWrite();
  if (!target) return false;

  const document = await getDocumentForSerialization(registry, documentId);
  if (!document) return false;

  if (target.saveIncremental && !forceFullSave) {
    try {
      const revision = await savePdfIncrementally(engine, document).toPromise();
      if (revision.delta.byteLength > 0) {
        return await target.saveIncremental(revision);
      }
    } catch (error) {
      // Unsupported/encrypted PDFs and stale files safely fall back to the
      // existing full serialization + conflict-copy flow.
      console.info('[pdf-ts] incremental save unavailable; using a full save', error);
    }
  }

  const data = await engine.saveAsCopy(document).toPromise();
  return data ? target.save(data) : false;
}
