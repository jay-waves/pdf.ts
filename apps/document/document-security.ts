import { RenderToken } from '@embedpdf/plugin-render';
import { SelectionToken } from '@embedpdf/plugin-selection';
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
  const search = useSearch();
  const canDownload = useKernelValue((kernel) => (
    documentId ? kernel.documents.allows('doc.download', documentId) : false
  ));
  const canPrint = useKernelValue((kernel) => (
    documentId ? kernel.documents.allows('doc.print', documentId) : false
  ));

  return {
    canCopy: selection.canCopy(),
    canDownload,
    canPrint,
    canRender: render.canRender(),
    canSearch: search.canSearch('full'),
    canSelect: selection.canSelect(),
  };
}
