import { decodeEngineResult } from './engine-wire';
import { createEventHook } from '@embedpdf/core';
import { historyPlugin } from '@embedpdf/plugin-history';
import { AbortablePromise, checkCapability, checkPluginPermission, pluginOfPermission,
  checkCollab, checkSetGroup, checkFieldAction, fieldRightsOf, collabTargetOf, permissionFlagsOf,
  type Engine, type DocumentHandle, type DocumentEvent, type DocumentSecurityService, type OpenInput, type OpenOptions,
  type PageRef } from '@embedpdf/engine-core/runtime';
import type { PdfRenderTheme } from './pdf-render-theme';
import type { PdfFontFallbackConfig, PdfFontDiagnostic } from '../fonts/types';
import type { LocalEngineRecipeOptions } from '@embedpdf/engine';
import { createPdfWorker } from './pdf-worker-transport';
import type { SharedDocumentSnapshot, SharedFileIdentity } from './shared-document-host';
import type { DraftLocation } from './draft-storage';
import type { PdfFileWriter } from '../platform/types';
import type { PdfWritePlan } from './document-save';
const clients = new WeakMap<Engine, SharedDocumentClient>();
export function getSharedDocumentClient(engine: Engine) { return clients.get(engine); }
export function getRuntimeDocument(engine: Engine, id: string) { return clients.get(engine)?.getDocument(id) ?? null; }
type Security = Pick<DocumentSecurityService, 'state' | 'scope' | 'identity' | 'passwordPrompt'>;
type Path = Array<string | { page: PageRef } | { with: unknown }>;
function emitter<T>() { const listeners = new Set<(value: T) => void>(); return { on(fn: (value: T) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }, emit(value: T) { for (const fn of listeners) fn(value); } }; }
/** A v3 Engine boundary. All mutation results and events come from one worker-owned document. */
export class SharedDocumentClient {
  readonly engine: Engine;
  readonly changes = emitter<SharedDocumentSnapshot>();
  private sequence = 0;
  private calls = new Map<string, { resolve(value: any): void; reject(error: unknown): void }>();
  private aliases = new Map<string, string>();
  private documents = new Map<string, DocumentHandle>();
  private snapshots = new Map<string, SharedDocumentSnapshot>();
  private events = new Map<string, ReturnType<typeof emitter<DocumentEvent>>>();
  private securities = new Map<string, Security>();
  private scopes = new Map<string, readonly string[]>();
  private writers = new Map<string, PdfFileWriter>();
  private identity?: SharedFileIdentity;
  private draftLocation?: DraftLocation;
  readonly flushers = new Set<() => Promise<void>>();
  readonly ready: Promise<void>;
  constructor(private worker: Worker, options: LocalEngineRecipeOptions & { fontFallback?: PdfFontFallbackConfig | null } = {}) {
    this.ready = new Promise((resolve, reject) => {
      worker.addEventListener('message', event => {
        const m = event.data;
        if (m.type === 'ready') resolve();
        if (m.type === 'error') reject(new Error(m.error || 'PDF engine initialization failed.'));
        if (m.type === 'result') {
          const call = this.calls.get(m.id); if (!call) return; this.calls.delete(m.id);
          if (m.error) call.reject(Object.assign(new Error(m.error.message), m.error)); else call.resolve(decodeEngineResult(m.result));
        }
        if (m.type === 'sharedDocument') {
          this.snapshots.set(m.snapshot.documentId, m.snapshot);
          for (const [id, nativeId] of this.aliases) if (nativeId === m.snapshot.documentId) this.changes.emit({ ...m.snapshot, documentId: id });
        }
        if (m.type === 'securityState') this.securities.set(m.documentId, m.security);
        if (m.type === 'documentEvent') {
          this.securities.set(m.documentId, m.security);
          this.events.get(m.documentId)?.emit(m.event);
        }
        if (m.type === 'writePdf') void this.write(m);
      });
      worker.addEventListener('error', event => {
        const error = new Error(event.message || 'PDF worker failed.'); reject(error);
        for (const call of this.calls.values()) call.reject(error); this.calls.clear();
      });
    });
    this.engine = {
      canOpenFiles: true,
      open: (input, openOptions) => this.open(input, openOptions),
      destroy: () => AbortablePromise.run(async () => {
        await Promise.all([...this.documents.values()].map(doc => doc.close())); this.worker.terminate();
        for (const call of this.calls.values()) call.reject(new Error('PDF engine disposed.')); this.calls.clear();
      }),
    };
    clients.set(this.engine, this);
    worker.postMessage({ type: 'init', options });
  }
  private rpc<T>(type: string, data: object = {}): AbortablePromise<T> {
    const id = `rpc-${++this.sequence}`;
    return new AbortablePromise<T>((resolve, reject, _progress, signal) => {
      this.calls.set(id, { resolve, reject });
      signal.addEventListener('abort', () => { this.calls.delete(id); this.worker.postMessage({ type: 'abort', id }); }, { once: true });
      void this.ready.then(() => { if (!signal.aborted) this.worker.postMessage({ ...data, type, id }); }).catch(reject);
    });
  }
  private open(input: OpenInput, options?: OpenOptions): AbortablePromise<DocumentHandle> {
    return AbortablePromise.run(async signal => {
      const reply = await this.rpc<{ id: string; security: Security; snapshot: SharedDocumentSnapshot }>('open', {
        args: [input, options, this.identity ?? `unshared:${crypto.randomUUID()}`, this.draftLocation],
      }).abortWith(signal);
      this.securities.set(reply.id, reply.security); this.scopes.set(reply.id, options?.scope ?? ['*']);
      this.snapshots.set(reply.id, reply.snapshot);
      const publicId = 'id' in input && input.id ? input.id : reply.id;
      const existing = this.documents.get(publicId); if (existing) return existing;
      this.aliases.set(publicId, reply.id);
      const events = this.events.get(reply.id) ?? emitter<DocumentEvent>(); this.events.set(reply.id, events);
      const held: number[] = [];
      const client = this;
      const security = new Proxy({}, { get(_target, property: string) {
        const state = client.securities.get(reply.id)!;
        const rawScope = client.scopes.get(reply.id)!;
        const flags = state.state.permissions.flags ?? permissionFlagsOf(null);
        if (property in state) return state[property as keyof Security];
        if (property === 'allows') return (permission: string) => pluginOfPermission(permission) === null
          ? checkCapability(permission as Parameters<typeof checkCapability>[0], rawScope, flags)
          : checkPluginPermission(permission, rawScope, new Set([permission]));
        if (property === 'allowsAnnotation') return (action: any, target: any = {}) => action === 'set-group'
          ? checkSetGroup('annotations', target.groupId, state.identity?.groupId, rawScope)
          : checkCollab(action, action === 'create' ? { userId: state.identity?.userId, groupId: state.identity?.groupId } : collabTargetOf(target), rawScope, state.identity ?? {}, flags);
        if (property === 'allowsField') return (action: any, target: any) => action === 'set-group'
          ? checkSetGroup('fields', target.groupId, state.identity?.groupId, rawScope)
          : checkFieldAction(action, target.groupId, rawScope, flags);
        if (property === 'fieldRights') return () => fieldRightsOf(rawScope, flags, null, state.identity?.groupId);
        return (...args: unknown[]) => client.rpc('call', { documentId: reply.id, path: ['security'], method: property, args });
      } });
      const services = new Set(['metadata', 'annotations', 'actions', 'attachments', 'forms', 'fonts', 'outline', 'search', 'render', 'pages', 'redaction', 'signatures', 'text', 'measure', 'pieceInfo', 'custom']);
      const build = (path: Path = []): any => new Proxy({}, { get(_target, property: string | symbol) {
        if (typeof property !== 'string' || property === 'then' || property === 'grant') return undefined;
        if (!path.length && property === 'id') return publicId;
        if (!path.length && property === 'security') return security;
        if (property === 'events') return { subscribe: events.on, on: (type: string, fn: (e: DocumentEvent) => void) => events.on(e => { if (e.type === type) fn(e); }), lastServerSequence: () => null };
        if (property === 'objectNumbers') return { take: () => held.shift() ?? null, get held() { return held.length; },
          reserve: (count: number) => AbortablePromise.run(async () => {
            if (held.length < count) held.push(...await client.rpc<number[]>('reserve', { documentId: reply.id, args: [count - held.length] }));
          }), onLost: () => () => {} };
        if (property === 'page') return (page: PageRef) => build([...path, { page }]);
        if (property === 'with') return (facts: unknown) => build([...path, { with: facts }]);
        if (property === 'ref') return (path.find(p => typeof p === 'object' && 'page' in p) as { page: PageRef } | undefined)?.page;
        if (services.has(property)) return build([...path, property]);
        if (property === 'close') return () => AbortablePromise.run(async () => {
          client.documents.delete(publicId); client.aliases.delete(publicId);
          if (![...client.aliases.values()].includes(reply.id)) {
            await client.rpc('close', { documentId: reply.id }); client.events.delete(reply.id); client.snapshots.delete(reply.id);
          }
        });
        return (...args: unknown[]) => {
          const task = client.rpc<any>('call', { documentId: reply.id, path, method: property, args });
          if (property === 'setWorkingSet') { void task.catch(() => {}); return; }
          return task;
        };
      } });
      const doc = build() as DocumentHandle; this.documents.set(publicId, doc);
      this.changes.emit({ ...reply.snapshot, documentId: publicId });
      return doc;
    });
  }
  private nativeId(id: string) { return this.aliases.get(id) ?? id; }
  setRenderTheme(theme: PdfRenderTheme | null) { return this.rpc<boolean>('theme', { args: [theme] }); }
  getFontDiagnostics() { return this.rpc<PdfFontDiagnostic[]>('fontDiagnostics'); }
  setIdentity(identity: SharedFileIdentity, location?: DraftLocation) { this.identity = identity; this.draftLocation = location; }
  getDocument(id: string) { return this.documents.get(id) ?? null; }
  getSnapshot(id: string) { const value = this.snapshots.get(this.nativeId(id)); return value ? { ...value, documentId: id } : undefined; }
  getHistory(id: string) { return this.getSnapshot(id)?.history ?? { global: { canUndo: false, canRedo: false } }; }
  request(id: string, method: string, args: unknown[] = []) { return this.rpc<any>('command', { documentId: this.nativeId(id), method, args }); }
  async flush() { await Promise.all([...this.flushers].map(flush => flush())); }
  async save(id: string, writer: PdfFileWriter) {
    await this.flush(); const writerId = `writer-${++this.sequence}`; this.writers.set(writerId, writer);
    try { return await this.rpc<boolean>('save', { documentId: this.nativeId(id), args: [writerId] }); }
    finally { this.writers.delete(writerId); }
  }
  private async write(message: { id: string; writerId: string; plan: PdfWritePlan }) {
    try {
      const writer = this.writers.get(message.writerId); if (!writer) throw new Error('The save destination is no longer available.');
      const result = writer.writeShared ? await writer.writeShared(message.plan) : await writer.save(message.plan.data) ? { status: 'copy' } : { status: 'cancelled' };
      this.worker.postMessage({ type: 'writePdfResult', id: message.id, result });
    } catch (error) { this.worker.postMessage({ type: 'writePdfResult', id: message.id, error: error instanceof Error ? error.message : String(error) }); }
  }
}
export function createSharedPdfEngine(options?: LocalEngineRecipeOptions & { fontFallback?: PdfFontFallbackConfig | null }) {
  const client = new SharedDocumentClient(createPdfWorker(), options); return { engine: client.engine, client };
}
export function sharedHistoryPlugin() {
  const base = historyPlugin();
  return { ...base, create: ((ctx: Parameters<typeof base.create>[0]) => {
    const original = base.create(ctx); const client = getSharedDocumentClient(ctx.engine);
    if (!client) return original;
    const id = ctx.documentId!; const undone = createEventHook<any>(); const failed = createEventHook<any>();
    return { api: { ...original.api,
      undo: () => { void client.flush().then(() => client.request(id, 'undo')).catch(error => failed.emit({ error })); },
      redo: () => { void client.flush().then(() => client.request(id, 'redo')).catch(error => failed.emit({ error })); },
      canUndo: () => ctx.changes.hasPending() || client.getHistory(id).global.canUndo, canRedo: () => !ctx.changes.hasPending() && client.getHistory(id).global.canRedo,
      getUndoLabel: () => client.getHistory(id).global.canUndo ? { key: 'document.edit' } : null,
      getRedoLabel: () => client.getHistory(id).global.canRedo ? { key: 'document.edit' } : null,
      clear: () => { void client.request(id, 'clearHistory'); }, onUndone: undone.on, onUndoFailed: failed.on },
      connect: () => {
        const flush = async () => { ctx.changes.sendHolds(); await ctx.changes.whenSettled(); };
        client.flushers.add(flush); ctx.cleanup(() => { client.flushers.delete(flush); });
        ctx.listen(ctx.changes.onStaged, () => ctx.state.update(state => ({ ...state })));
        ctx.listen(client.changes.on, snapshot => { if (snapshot.documentId === id) ctx.state.update(state => ({ ...state })); });
      } };
  }) };
}
