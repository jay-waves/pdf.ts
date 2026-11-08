import { applyAnnotationPayload, mergeAnnotationPayload } from './annotation-sync';
import type { PdfFileWriter } from '../platform/types';
import type { PdfWritePlan, PdfWriteResult } from './document-save';
import { createEmitter, refreshPages, updateDocumentSecurity, type PluginRegistry } from '@embedpdf/core';
import { PdfErrorCode, Task, type PdfEngine, type PdfTask, type PdfAnnotationObject, type PdfErrorReason, type PdfAnnotationsProgress } from '@embedpdf/models';
import type { DocumentManagerCapability } from '@embedpdf/plugin-document-manager';
import { type AnnotationCapability } from '@embedpdf/plugin-annotation';
import { FormPlugin, FormPluginPackage, type FormCapability, type FormScope } from '@embedpdf/plugin-form';
import { HistoryPlugin, HistoryPluginPackage, type Command, type HistoryCapability, type HistoryChangeEvent, type HistoryDocumentState } from '@embedpdf/plugin-history';
import type { SharedAnnotationEdit, SharedDocumentSnapshot, SharedDocumentUpdate, SharedFileIdentity } from './shared-document-host';

const clients = new WeakMap<PdfEngine<Blob>, SharedDocumentClient>();
const emptyHistory: HistoryDocumentState = { global: { canUndo: false, canRedo: false }, topics: {} };
type Reply = { result?: unknown; snapshot: SharedDocumentUpdate };
type Send = <T>(method: string, args: unknown[]) => PdfTask<T>;

export function getSharedDocumentClient(engine: PdfEngine<Blob>) { return clients.get(engine); }

/** Per-tab bridge: interaction stays local; only declarative edits cross the port. */
export class SharedDocumentClient {
  private registry?: PluginRegistry;
  private identity?: SharedFileIdentity;
  private draftLocation?: import('./draft-storage').DraftLocation;
  private capturing: SharedAnnotationEdit[] | null = null;
  private pending = new Map<string, number>();
  private deferred = new Map<string, SharedDocumentUpdate>();
  private snapshots = new Map<string, SharedDocumentSnapshot>();
  private bootstrap = new Map<string, SharedDocumentUpdate>();
  private operations = new Set<Promise<unknown>>();
  private writerSequence = 0;
  private writers = new Map<string, PdfFileWriter>();
  private failures = new Map<string, unknown>();
  readonly changes = createEmitter<SharedDocumentSnapshot>();
  readonly histories = createEmitter<HistoryChangeEvent>();
  private unbind?: () => void;

  constructor(readonly engine: PdfEngine<Blob>, private readonly send: Send, worker: Worker) {
    clients.set(engine, this);
    const open = engine.openDocumentBuffer.bind(engine);
    engine.openDocumentBuffer = (file, options) => open({ ...file, sharedIdentity: this.identity, draftLocation: this.draftLocation } as typeof file, options);
    const readAnnotations = engine.getAllAnnotations.bind(engine);
    engine.getAllAnnotations = (document) => {
      // Keep the SDK's normal loading lifecycle, but source its initial data
      // from the authoritative registry instead of rescanning every PDF page.
      if (!this.registry?.getStore().getState().core.documents[document.id]?.document) return readAnnotations(document);
      const task = new Task<Record<number, PdfAnnotationObject[]>, PdfErrorReason, PdfAnnotationsProgress>();
      this.send<Reply>('sharedSnapshot', [document]).wait((reply) => {
        const pages: Record<number, PdfAnnotationObject[]> = {};
        for (const tracked of Object.values(reply.snapshot.annotations ?? {})) {
          if (tracked.commitState !== 'deleted') (pages[tracked.object.pageIndex] ??= []).push(tracked.object);
        }
        if (!this.snapshots.has(document.id)) this.bootstrap.set(document.id, reply.snapshot);
        task.resolve(pages);
      }, (error) => task.fail(error));
      return task;
    };
    worker.addEventListener('message', (event) => {
      if (event.data.type === 'sharedDocument') this.receive(event.data.snapshot);
      if (event.data.type === 'sharedSaveState') {
        const state = event.data.state;
        const current = this.deferred.get(state.documentId) ?? this.snapshots.get(state.documentId);
        if (current) this.receive({ ...current, ...state });
      }
      if (event.data.type === 'writePdf') {
        const { id, writerId, plan } = event.data as { id: string; writerId: string; plan: PdfWritePlan };
        const writer = this.writers.get(writerId);
        void (async () => {
          try {
            if (!writer) throw new Error('The save destination is no longer available.');
            const result: PdfWriteResult = writer.writeShared ? await writer.writeShared(plan)
              : await writer.save(plan.data) ? { status: 'copy' } : { status: 'cancelled' };
            worker.postMessage({ type: 'writePdfResult', id, result });
          } catch (error) {
            worker.postMessage({ type: 'writePdfResult', id, error: error instanceof Error ? error.message : String(error) });
          }
        })();
      }
    });
  }

