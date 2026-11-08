import type { Engine, Kernel } from '@embedpdf/core';
import { getSharedDocumentClient } from '../engine/shared-document-client';
import { downloadPdf } from '../platform/browser-download';
import type { PdfFileHandle } from '../platform/types';

async function downloadDocument(registry: Kernel | undefined, documentId: string | null | undefined) {
  if (!registry || !documentId || registry.documents.get(documentId)?.status !== 'ready') return null;
  // The v3 document API waits for pending edits, including text still being
  // edited. Explicit rewrite avoids accumulating previous PDF revisions.
  const bytes = await registry.documents.download(documentId, { mode: 'rewrite' });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function exportPdf(
  registry: Kernel | undefined,
  documentId: string | null | undefined,
  fileName: string,
) {
  const data = await downloadDocument(registry, documentId);
  if (!data) return false;
  downloadPdf(data, fileName);
  return true;
}

export async function savePdfCopy(
  registry: Kernel | undefined,
  documentId: string | null | undefined,
  fileHandle: PdfFileHandle | undefined,
) {
  if (!fileHandle?.saveCopy) return null;
  const data = await downloadDocument(registry, documentId);
  return data ? fileHandle.saveCopy(data) : null;
}

export async function savePdf(
  engine: Engine,
  registry: Kernel | undefined,
  documentId: string | null | undefined,
  fileHandle: PdfFileHandle | undefined,
) {
  if (!registry || !documentId || !fileHandle) return false;
  // Acquire browser write permission while the user gesture is still active.
  const target = await fileHandle.prepareWrite();
  if (!target) return false;
  const shared = getSharedDocumentClient(engine);
  if (shared) return shared.save(documentId, target);
  const data = await downloadDocument(registry, documentId);
  return data ? target.save(data) : false;
}
