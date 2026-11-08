import { buildDraft, draftBaseline, resolveTarget, type DocumentDraft, type DraftBaseline, type DraftState } from './document-draft';
import { DraftSession } from './draft-session';
import { openDraftStorage, DraftConflict, type DraftLocation } from './draft-storage';
import { PdfAnnotationSubtype } from '@embedpdf/models';
import { diffAnnotations, type AnnotationPayload } from './annotation-sync';
import { DocumentSaveCoordinator, type PdfWritePlan, type PdfWriteResult, type SaveLane } from './document-save';
import { PluginRegistry, updateDocumentSecurity } from '@embedpdf/core';
import { PdfEngine as Engine, type PdfiumNative } from '@embedpdf/engines/pdfium';
import { browserImageDataToBlobConverter } from '@embedpdf/engines/converters';
import type { PdfDocumentObject, PdfFile, PdfOpenDocumentBufferOptions } from '@embedpdf/models';
import { DocumentManagerPluginPackage, type DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import { InteractionManagerPluginPackage } from '@embedpdf/plugin-interaction-manager';
import { SelectionPluginPackage } from '@embedpdf/plugin-selection';
import { AnnotationPluginPackage, type AnnotationCapability, type AnnotationEvent, type AnnotationDocumentState } from '@embedpdf/plugin-annotation';
import { FormPluginPackage, type FormCapability } from '@embedpdf/plugin-form';
import { HistoryPlugin, HistoryPluginPackage, type Command, type HistoryCapability, type HistoryDocumentState } from '@embedpdf/plugin-history';
import { sha256 } from 'hash-wasm';

export type SharedFileIdentity = string | FileSystemFileHandle;
export type SharedAnnotationEdit =
  | Pick<Extract<AnnotationEvent, { type: 'create' }>, 'type' | 'pageIndex' | 'annotation' | 'ctx'>
  | { type: 'update'; pageIndex: number; id: string; patch: Extract<AnnotationEvent, { type: 'update' }>['patch'] }
  | { type: 'delete'; pageIndex: number; id: string };
export type SharedDocumentSnapshot = DraftState & {
  documentId: string;
  sessionKey: string;
  security?: { permissions: number; isOwnerUnlocked: boolean };
  revision: number;
  savedRevision: number;
  diskVersion: string;
  saving: boolean;
  history: HistoryDocumentState;
};

export type SharedDocumentUpdate = SharedDocumentSnapshot & AnnotationPayload;

type Entry = {
  identity: SharedFileIdentity;
  hashes: Set<string>;
  document: PdfDocumentObject;
  revision: number;
  manualRevision?: number;
  persistence: DocumentSaveCoordinator;
  publishedAnnotations: AnnotationDocumentState['byUid'];
  baseline: DraftBaseline;
  draft: DraftSession;
};

/** A single SDK registry owns commands and native document handles in the worker.
 * History contains SDK closures, so no tab is elected as a disposable leader. */
export class SharedDocumentHost {
  readonly registry: PluginRegistry;
  private readonly entries = new Map<string, Entry>();
  private sequence = 0;
  private readonly instanceKey = Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
  private grouping: Command[] | null = null;
  private history!: HistoryCapability;
  private ready: Promise<void>;

  constructor(native: PdfiumNative, private readonly callbacks: { run<T>(operation: () => Promise<T>): Promise<T>; notify(id: string): void; settled(id: string): void }) {
    const host = this;
    class GroupedHistory extends HistoryPlugin {
      protected buildCapability(): HistoryCapability {
        const base = super.buildCapability();
        host.history = base;
        return { ...base, forDocument: (id) => {
          const scope = base.forDocument(id);
          return { ...scope, register(command, topic) {
            if (host.grouping) { host.grouping.push(command); command.execute(); }
            else scope.register(command, topic);
          } };
        } };
      }
    }
    const engine = new Engine<Blob>(native, { imageConverter: browserImageDataToBlobConverter });
    this.registry = new PluginRegistry(engine);
    this.registry.registerPlugin(DocumentManagerPluginPackage, { maxDocuments: 1000 });
    this.registry.registerPlugin(InteractionManagerPluginPackage);
    this.registry.registerPlugin(SelectionPluginPackage);
    this.registry.registerPlugin({ ...HistoryPluginPackage, create: (registry) => new GroupedHistory('history', registry) });
    this.registry.registerPlugin(AnnotationPluginPackage, { autoCommit: false });
    this.registry.registerPlugin(FormPluginPackage);
    this.ready = this.registry.initialize();
  }

  private get manager() { return this.registry.getPlugin('document-manager')!.provides!() as DocumentManagerCapability; }
  private get annotations() { return this.registry.getPlugin('annotation')!.provides!() as AnnotationCapability; }
  private get forms() { return this.registry.getPlugin('form')!.provides!() as FormCapability; }

  has(id: string) { return this.entries.has(id); }
  async open(identity: SharedFileIdentity, file: PdfFile, options?: PdfOpenDocumentBufferOptions, location?: DraftLocation) {
    await this.ready;
    const hash = await sha256(new Uint8Array(file.content));
    let saveLane: SaveLane | undefined;
    for (const entry of this.entries.values()) {
      const same = typeof identity === 'string' ? entry.identity === identity
        : typeof entry.identity !== 'string' && await identity.isSameEntry(entry.identity);
      if (same) saveLane = entry.persistence.lane;
      if (same && (entry.hashes.has(hash) || entry.persistence.candidateVersion === hash)) return { document: entry.document, fresh: false };
    }
    const id = `shared-document-${++this.sequence}`;
    const opened = await this.manager.openDocumentBuffer({
      buffer: file.content, name: 'document.pdf', documentId: id, password: options?.password,
    }).toPromise();
    try {
      let document = await new Promise<PdfDocumentObject>((resolve, reject) => opened.task.wait(resolve, reject));
      // SDK annotation loading runs from the document-open callback.
      await this.settle();
      const persistence = new DocumentSaveCoordinator(hash, saveLane);
      const draft = new DraftSession({ lane: persistence.lane,
        revision: () => this.entries.get(id)!.revision, savedRevision: () => persistence.savedRevision,
        capture: () => this.callbacks.run(() => this.captureDraft(id)),
        notify: () => this.callbacks.notify(id), settled: () => this.callbacks.settled(id),
      });
      this.entries.set(id, { identity, hashes: new Set([hash]), document, revision: 0, persistence,
        publishedAnnotations: this.annotations.forDocument(id).getState().byUid,
        baseline: this.captureBaseline(id), draft });
      if (document.isEncrypted) {
        draft.unavailable('Automatic drafts are disabled for encrypted PDFs. Use Save to PDF to preserve your edits securely.');
      } else {
        const recovered = await draft.initialize(openDraftStorage(identity, location), hash);
        if (recovered) {
          try {
            await this.restoreDraft(id, recovered);
            this.entries.get(id)!.revision = Math.max(1, recovered.revision);
            draft.restored(this.entries.get(id)!.revision);
          } catch (error) {
            // Roll back a failed replay by reopening the unchanged original.
            // No half-restored state is allowed to escape to any tab.
            await this.manager.closeDocument(id).toPromise();
            const reopened = await this.manager.openDocumentBuffer({
              buffer: file.content, name: 'document.pdf', documentId: id, password: options?.password,
            }).toPromise();
            document = await new Promise<PdfDocumentObject>((resolve, reject) => reopened.task.wait(resolve, reject));
            await this.settle();
            const entry = this.entries.get(id)!;
            entry.document = document;
            entry.baseline = this.captureBaseline(id);
            entry.publishedAnnotations = this.annotations.forDocument(id).getState().byUid;
            draft.fail(new DraftConflict(`Could not restore the .swp draft: ${String(error)}`));
          }
        }
      }
      return { document, fresh: true };
    } catch (error) {
      await this.manager.closeDocument(id).toPromise();
      throw error;
    }
  }

  async close(id: string) {
    await this.entries.get(id)!.draft.close(() => this.captureDraft(id));
    await this.manager.closeDocument(id).toPromise();
    this.entries.delete(id);
  }

  private async settle() {
    // SDK form history commands return void but finish their native tasks in a
    // microtask chain. Native executor tasks are synchronous; let that chain
    // drain before accepting the next operation or taking a snapshot.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  saveState(id: string) {
    const { diskVersion, savedRevision, saving } = this.entries.get(id)!.persistence;
    return { diskVersion, savedRevision, saving, ...this.entries.get(id)!.draft.state };
  }

  state(id: string): SharedDocumentSnapshot {
    const entry = this.entries.get(id)!;
    return {
      documentId: id, sessionKey: `${this.instanceKey}:${id}`, revision: entry.revision,
      ...this.saveState(id), history: this.history.forDocument(id).getHistoryState(),
      security: entry.document.isOwnerUnlocked ? { permissions: entry.document.permissions, isOwnerUnlocked: true } : undefined,
    };
  }

  snapshot(id: string): SharedDocumentUpdate {
    return { ...this.state(id), annotations: this.annotations.forDocument(id).getState().byUid };
  }

  update(id: string, confirmIds: string[] = []): SharedDocumentUpdate {
    const entry = this.entries.get(id)!;
    const current = this.annotations.forDocument(id).getState().byUid;
    const changes = diffAnnotations(entry.publishedAnnotations, current, confirmIds);
    entry.publishedAnnotations = current;
    return { ...this.state(id), ...(changes.upsert.length || changes.removed.length ? { changes } : {}) };
  }

  async edit(id: string, edits: SharedAnnotationEdit[]) {
    const scope = this.annotations.forDocument(id);
    const commands: Command[] = [];
    this.grouping = commands;
    try {
      for (const edit of edits) {
        if (edit.type === 'create') scope.createAnnotation(edit.pageIndex, edit.annotation, edit.ctx);
        else if (edit.type === 'update') scope.updateAnnotation(edit.pageIndex, edit.id, edit.patch);
        else if (scope.getState().byUid[edit.id]?.commitState !== 'deleted') scope.deleteAnnotation(edit.pageIndex, edit.id);
      }
    } finally { this.grouping = null; }
    if (commands.length) {
      let first = true;
      this.history.forDocument(id).register({
        execute() { if (first) first = false; else commands.forEach((command) => command.execute()); },
        undo() { [...commands].reverse().forEach((command) => command.undo()); },
      }, 'annotation');
      await scope.commit().toPromise();
      if (scope.getState().hasPendingChanges) throw new Error('PDFium could not commit all edits; saving is blocked until they succeed.');
      this.edited(id);
    }
  }

  async form(id: string, method: 'setFormFieldValues' | 'setFormValues' | 'renameField' | 'shareField', args: unknown[]) {
    const scope = this.forms.forDocument(id);
    const operation = scope[method] as (...args: unknown[]) => { toPromise(): Promise<unknown> };
    const result = await operation(...args).toPromise();
    await this.settle();
    this.edited(id);
    if (method === 'renameField' || method === 'shareField') {
      const entry = this.entries.get(id)!;
      entry.manualRevision = entry.revision;
      entry.draft.unavailable('Field structure changes require Save to PDF.');
    }
    return result;
  }

  async travel(id: string, direction: 'undo' | 'redo') {
    const history = this.history.forDocument(id);
    if (!(direction === 'undo' ? history.canUndo() : history.canRedo())) return;
    history[direction]();
    await this.settle();
    await this.annotations.forDocument(id).commit().toPromise();
    this.edited(id);
  }

  private async serialize(id: string) {
    const entry = this.entries.get(id)!;
    const scope = this.annotations.forDocument(id);
    if (scope.getState().hasPendingChanges) {
      await scope.commit().toPromise();
      if (scope.getState().hasPendingChanges) throw new Error('PDF edits have not finished committing.');
    }
    const data = await this.registry.getEngine().saveAsCopy(entry.document).toPromise();
    return { data, revision: entry.revision, hash: await sha256(new Uint8Array(data)),
      baseline: this.captureBaseline(id), draft: await this.captureDraft(id) };
  }

  isSaving(id: string) { const entry = this.entries.get(id); return !!entry && (entry.persistence.saving || entry.draft.running); }
  document(id: string) { return this.entries.get(id)?.document; }

  save(id: string, write: (plan: PdfWritePlan) => Promise<PdfWriteResult>,
    runNative: <T>(operation: () => Promise<T>) => Promise<T>, changed: () => Promise<void>, assertConnected: () => void) {
    const entry = this.entries.get(id)!;
    return entry.persistence.save({
      revision: () => entry.revision,
      prepare: async () => {
        const pdf = await runNative(() => this.serialize(id));
        await entry.draft.beforeMerge(pdf.draft, pdf.hash);
        return pdf;
      }, write,
      committed: async (pdf) => {
        await runNative(async () => { entry.hashes.add(pdf.hash); entry.baseline = pdf.baseline!; });
        await entry.draft.afterMerge(!entry.document.isEncrypted && (entry.manualRevision ?? 0) <= entry.persistence.savedRevision);
      }, changed, assertConnected,
    });
  }

  unlocked(id: string) {
    this.registry.getStore().dispatch(updateDocumentSecurity(id, 0xffffffff, true));
    this.entries.get(id)!.document = this.manager.getDocument(id)!;
  }

  changed(id: string, encrypted?: boolean) {
    const entry = this.entries.get(id)!;
    entry.revision++;
    entry.manualRevision = entry.revision;
    if (encrypted !== undefined) entry.document = { ...entry.document, isEncrypted: encrypted };
    entry.draft.unavailable('Document metadata or security changes require Save to PDF.');
  }

  private edited(id: string) {
    const entry = this.entries.get(id)!;
    entry.revision++;
    entry.draft.changed();
  }

  private captureBaseline(id: string): DraftBaseline {
    const scope = this.annotations.forDocument(id);
    const state = scope.getState();
    const annotations = Object.keys(state.pages).map(Number).sort((a, b) => a - b)
      .flatMap(page => state.pages[page].map(uid => state.byUid[uid]))
      .filter(item => item && item.commitState !== 'deleted').map(item => item.object);
    return draftBaseline(annotations, this.forms.forDocument(id).getFormValues());
  }

  private async captureDraft(id: string): Promise<DocumentDraft> {
    const entry = this.entries.get(id)!;
    const current = this.captureBaseline(id);
    const draft = buildDraft(entry.persistence.diskVersion, entry.revision, entry.baseline, current.annotations, current.formValues);
    // Only changed stamps need binary resources. Existing scanned pages/images
    // are never serialized into the draft.
    for (const change of draft.upsert) {
      const annotation = change.item.annotation;
      if (annotation.type === PdfAnnotationSubtype.STAMP && !change.target) {
        const page = entry.document.pages[annotation.pageIndex];
        const data = await this.registry.getEngine().exportAnnotationAppearanceAsPdf(entry.document, page, annotation).toPromise();
        change.item.ctx = { data, mimeType: 'application/pdf' };
      }
    }
    return draft;
  }

  private async restoreDraft(id: string, draft: DocumentDraft) {
    const entry = this.entries.get(id)!;
    const baseline = entry.baseline.annotations;
    // The original bytes must match before ordinal fallback is ever used.
    const remap = new Map(draft.targets.map(target => [target.id, resolveTarget(target, baseline).id]));
    const scope = this.annotations.forDocument(id);
    const changes = draft.upsert.map(change => {
      const annotation = structuredClone(change.item.annotation);
      if (annotation.pageIndex >= entry.document.pageCount) throw new Error('Draft page does not exist.');
      if (change.target) {
        const original = resolveTarget(change.target, baseline);
        if (original.type !== annotation.type) throw new Error('Draft annotation type does not match the original.');
        annotation.id = original.id;
      }
      if (annotation.inReplyToId) annotation.inReplyToId = remap.get(annotation.inReplyToId) ?? annotation.inReplyToId;
      return { ...change, item: { ...change.item, annotation } };
    });
    const removed = draft.removed.map(target => resolveTarget(target, baseline));
    for (const { target, item } of changes) {
      if (target) scope.updateAnnotation(item.annotation.pageIndex, item.annotation.id, item.annotation);
      else scope.createAnnotation(item.annotation.pageIndex, item.annotation, item.ctx as never);
    }
    for (const annotation of removed) scope.deleteAnnotation(annotation.pageIndex, annotation.id);
    await scope.commit().toPromise();
    if (scope.getState().hasPendingChanges) throw new Error('Draft annotations could not be restored.');
    if (Object.keys(draft.formValues).length) await this.forms.forDocument(id).setFormValues(draft.formValues).toPromise();
    await this.settle();
  }

  async discardDraft(id: string) { await this.entries.get(id)!.draft.discard(); }
  async downloadDraft(id: string) { return this.entries.get(id)!.draft.download(); }
}