  setIdentity(identity: SharedFileIdentity, draftLocation?: import('./draft-storage').DraftLocation) { this.identity = identity; this.draftLocation = draftLocation; }
  getSnapshot(id: string) { return this.snapshots.get(id); }
  getHistory(id: string) { return this.snapshots.get(id)?.history ?? emptyHistory; }
  private document(id: string) {
    const document = this.registry?.getStore().getState().core.documents[id]?.document;
    if (!document) throw new Error('Document is not ready.');
    return document;
  }

  bind(registry: PluginRegistry) {
    this.unbind?.();
    this.registry = registry;
    this.snapshots.clear();
    this.bootstrap.clear();
    this.failures.clear();
    this.deferred.clear();
    const annotation = registry.getPlugin('annotation')!.provides!() as AnnotationCapability;
    const unsubscribe = annotation.onAnnotationEvent((event) => {
      if (event.type === 'loaded') {
        const snapshot = this.bootstrap.get(event.documentId);
        this.bootstrap.delete(event.documentId);
        if (snapshot) this.receive(snapshot);
        else void this.request(event.documentId, 'sharedSnapshot').catch(this.reportError);
      } else if (!event.committed) {
        const edit: SharedAnnotationEdit = event.type === 'create'
          ? { type: event.type, pageIndex: event.pageIndex, annotation: event.annotation, ctx: event.ctx }
          : event.type === 'update'
            ? { type: event.type, pageIndex: event.pageIndex, id: event.annotation.id, patch: event.patch }
            : { type: event.type, pageIndex: event.pageIndex, id: event.annotation.id };
        if (this.capturing) this.capturing.push(edit);
        else void this.request(event.documentId, 'sharedEdit', [[edit]]).catch(this.reportError);
      }
    });
    const manager = registry.getPlugin('document-manager')!.provides!() as DocumentManagerCapability;
    const onClose = manager.onDocumentClosed((id) => {
      this.snapshots.delete(id);
      this.bootstrap.delete(id);
      this.failures.delete(id);
      this.deferred.delete(id);
    });
    this.unbind = () => { unsubscribe(); onClose(); };
  }

  capture(id: string, command: Command) {
    const edits: SharedAnnotationEdit[] = [];
    this.capturing = edits;
    try { command.execute(); } finally { this.capturing = null; }
    if (edits.length) void this.request(id, 'sharedEdit', [edits]).catch(this.reportError);
  }

  private reportError = (error: unknown) => {
    console.error('[pdf-ts] Shared document operation failed', error);
    // Never silently leave a local optimistic edit pretending to be saved.
    window.alert(`PDF edit could not be synchronized: ${error instanceof Error ? error.message : String(error)}`);
  };

  async flush() {
    while (this.operations.size) await Promise.all([...this.operations]);
    if (this.failures.size) throw new Error('An edit failed to synchronize. Reload the document before saving.');
  }

  async save(id: string, writer: PdfFileWriter): Promise<boolean> {
    await this.flush();
    const writerId = String(++this.writerSequence);
    this.writers.set(writerId, writer);
    try {
      const saved = await this.send<boolean>('sharedSave', [this.document(id), {
        writerId,
      }]).toPromise();
      return saved;
    } finally { this.writers.delete(writerId); }
  }

  async request(id: string, method: string, args: unknown[] = []) {
    const document = this.document(id);
    this.pending.set(id, (this.pending.get(id) ?? 0) + 1);
    const operation = this.send<Reply>(method, [document, ...args]).toPromise();
    this.operations.add(operation);
    try {
      const reply = await operation;
      this.receive(reply.snapshot);
      return reply;
    } catch (error) {
      if (['sharedEdit', 'sharedForm', 'sharedUndo', 'sharedRedo'].includes(method)) this.failures.set(id, error);
      throw error;
    } finally {
      this.operations.delete(operation);
      const pending = this.pending.get(id)! - 1;
      this.pending.set(id, pending);
      if (!pending) {
        const snapshot = this.deferred.get(id);
        this.deferred.delete(id);
        if (snapshot) this.receive(snapshot);
      }
    }
  }

  task<T>(id: string, method: string, args: unknown[]): PdfTask<T> {
    const task = new Task<T, { code: PdfErrorCode; message: string }>();
    this.request(id, method, args).then(
      (reply) => task.resolve(reply.result as T),
      (error) => task.reject({ code: PdfErrorCode.Unknown, message: String(error) }),
    );
    return task;
  }

  travel(id: string, direction: 'Undo' | 'Redo') {
    void this.request(id, `shared${direction}`).catch(this.reportError);
  }

