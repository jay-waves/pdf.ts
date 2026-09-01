import { RenderToken } from '@embedpdf/plugin-render';
import { SelectionToken } from '@embedpdf/plugin-selection';
import { AnnotationToken } from '@embedpdf/plugin-annotation';
import {
  useCapability,
  useDocumentId,
  useKernelValue,
  useSearch,
} from '@embedpdf/react';

export function useDocumentSecurity() {
  const documentId = useDocumentId();
  const render = useCapability(RenderToken);
  const selection = useCapability(SelectionToken);
  const annotation = useCapability(AnnotationToken);
  const search = useSearch();
  const canDownload = useKernelValue((kernel) => (
    documentId ? kernel.documents.allows('doc.download', documentId) : false
  ));
  const canPrint = useKernelValue((kernel) => (
    documentId ? kernel.documents.allows('doc.print', documentId) : false
  ));

  return {
    canAnnotate: annotation.canCreate(),
    canReadAnnotations: annotation.canRead(),
    canCopy: selection.canCopy(),
    canDownload,
    canPrint,
    canRender: render.canRender(),
    canSearch: search.canSearch('full'),
    canSelect: selection.canSelect(),
  };
}
