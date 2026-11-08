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
export interface SerializedPdf {
  data: ArrayBuffer;
  hash: string;
  revision: number;
  draft?: import('./document-draft').DocumentDraft;
  baseline?: import('./document-draft').DraftBaseline;
}

/** Per-document FIFO, independent of the native engine queue. Waiting for a
 * page/disk must not hold PDFium's execution queue or block edits in any tab. */
export interface SaveLane { tail: Promise<unknown> }

export class DocumentSaveCoordinator {
  diskVersion: string;
  savedRevision = 0;
  candidateVersion?: string;
  private pending = 0;
  readonly lane: SaveLane;
  constructor(hash: string, lane: SaveLane = { tail: Promise.resolve() }) {
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
    const operation = this.lane.tail.then(async () => {
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
    });
    const finished = operation.finally(async () => {
      this.candidateVersion = undefined;
      this.pending--;
      await options.changed();
    });
    this.lane.tail = finished.catch(() => {});
    return finished;
  }
}