  private receive(update: SharedDocumentUpdate) {
    const id = update.documentId;
    if ((this.pending.get(id) ?? 0) > 0) {
      const previous = this.deferred.get(id);
      if (!previous || previous.revision <= update.revision) {
        this.deferred.set(id, previous ? { ...update, ...mergeAnnotationPayload(previous, update) } : update);
      }
      return;
    }
    const registry = this.registry;
    if (!registry?.getStore().getState().core.documents[id]?.document) return;
    const previous = this.snapshots.get(id);
    if (previous && previous.revision > update.revision) return;
    // A new tab obtains its baseline through sharedSnapshot. Earlier deltas
    // cannot replace that baseline; the ordered port ensures the join catches up.
    if (!previous && !update.annotations) return;
    const { annotations, changes, ...snapshot } = update;
    this.snapshots.set(id, snapshot);
    if (snapshot.security) registry.getStore().dispatch(updateDocumentSecurity(id, snapshot.security.permissions, snapshot.security.isOwnerUnlocked));
    const annotation = registry.getPlugin('annotation')!.provides!() as AnnotationCapability;
    const scope = annotation.forDocument(id);
    if (annotations || changes) {
      const applied = applyAnnotationPayload(scope.getState(), { annotations, changes });
      registry.getStore().dispatchToPlugin('annotation', {
        type: 'ANNOTATION/INIT_STATE', payload: { documentId: id, state: applied.state },
      });
      for (const pageIndex of applied.pageIndices) scope.invalidatePageAppearances(pageIndex);
      if (applied.pageIndices.length) registry.getStore().dispatch(refreshPages(id, applied.pageIndices));
    }
    if (!previous || previous.revision !== snapshot.revision) {
      registry.getStore().dispatchToPlugin('history', {
        type: 'HISTORY/SET_DOCUMENT_STATE', payload: { documentId: id, state: snapshot.history },
      });
      this.histories.emit({ documentId: id, topic: undefined, state: snapshot.history });
    }
    if (!previous || previous.revision !== snapshot.revision || previous.savedRevision !== snapshot.savedRevision
      || previous.saving !== snapshot.saving || previous.diskVersion !== snapshot.diskVersion
      || previous.draftStatus !== snapshot.draftStatus || previous.draftRevision !== snapshot.draftRevision || previous.draftError !== snapshot.draftError) this.changes.emit(snapshot);
  }

}

class SharedHistoryPlugin extends HistoryPlugin {
  private get client() { return clients.get(this.engine as PdfEngine<Blob>)!; }
  async initialize(config: object) { await super.initialize(config); this.client.bind(this.registry); }
  protected buildCapability(): HistoryCapability {
    const client = this.client;
    const forDocument: HistoryCapability['forDocument'] = (id) => ({
      register: (command) => client.capture(id, command),
      undo: () => client.travel(id, 'Undo'), redo: () => client.travel(id, 'Redo'),
      canUndo: () => client.getHistory(id).global.canUndo,
      canRedo: () => client.getHistory(id).global.canRedo,
      getHistoryState: () => client.getHistory(id),
      onHistoryChange: (listener: (topic: string | undefined) => void) => client.histories.on((event) => { if (event.documentId === id) listener(event.topic); }),
      purgeByMetadata: () => 0,
    });
    const active = () => forDocument(this.registry.getStore().getState().core.activeDocumentId!);
    return {
      forDocument,
      register: (command, topic) => active().register(command, topic),
      undo: () => active().undo(), redo: () => active().redo(),
      canUndo: () => active().canUndo(), canRedo: () => active().canRedo(),
      getHistoryState: () => active().getHistoryState(),
      onHistoryChange: client.histories.on,
      purgeByMetadata: () => 0,
    };
  }
}

class SharedFormPlugin extends FormPlugin {
  protected buildCapability(): FormCapability {
    const base = super.buildCapability();
    const client = clients.get(this.engine as PdfEngine<Blob>)!;
    const forDocument = (id: string): FormScope => ({
      ...base.forDocument(id),
      setFormFieldValues: (...args) => client.task(id, 'sharedForm', ['setFormFieldValues', args]),
      setFormValues: (...args) => client.task(id, 'sharedForm', ['setFormValues', args]),
      renameField: (...args) => client.task(id, 'sharedForm', ['renameField', args]),
      shareField: (...args) => client.task(id, 'sharedForm', ['shareField', args]),
    });
    const scope = (id?: string) => forDocument(id ?? this.registry.getStore().getState().core.activeDocumentId!);
    return { ...base, forDocument,
      setFormFieldValues: (page, annotation, field, id) => scope(id).setFormFieldValues(page, annotation, field),
      setFormValues: (values, id) => scope(id).setFormValues(values),
      renameField: (annotation, name, id) => scope(id).renameField(annotation, name),
      shareField: (annotation, target, id) => scope(id).shareField(annotation, target),
    };
  }
}

export const SharedHistoryPluginPackage = { ...HistoryPluginPackage, create: (registry: PluginRegistry) => new SharedHistoryPlugin('history', registry) };
export const SharedFormPluginPackage = { ...FormPluginPackage, create: (registry: PluginRegistry) => new SharedFormPlugin('form', registry, {}) };
