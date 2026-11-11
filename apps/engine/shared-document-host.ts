/**
 * Worker-owned document authority: native handles, shared history, drafts and
 * save transactions. engine/persistence owns draft recovery and serialized writes.
 * Engine modules may depend on shared contracts and fonts, never React, viewer state,
 * feature UI or platform adapters.
 */
import type { DraftLocation, PdfWritePlan, PdfWriteResult } from '../shared/pdf-file';
import { sha256 } from 'hash-wasm';
import { AbortablePromise, type LocalEngine, type LocalDocumentHandle, type OpenInput, type OpenOptions, type DocumentEvent } from '@embedpdf/engine-core/runtime';
import { captureBaseline, buildDraft, restoreDraft, type DraftBaseline, type DraftState } from './persistence/document-draft';
import { DraftSession } from './persistence/draft-session';
import { DraftConflict, openDraftStorage } from './persistence/draft-storage';
import { DocumentSaveCoordinator, ownedPdfBuffer } from './persistence/document-save';
export type SharedFileIdentity = string | FileSystemFileHandle;
export type SharedDocumentSnapshot = DraftState & {
  documentId: string; sessionKey: string; revision: number; savedRevision: number; diskVersion: string; saving: boolean;
  history: { global: { canUndo: boolean; canRedo: boolean } };
};
interface Entry {
  identity: SharedFileIdentity; document: LocalDocumentHandle; hashes: Set<string>; revision: number;
  persistence: DocumentSaveCoordinator; baseline: DraftBaseline | null; draft: DraftSession;
  undo: string[]; redo: string[]; traveling: boolean; restoring: boolean; manualRevision: number; protection?: string | null; password?: string;
}
/** Owns native v3 documents, op-id history and draft writers. Tabs hold only handles. */
export class SharedDocumentHost {
  private entries = new Map<string, Entry>();
  constructor(readonly engine: LocalEngine, private callbacks: {
    run<T>(operation: () => Promise<T>): Promise<T>;
    protect(bytes: Uint8Array, sourcePassword: string | undefined, password: string | null): Uint8Array;
    notify(id: string): void; event(id: string, event: DocumentEvent): void;
  }) {}
  protection(id: string) { return this.entries.get(id)?.protection; }
  document(id: string) { return this.entries.get(id)?.document; }
  all() { return [...this.entries.keys()]; }
  async open(identity: SharedFileIdentity, input: OpenInput, options?: OpenOptions, location?: DraftLocation) {
    if (input.kind !== 'bytes') throw new Error('Shared PDF sessions require original file bytes.');
    const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes);
    const hash = await sha256(bytes);
    let lane: DocumentSaveCoordinator['lane'] | undefined;
    for (const entry of this.entries.values()) {
      const same = typeof identity === 'string' ? identity === entry.identity : typeof entry.identity !== 'string' && await identity.isSameEntry(entry.identity);
      if (same) lane = entry.persistence.lane;
      if (same && (entry.hashes.has(hash) || entry.persistence.candidateVersion === hash)) return entry.document;
    }
    const nativeInput = { ...input, id: `pdf-ts:${crypto.randomUUID()}` };
    let doc = await this.engine.open(nativeInput, options);
    const persistence = new DocumentSaveCoordinator(hash, lane);
    const entry = { identity, document: doc, hashes: new Set([hash]), revision: 0, persistence,
      baseline: null, undo: [], redo: [], traveling: false, restoring: false, manualRevision: 0, password: options?.password } as unknown as Entry;
    const id = doc.id;
    entry.draft = new DraftSession({ lane: persistence.lane, revision: () => entry.revision, savedRevision: () => persistence.savedRevision,
      capture: () => this.callbacks.run(() => this.capture(id)), notify: () => this.callbacks.notify(id), settled: () => {} });
    this.entries.set(id, entry);
    if (doc.security.state.encryption.state !== 'none') entry.draft.unavailable('Encrypted PDFs require Save to PDF; automatic drafts are not stored in plaintext.');
    else {
      entry.baseline = await captureBaseline(doc);
      const draft = await entry.draft.initialize(openDraftStorage(identity, location), hash);
      if (draft) {
        try {
          await restoreDraft(doc, draft, entry.baseline);
          entry.revision = draft.revision; entry.draft.restored(draft.revision);
        } catch (error) {
          await doc.close();
          doc = await this.engine.open({ ...nativeInput, bytes: bytes.slice() }, options);
          entry.document = doc;
          entry.draft.fail(new DraftConflict(`Could not restore the .swp draft: ${String(error)}`));
        }
      }
    }
    const download = entry.document.download.bind(entry.document);
    entry.document.download = (options) => AbortablePromise.run(async signal => {
      const bytes = await download(options).abortWith(signal);
      return entry.protection === undefined ? bytes : this.callbacks.protect(bytes, entry.password, entry.protection);
    });
    entry.document.events.subscribe(event => {
      if (entry.restoring) return;
      const opId = 'origin' in event ? event.origin.transaction?.id : undefined;
      const undoable = 'meta' in event && event.meta.undoable;
      if (['document.versioned', 'pages.flattened', 'annotations.flattened', 'redaction.applied', 'forms.repaired', 'signatures.completed'].includes(event.type)) { entry.undo = []; entry.redo = []; }
      else if (opId && undoable && !entry.traveling && entry.undo.at(-1) !== opId) {
        entry.undo.push(opId); if (entry.undo.length > 4096) entry.undo.shift(); entry.redo = [];
      }
      // Each committed engine transaction publishes several typed events but is one edit.
      if (opId && lastOp !== opId) {
        lastOp = opId; entry.revision++;
        if (!event.type.startsWith('annotations.') && !event.type.startsWith('forms.value')) {
          entry.manualRevision = entry.revision; entry.draft.unavailable('These document changes require Save to PDF.');
        } else entry.draft.changed();
      }
      this.callbacks.event(id, event); this.callbacks.notify(id);
    });
    let lastOp: string | undefined;
    return entry.document;
  }
  state(id: string): SharedDocumentSnapshot {
    const e = this.entries.get(id)!;
    return { documentId: id, sessionKey: id, revision: e.revision, savedRevision: e.persistence.savedRevision,
      diskVersion: e.persistence.diskVersion, saving: e.persistence.saving, ...e.draft.state,
      history: { global: { canUndo: !!e.undo.length, canRedo: !!e.redo.length } } };
  }
  async travel(id: string, direction: 'undo' | 'redo') {
    const e = this.entries.get(id)!; const source = e[direction]; const opId = source.at(-1); if (!opId) return;
    e.traveling = true;
    try {
      const result = await e.document.apply({ undoOf: opId }); source.pop();
      if (result.meta.undoable) e[direction === 'undo' ? 'redo' : 'undo'].push(result.meta.opId);
    } finally { e.traveling = false; this.callbacks.notify(id); }
  }
  unlocked(id: string, password: string) { this.entries.get(id)!.password = password; }
  setProtection(id: string, password: string | null) {
    const e = this.entries.get(id)!;
    if (e.document.security.state.encryption.state === 'encrypted' && e.document.security.state.permissions.openedAs !== 'owner') throw new Error('The owner password is required.');
    e.protection = password; e.revision++; e.manualRevision = e.revision;
    e.draft.unavailable('Document security changes require Save to PDF.'); this.callbacks.notify(id); return true;
  }
  clearHistory(id: string) { const e = this.entries.get(id)!; e.undo = []; e.redo = []; this.callbacks.notify(id); }
  private async capture(id: string) {
    const e = this.entries.get(id)!;
    if (!e.baseline) throw new Error('Automatic drafts are unavailable for this PDF.');
    return buildDraft(e.document, e.persistence.diskVersion, e.revision, e.baseline);
  }
  save(id: string, write: (plan: PdfWritePlan) => Promise<PdfWriteResult>, assertConnected: () => void) {
    const e = this.entries.get(id)!;
    return e.persistence.save({ revision: () => e.revision, write, assertConnected,
      changed: async () => this.callbacks.notify(id),
      prepare: async () => {
        const pdf = await this.callbacks.run(async () => {
          const output = await e.document.download({ mode: 'rewrite' });
          const baseline = e.baseline ? await captureBaseline(e.document) : undefined;
          // download owns these bytes; reuse a full standalone buffer for transfer.
          const data = ownedPdfBuffer(output);
          return { data, hash: await sha256(output), revision: e.revision, baseline,
            draft: baseline && e.baseline ? await buildDraft(e.document, e.persistence.diskVersion, e.revision, e.baseline, baseline) : undefined };
        });
        if (pdf.draft) await e.draft.beforeMerge(pdf.draft, pdf.hash);
        return pdf;
      },
      committed: async pdf => {
        e.hashes.add(pdf.hash); e.baseline = pdf.baseline ?? null;
        await e.draft.afterMerge(e.protection === undefined && e.document.security.state.encryption.state === 'none' && e.manualRevision <= e.persistence.savedRevision);
      } });
  }
  async discardDraft(id: string) { await this.entries.get(id)!.draft.discard(); }
  async downloadDraft(id: string) { return this.entries.get(id)!.draft.download(); }
  async close(id: string) {
    const e = this.entries.get(id); if (!e) return;
    await e.persistence.lane.settled();
    await e.draft.close(() => this.callbacks.run(() => this.capture(id)));
    await this.callbacks.run(async () => { await e.document.close(); this.entries.delete(id); });
  }
}
