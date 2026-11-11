/** The worker owns the disk version and save transaction. A page
 * executes this immutable write plan after acquiring any required permission. */
export interface PdfWritePlan {
  destination: 'original' | 'copy';
  data: ArrayBuffer;
  expectedVersion: string;
  outputVersion: string;
}
export type PdfWriteResult =
  | { status: 'saved'; version: string }
  | { status: 'retry-copy' | 'cancelled' | 'copy' };
export interface SharedSaveState {
  diskVersion: string;
  saving: boolean;
}
export interface PdfFileWriter {
  writeShared(plan: PdfWritePlan): Promise<PdfWriteResult>;
}

export interface DraftLocation { endpoint?: string; key?: string }

/** Consumes owned download bytes. Only a partial/shared view needs a standalone copy. */
export function ownedPdfBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer : bytes.slice().buffer;
}
