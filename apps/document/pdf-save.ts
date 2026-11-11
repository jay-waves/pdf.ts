import type { Engine, Kernel } from '@embedpdf/core';
import { getSharedDocumentClient } from '../engine/shared-document-client';
import { downloadPdf } from '../platform/browser-download';
import type { PdfFileHandle } from '../platform/types';

/** A document-bound output capability. UI callers do not assemble engine,
 * registry, identity and writer for every operation. Permission acquisition stays
 * inside save(), before serialization, to preserve the initiating user gesture. */
export function createDocumentOutput({ engine, registry, documentId, fileHandle }: {
  engine: Engine;
  registry?: Kernel;
  documentId?: string | null;
  fileHandle?: PdfFileHandle;
}) {
  async function serialize() {
    if (!registry || !documentId || registry.documents.get(documentId)?.status !== 'ready') return null;
    const bytes = await registry.documents.download(documentId, { mode: 'rewrite' });
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  return {
    async export(fileName: string) {
      const data = await serialize();
      if (!data) return false;
      downloadPdf(data, fileName);
      return true;
    },
    async saveCopy() {
      if (!fileHandle?.saveCopy) return null;
      const data = await serialize();
      return data ? fileHandle.saveCopy(data) : null;
    },
    async save() {
      if (!registry || !documentId || !fileHandle) return false;
      const target = await fileHandle.prepareWrite();
      if (!target) return false;
      const shared = getSharedDocumentClient(engine);
      if (shared) return shared.save(documentId, target);
      const data = await serialize();
      return data ? target.save(data) : false;
    },
  };
}
