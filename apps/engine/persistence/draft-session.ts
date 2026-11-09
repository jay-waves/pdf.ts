import { decodeDraft, encodeDraft, type DocumentDraft, type DraftState } from './document-draft';
import { DraftConflict, type DraftStorage } from './draft-storage';
import type { SaveLane } from './document-save';

/** One draft writer per authoritative document. Draft IO shares the PDF save
 * lane, but snapshots alone enter PDFium's queue. No tab owns the draft. */
export class DraftSession {
  state: DraftState = { draftStatus: 'clean', draftRevision: 0 };
  private token = 'missing';
  private timer?: ReturnType<typeof setTimeout>;
  private busy = false;
  private blocked = false;
  private storage?: DraftStorage;
  constructor(private readonly options: {
    lane: SaveLane;
    revision(): number;
    savedRevision(): number;
    capture(): Promise<DocumentDraft>;
    notify(): void;
    settled(): void;
  }) {}
  get running() { return this.busy; }
  private publish(state: Partial<DraftState>) { this.state = { ...this.state, ...state }; this.options.notify(); }
  fail(error: unknown) {
    this.blocked = error instanceof DraftConflict;
    this.publish({ draftStatus: this.blocked ? 'conflict' : 'error', draftError: error instanceof Error ? error.message : String(error) });
  }
  unavailable(message: string) {
    this.blocked = true;
    clearTimeout(this.timer);
    this.publish({ draftStatus: 'unavailable', draftError: message });
  }
  async initialize(storage: Promise<DraftStorage>, baseVersion: string): Promise<DocumentDraft | null> {
    try {
      this.storage = await storage;
      const record = await this.storage.read(); this.token = record.version;
      if (!record.text) return null;
      let draft: DocumentDraft;
      try { draft = decodeDraft(record.text); }
      catch (error) { throw new DraftConflict(error instanceof Error ? error.message : String(error)); }
      if (draft.mergeOutputVersion === baseVersion) {
        await this.storage.remove(this.token); this.token = 'missing'; return null;
      }
      if (draft.baseVersion !== baseVersion) throw new DraftConflict('The PDF changed since this .swp draft was saved. Download or discard the draft before continuing.');
      return draft;
    } catch (error) { this.fail(error); return null; }
  }
  restored(revision: number) { this.publish({ draftStatus: 'saved', draftRevision: revision, draftError: undefined }); }
  changed() {
    if (this.blocked) return;
    this.publish({ draftStatus: 'pending', draftError: undefined });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.enqueue(), 400);
  }
  private enqueue() {
    if (this.busy || this.blocked || this.options.revision() <= this.state.draftRevision) return;
    this.busy = true;
    const operation = this.options.lane.tail.then(() => this.persist());
    const done = operation.catch(error => this.fail(error)).finally(() => {
      this.busy = false;
      // Edits arriving during IO remain pending and get their own snapshot.
      if (!this.blocked && this.state.draftStatus !== 'error' && this.options.revision() > this.state.draftRevision
        && this.options.revision() > this.options.savedRevision()) this.changed();
      this.options.settled();
    });
    this.options.lane.tail = done;
  }
  private async write(draft: DocumentDraft) {
    if (!this.storage) throw new Error('Draft storage is unavailable. Save to PDF to keep your changes.');
    const text = encodeDraft(draft);
    this.token = await this.storage.write(text, this.token, draft.baseVersion);
    // Unsupported edits may arrive while the snapshot is being written.
    // A successful older write must not claim those edits are safely drafted.
    if (this.blocked) this.publish({ draftRevision: draft.revision });
    else this.publish({ draftStatus: draft.revision < this.options.revision() ? 'pending' : 'saved', draftRevision: draft.revision, draftError: undefined });
  }
  async persist(capture = this.options.capture) {
    if (this.blocked || this.options.revision() === this.options.savedRevision()) return;
    this.publish({ draftStatus: 'saving' });
    await this.write(await capture());
    if (!this.blocked && this.options.revision() > this.state.draftRevision) this.publish({ draftStatus: 'pending' });
  }
  /** Called while the caller already owns the save lane. */
  async beforeMerge(draft: DocumentDraft, outputVersion: string) {
    clearTimeout(this.timer);
    if (this.state.draftStatus === 'conflict') throw new Error(this.state.draftError);
    if (this.state.draftStatus === 'unavailable' || !this.storage) return;
    try { await this.write({ ...draft, mergeOutputVersion: outputVersion }); }
    catch (error) { this.fail(error); throw error; }
  }
  async afterMerge(allowDrafts = true) {
    try {
      if (this.storage && this.token !== 'missing') await this.storage.remove(this.token);
      this.token = 'missing';
      allowDrafts = allowDrafts && !!this.storage;
      this.blocked = !allowDrafts;
      this.publish({ draftStatus: allowDrafts ? 'clean' : 'unavailable', draftRevision: this.options.savedRevision(),
        draftError: allowDrafts ? undefined : 'These changes require Save to PDF. Reopen the saved, unencrypted PDF to enable automatic drafts.' });
      if (!this.blocked && this.options.revision() > this.options.savedRevision()) await this.persist();
    } catch (error) { this.fail(error); }
  }
  async discard() {
    if (!this.storage) throw new Error('Draft storage is unavailable.');
    // Re-read only for this explicit user action, never to bypass a CAS conflict.
    const record = await this.storage.read();
    await this.storage.remove(record.version);
    this.token = 'missing'; this.blocked = false;
    this.publish({ draftStatus: 'clean', draftRevision: 0, draftError: undefined });
    if (this.options.revision() > this.options.savedRevision()) this.changed();
  }
  async download() { return this.storage ? (await this.storage.read()).text : null; }
  /** Last-tab close is already inside the native queue; use an inline snapshot. */
  async close(capture: () => Promise<DocumentDraft>) {
    clearTimeout(this.timer);
    if (this.options.revision() > this.state.draftRevision) {
      try { await this.persist(capture); } catch (error) { this.fail(error); }
    }
  }
}
