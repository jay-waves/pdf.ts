import type { PluginRegistry } from '@embedpdf/core';
import type { AnnotationCapability } from '@embedpdf/plugin-annotation';
import type { ExportCapability } from '@embedpdf/plugin-export';
import { getActiveDocumentId, getPluginCapability } from './utils';
import { platform } from '#platform';

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

export async function savePdf(
  registry: PluginRegistry | undefined,
  options: { sourceUrl?: string; fileName?: string },
) {
  if (!registry) return false;

  const documentId = getActiveDocumentId(registry);
  const exportPlugin = getPluginCapability<ExportCapability>(registry, 'export');
  if (!documentId || !exportPlugin) return false;

  // Chrome must acquire its writable handle while the Ctrl+S user activation
  // is still live. Web returns a download target here without prompting.
  const target = await platform.preparePdfSave(options);
  if (!target) return false;

  const annotation = getPluginCapability<AnnotationCapability>(registry, 'annotation');
  if (annotation) {
    await commitPendingAnnotations(annotation.forDocument(documentId));
  }

  const data = await exportPlugin.forDocument(documentId).saveAsCopy().toPromise();
  return data ? target.save(data) : false;
}
