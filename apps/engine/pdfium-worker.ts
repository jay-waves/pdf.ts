import type { DraftLocation, PdfWriteResult } from '../shared/pdf-file';
import { encodeEngineResult } from './engine-wire';
import type { LocalEngineRecipeOptions } from '@embedpdf/engine';
import { createNativeRuntime } from './native-runtime';
import type { PdfFontFallbackConfig } from '../fonts/types';
import type { PdfRenderTheme } from './pdf-render-theme';
import type { LocalDocumentHandle, OpenInput, OpenOptions, DocumentEvent, AbortablePromise } from '@embedpdf/engine-core/runtime';
import { SharedDocumentHost, type SharedFileIdentity } from './shared-document-host';

type Endpoint = Pick<MessagePort, 'postMessage' | 'onmessage'> & { start?(): void; close?(): void };
type Request = { type: string; id: string; documentId?: string; method?: string; args?: unknown[]; path?: Array<string | { page: unknown } | { with: unknown }>; lease?: string; options?: LocalEngineRecipeOptions & { fontFallback?: PdfFontFallbackConfig | null }; result?: PdfWriteResult; error?: string };
type Session = { key: string; port: Endpoint; documents: Set<string>; closed: boolean; lease: AbortController; theme: PdfRenderTheme | null };
const sessions = new Set<Session>();
let host: SharedDocumentHost | undefined;
let native: Awaited<ReturnType<typeof createNativeRuntime>>;
let initializing: Promise<void> | undefined;
let currentTheme: PdfRenderTheme | null = null;
let serial = Promise.resolve();
let sequence = 0;
const closing = new Map<string, Promise<void>>();
const writes = new Map<string, { session: Session; resolve(value: PdfWriteResult): void; reject(error: Error): void }>();
const cancelled = new Set<string>();
const pendingKeys = new Set<string>();
const active = new Map<string, AbortablePromise<unknown>>();
function run<T>(operation: () => Promise<T>): Promise<T> {
  const result = serial.then(operation); serial = result.then(() => {}, () => {}); return result;
}
function broadcast(id: string, message: object) {
  for (const s of sessions) if (!s.closed && s.documents.has(id)) s.port.postMessage(message);
}
function notify(id: string) { if (host?.document(id)) broadcast(id, { type: 'sharedDocument', snapshot: host.state(id) }); }
function security(doc: LocalDocumentHandle) {
  const protection = host?.protection(doc.id);
  const state = protection === undefined ? doc.security.state : { ...doc.security.state, encryption: { state: protection === null ? 'none' : 'encrypted', requiresPassword: false }, permissions: { ...doc.security.state.permissions, openedAs: 'owner' } };
  return { state, scope: doc.security.scope, identity: doc.security.identity, passwordPrompt: doc.security.passwordPrompt };
}
function initialize(options?: LocalEngineRecipeOptions & { fontFallback?: PdfFontFallbackConfig | null }) {
  return initializing ??= (async () => {
    native = await createNativeRuntime(options ?? {}, () => currentTheme);
    host = new SharedDocumentHost(native.engine, { run, notify,
      protect: (bytes, sourcePassword, password) => native.protect(bytes, sourcePassword, password),
      event: (id: string, event: DocumentEvent) => broadcast(id, { type: 'documentEvent', documentId: id, event, security: security(host!.document(id)!) }) });
  })();
}
function releaseDocument(id: string) {
  if ([...sessions].some(s => !s.closed && s.documents.has(id))) return Promise.resolve();
  const existing = closing.get(id); if (existing) return existing;
  const task = serial.then(() => host!.close(id)).finally(() => { closing.delete(id); });
  closing.set(id, task); return task;
}
async function closeSession(s: Session) {
  if (s.closed) return; s.closed = true; sessions.delete(s); s.lease.abort(); native?.fonts?.releaseDiagnosticContext(s.key);
  for (const [id, w] of writes) if (w.session === s) { w.reject(new Error('The saving tab closed.')); writes.delete(id); }
  for (const id of s.documents) await releaseDocument(id);
}
async function dispatch(s: Session, req: Request) {
  if (cancelled.delete(`${s.key}:${req.id}`)) throw Object.assign(new Error('PDF operation cancelled.'), { code: 'Aborted' });
  const args = req.args ?? [];
  currentTheme = s.theme; native.fonts?.setDiagnosticContext(s.key);
  if (req.type === 'theme') { s.theme = args[0] as PdfRenderTheme | null; return true; }
  if (req.type === 'fontDiagnostics') return native.fonts?.getDiagnostics() ?? [];
  if (req.type === 'open') {
    native.fonts?.resetDiagnostics();
    const [input, options, identity, location] = args as [OpenInput, OpenOptions | undefined, SharedFileIdentity, DraftLocation | undefined];
    const doc = await host!.open(identity, input, options, location);
    s.documents.add(doc.id);
    return { id: doc.id, security: security(doc), snapshot: host!.state(doc.id) };
  }
  const id = req.documentId!;
  if (!s.documents.has(id)) throw new Error('PDF document is not open in this session.');
  const doc = host!.document(id)!;
  if (req.type === 'close') {
    s.documents.delete(id);
    await releaseDocument(id);
    return;
  }
  if (req.type === 'reserve') {
    await doc.objectNumbers.reserve(args[0] as number);
    return Array.from({ length: args[0] as number }, () => doc.objectNumbers.take());
  }
  if (req.type === 'save') return host!.save(id, plan => new Promise((resolve, reject) => {
    const writeId = `write-${++sequence}`; writes.set(writeId, { session: s, resolve, reject });
    s.port.postMessage({ type: 'writePdf', id: writeId, writerId: args[0], plan }, [plan.data]);
  }), () => { if (s.closed) throw new Error('The saving tab closed.'); });
  if (req.type === 'command') {
    if (req.method === 'undo' || req.method === 'redo') return host!.travel(id, req.method);
    if (req.method === 'setProtection') { const result = host!.setProtection(id, args[0] as string | null); broadcast(id, { type: 'securityState', documentId: id, security: security(doc) }); return result; }
    if (req.method === 'clearHistory') return host!.clearHistory(id);
    if (req.method === 'sharedDiscardDraft') return host!.discardDraft(id);
    if (req.method === 'sharedDownloadDraft') return { result: await host!.downloadDraft(id) };
    return host!.state(id);
  }
  // Only document-owned public service paths cross this boundary. No SDK internals.
  let target: any = doc;
  for (const segment of req.path ?? []) {
    if (typeof segment === 'string') {
      if (['__proto__', 'constructor', 'prototype'].includes(segment)) throw new Error('Invalid document method.');
      target = target[segment];
    } else if ('page' in segment) target = target.page(segment.page);
    else target = target.with(segment.with);
  }
  if (['__proto__', 'constructor', 'prototype'].includes(req.method!) || typeof target?.[req.method!] !== 'function') throw new Error('Unknown document operation.');
  const pending = target[req.method!](...args);
  if (pending?.abort) active.set(`${s.key}:${req.id}`, pending);
  try {
    const result = await pending;
    if (req.method === 'unlock' && req.path?.[0] === 'security') {
      host!.unlocked(id, (args[0] as { password: string }).password);
      broadcast(id, { type: 'securityState', documentId: id, security: security(doc) });
    }
    return encodeEngineResult(result);
  } finally { active.delete(`${s.key}:${req.id}`); }
}
function connect(port: Endpoint) {
  const s: Session = { key: crypto.randomUUID(), port, documents: new Set(), closed: false, lease: new AbortController(), theme: null }; sessions.add(s);
  port.onmessage = (event: MessageEvent<Request>) => {
    const req = event.data;
    if (req.type === 'init') {
      void initialize(req.options).then(() => port.postMessage({ type: 'ready' }), error => port.postMessage({ type: 'error', error: String(error) }));
      if (req.lease) void navigator.locks.request(req.lease, { signal: s.lease.signal }, () => closeSession(s)).catch(() => {});
      return;
    }
    if (req.type === 'disconnect') { void closeSession(s); return; }
    if (req.type === 'abort') {
      const key = `${s.key}:${req.id}`; const task = active.get(key);
      if (task) task.abort(); else if (pendingKeys.has(key)) cancelled.add(key); return;
    }
    if (req.type === 'writePdfResult') {
      const w = writes.get(req.id); if (!w || w.session !== s) return; writes.delete(req.id);
      if (req.error) w.reject(new Error(req.error)); else w.resolve(req.result!); return;
    }
    pendingKeys.add(`${s.key}:${req.id}`);
    // Saves wait on the disk lane outside the native operation lane, so other tabs can edit.
    const task = req.type === 'save' || req.type === 'close' ? dispatch(s, req)
      : req.type === 'open' ? Promise.all([...closing.values()]).then(() => run(() => dispatch(s, req)))
      : run(() => dispatch(s, req));
    void task.then(result => { if (!s.closed) port.postMessage({ type: 'result', id: req.id, result }); }).catch(error => {
      if (!s.closed) port.postMessage({ type: 'result', id: req.id, error: { message: error?.message ?? String(error), code: error?.code, details: error?.details } });
    }).finally(() => { const key = `${s.key}:${req.id}`; pendingKeys.delete(key); cancelled.delete(key); });
  };
  port.start?.();
}
if ('onconnect' in self) (self as unknown as SharedWorkerGlobalScope).onconnect = event => connect(event.ports[0]);
else connect(self as unknown as Endpoint);
interface SharedWorkerGlobalScope { onconnect: (event: MessageEvent) => void }
