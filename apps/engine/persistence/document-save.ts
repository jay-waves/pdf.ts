import type { PdfWritePlan, PdfWriteResult } from '../../shared/pdf-file';

/** Consumes owned download bytes. Only a partial/shared view needs a standalone copy. */
export function ownedPdfBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer : bytes.slice().buffer;
}

export interface SerializedPdf {
  data: ArrayBuffer;
  hash: string;
  revision: number;
  draft?: import('./document-draft').DocumentDraft;
  baseline?: import('./document-draft').DraftBaseline;
}

/** Per-document FIFO, independent of the native engine queue. Waiting for a
 * page/disk must not hold PDFium's execution queue or block edits in any tab. */
export class SaveLane {
  private tail: Promise<void> = Promise.resolve();

  /** FIFO including cleanup; a rejected operation never poisons later work. */
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(() => {}, () => {});
    return result;
  }

  /** Wait for work submitted before this call; does not retain its output. */
  settled(): Promise<void> { return this.tail; }
}

export class DocumentSaveCoordinator {
  diskVersion: string;
  savedRevision = 0;
  candidateVersion?: string;
  private pending = 0;
  readonly lane: SaveLane;
  constructor(hash: string, lane: SaveLane = new SaveLane()) {
    this.lane = lane;
    this.diskVersion = hash;
  }
  get saving() { return this.pending > 0; }

  save(options: {
    revision(): number;
    prepare(): Promise<SerializedPdf>;
    write(plan: PdfWritePlan): Promise<PdfWriteResult>;
    committed(pdf: SerializedPdf): void | Promise<void>;
    changed(): Promise<void>;
    assertConnected(): void;
  }): Promise<boolean> {
    this.pending++;
    return this.lane.run(async () => {
      try {
        options.assertConnected();
        await options.changed();
        if (this.savedRevision === options.revision()) return true;
        let destination: 'original' | 'copy' = 'original';
        for (;;) {
          options.assertConnected();
          const pdf = await options.prepare();
          this.candidateVersion = pdf.hash;
          const result = await options.write({
            destination, data: pdf.data,
            expectedVersion: this.diskVersion, outputVersion: pdf.hash,
          });
          if (result.status === 'retry-copy' && destination === 'original') { destination = 'copy'; continue; }
          if (result.status === 'cancelled' || result.status === 'copy') return false;
          if (result.status !== 'saved' || destination !== 'original' || result.version !== pdf.hash) {
            throw new Error('The PDF write was not confirmed with the expected file version.');
          }
          this.diskVersion = result.version;
          this.savedRevision = pdf.revision;
          await options.committed(pdf);
          return true;
        }
      } finally {
        this.candidateVersion = undefined;
        this.pending--;
        await options.changed();
      }
    });
  }
}
