import type { DocumentHandle, Engine } from '@embedpdf/engine-core/runtime';
import { getSharedDocumentClient, getRuntimeDocument } from './shared-document-client';
import type { PdfFontDiagnostic } from '../fonts/types';

/** The application borrows native v3 document handles; no old engine facade. */
export class PdfRuntime {
  constructor(readonly engine: Engine) {}

  getDocument(id: string) {
    return getRuntimeDocument(this.engine, id);
  }

  withDocument<T>(id: string, operation: (document: DocumentHandle) => T): T {
    const document = this.getDocument(id);
    if (!document) throw new Error(`PDF document is not available: ${id}`);
    return operation(document);
  }

  async getFontDiagnostics(): Promise<PdfFontDiagnostic[]> {
    return getSharedDocumentClient(this.engine)?.getFontDiagnostics() ?? [];
  }
}
