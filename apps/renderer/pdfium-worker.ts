import type { PdfWritePlan, PdfWriteResult } from './document-save';
import { SharedDocumentHost, type SharedFileIdentity, type SharedAnnotationEdit } from './shared-document-host';
import { PdfWorkerDocuments } from './pdf-worker-session';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  PdfErrorCode,
  type PdfDocumentObject,
  type PdfErrorReason,
  type Task,
} from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import {
  getThemeRenderGeometry,
  toReverseByteOrderBitmapColor,
  type PdfRenderTheme,
} from './pdf-render-theme';
import {
  PdfiumFontFallbackManager,
  type PdfFontFallbackConfig,
} from '../fonts';

type WorkerRequest =
  | { type: 'disconnect' }
  | { type: 'writePdfResult'; id: string; result?: PdfWriteResult; error?: string }
  | {
      id: string;
      type: 'execute';
      method: string;
      args: unknown[];
    }
  | {
      id: string;
      type: 'wasmInit';
      wasmUrl: string;
      fontFallback: PdfFontFallbackConfig | null;
      lease?: string;
    };
type ExecuteRequest = Extract<WorkerRequest, { type: 'execute' }>;
type WorkerTask = Task<unknown, PdfErrorReason, unknown>;


const COLOR_SCHEME_BYTES = 4 * Uint32Array.BYTES_PER_ELEMENT;
const PAUSE_STRUCT_BYTES = 2 * Uint32Array.BYTES_PER_ELEMENT;
const FPDF_RENDER_TOBECONTINUED = 1;
const FPDF_RENDER_DONE = 2;
const FPDF_CONVERT_FILL_TO_STROKE = 0x20;

type ThemeRenderResources = {
  pauseCallback: number;
  pausePtr: number;
  schemePtr: number;
};

function createThemeRenderResources(module: WrappedPdfiumModule): ThemeRenderResources {
  const schemePtr = module.pdfium.wasmExports.malloc(COLOR_SCHEME_BYTES);
  if (!schemePtr) throw new Error('PDFium could not allocate the render color scheme.');
  const pausePtr = module.pdfium.wasmExports.malloc(PAUSE_STRUCT_BYTES);
  if (!pausePtr) {
    module.pdfium.wasmExports.free(schemePtr);
    throw new Error('PDFium could not allocate the render pause handler.');
  }
  const pauseCallback = module.pdfium.addFunction(() => 0, 'ii');
  // IFSDK_PAUSE is { version, NeedToPauseNow }. PDFium rejects the
  // progressive color-scheme API when this pointer is null.
  module.pdfium.setValue(pausePtr, 1, 'i32');
  module.pdfium.setValue(pausePtr + Uint32Array.BYTES_PER_ELEMENT, pauseCallback, 'i32');
  return { pauseCallback, pausePtr, schemePtr };
}

function installThemeRenderer(
  module: WrappedPdfiumModule,
  getTheme: () => PdfRenderTheme | null,
) {
  const original = module.FPDF_RenderPageBitmapWithMatrix.bind(module);
  const resources = createThemeRenderResources(module);
  const mutableModule = module as unknown as {
    FPDF_RenderPageBitmapWithMatrix: typeof module.FPDF_RenderPageBitmapWithMatrix;
  };
  const heap = module.pdfium as typeof module.pdfium & {
    HEAPF32: Float32Array;
    HEAPU8: Uint8Array;
  };
  mutableModule.FPDF_RenderPageBitmapWithMatrix = ((
    bitmapPtr: number,
    pagePtr: number,
    matrixPtr: number,
    _clipPtr: number,
    flags: number,
  ) => {
    const theme = getTheme();
    if (!theme) {
      original(bitmapPtr, pagePtr, matrixPtr, _clipPtr, flags);
      return;
    }

    const matrix = new Float32Array(heap.HEAPF32.buffer, matrixPtr, 6);
    const { fullHeight, fullWidth, rotation, startX, startY } = getThemeRenderGeometry(
      module.FPDF_GetPageWidthF(pagePtr),
      module.FPDF_GetPageHeightF(pagePtr),
      matrix,
    );

    module.FPDFBitmap_FillRect(
      bitmapPtr,
      0,
      0,
      module.FPDFBitmap_GetWidth(bitmapPtr),
      module.FPDFBitmap_GetHeight(bitmapPtr),
      toReverseByteOrderBitmapColor(theme.background),
    );

    if (theme.mode === 'background') {
      original(bitmapPtr, pagePtr, matrixPtr, _clipPtr, flags);
      return;
    }

    try {
      new Uint32Array(heap.HEAPU8.buffer, resources.schemePtr, 4).set([
        theme.pathFill,
        theme.pathStroke,
        theme.textFill,
        theme.textStroke,
      ]);
      let status = module.FPDF_RenderPageBitmapWithColorScheme_Start(
        bitmapPtr,
        pagePtr,
        startX,
        startY,
        fullWidth,
        fullHeight,
        rotation,
        flags | FPDF_CONVERT_FILL_TO_STROKE,
        resources.schemePtr,
        resources.pausePtr,
      );
      while (status === FPDF_RENDER_TOBECONTINUED) {
        status = module.FPDF_RenderPage_Continue(pagePtr, resources.pausePtr);
      }
      if (status !== FPDF_RENDER_DONE) {
        throw new Error(`PDFium themed render failed with status ${status}.`);
      }
    } finally {
      module.FPDF_RenderPage_Close(pagePtr);
    }
  }) as typeof module.FPDF_RenderPageBitmapWithMatrix;
}

type Endpoint = {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  start?(): void;
  close?(): void;
};
type Session = {
  id: string;
  port: Endpoint;
  documents: PdfWorkerDocuments;
  theme: PdfRenderTheme | null;
  closed: boolean;
  initialized: boolean;
  lease: AbortController;
  writes: Map<string, { resolve(result: PdfWriteResult): void; reject(error: Error): void }>;
};
const shared = 'onconnect' in self;
const sessions = new Set<Session>();
let native: PdfiumNative | null = null;
let documentHost: SharedDocumentHost | null = null;
let activeSession: Session | null = null;
let fontFallbackManager: PdfiumFontFallbackManager | null = null;
let initialization: Promise<void> | null = null;
let configuration = '';
let queue = Promise.resolve();
let nextSessionId = 0;
let nextWriteId = 0;

function enqueue(operation: () => Promise<void>) {
  queue = queue.then(operation).catch((error) => {
    console.error('[pdf-ts] PDF worker operation failed', error);
  });
}

function postStartupLog(
  message: string,
  detail?: string,
  level: 'info' | 'warn' | 'error' = 'info',
) {
  const recipients = activeSession ? [activeSession] : sessions;
  for (const session of recipients) {
    if (!session.closed) session.port.postMessage({ type: 'startupLog', level, message, detail });
  }
}

function taskError(message: string, code = PdfErrorCode.Unknown) {
  return { type: 'reject' as const, reason: { code, message } };
}

function respond(session: Session, id: string, message: Record<string, unknown>, transfer: Transferable[] = []) {
  if (!session.closed) session.port.postMessage({ id, ...message }, transfer);
}

function getResultTransfer(value: unknown): Transferable[] {
  if (value instanceof ArrayBuffer) return [value];
  if (!value || typeof value !== 'object') return [];

  const { data, delta } = value as { data?: unknown; delta?: unknown };
  if (delta instanceof ArrayBuffer) return [delta];
  if (ArrayBuffer.isView(data)
    && data.buffer instanceof ArrayBuffer
    && data.byteOffset === 0
    && data.byteLength === data.buffer.byteLength) {
    return [data.buffer];
  }
  return [];
}

function isTask(value: unknown): value is WorkerTask {
  return Boolean(value && typeof value === 'object' && 'wait' in value);
}


async function releaseDocument(document: PdfDocumentObject) {
  if (documentHost?.isSaving(document.id)) return;
  if ([...sessions].some((other) => other.documents.all().some((doc) => doc.id === document.id))) return;
  if (documentHost?.has(document.id)) await documentHost.close(document.id);
  else await native?.closeDocument(document).toPromise();
}

async function closeDocuments(session: Session) {
  const documents = session.documents.all();
  session.documents.clear();
  for (const document of documents) await releaseDocument(document);
}

async function publishDocument(id: string, confirmIds: string[] = []) {
  if (!documentHost?.has(id)) return;
  const snapshot = documentHost.update(id, confirmIds);
  for (const session of sessions) {
    if (session.closed) continue;
    for (const alias of session.documents.aliases(id)) {
      session.port.postMessage({ type: 'sharedDocument', snapshot: { ...snapshot, documentId: alias } });
    }
  }
  return snapshot;
}

function publishSaveState(id: string) {
  const state = documentHost!.saveState(id);
  for (const session of sessions) {
    if (session.closed) continue;
    for (const documentId of session.documents.aliases(id)) {
      session.port.postMessage({ type: 'sharedSaveState', state: { ...state, documentId } });
    }
  }
}

function disconnect(session: Session) {
  if (session.closed) return;
  session.closed = true;
  session.lease.abort();
  for (const write of session.writes.values()) write.reject(new Error('The writing tab disconnected before confirming the save.'));
  session.writes.clear();
  enqueue(async () => {
    await closeDocuments(session);
    fontFallbackManager?.releaseDiagnosticContext(session.id);
    sessions.delete(session);
    session.port.onmessage = null;
    session.port.close?.();
  });
}

function runNative<T>(session: Session, operation: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => enqueue(async () => {
    activeSession = session;
    fontFallbackManager?.setDiagnosticContext(session.id);
    try { resolve(await operation()); } catch (error) { reject(error); }
    finally { activeSession = null; }
  }));
}

function writeInPage(session: Session, writerId: string, plan: PdfWritePlan): Promise<PdfWriteResult> {
  if (session.closed) return Promise.reject(new Error('The writing tab disconnected.'));
  const id = `write-${++nextWriteId}`;
  return new Promise((resolve, reject) => {
    session.writes.set(id, { resolve, reject });
    try { session.port.postMessage({ type: 'writePdf', id, writerId, plan }, [plan.data]); }
    catch (error) { session.writes.delete(id); reject(error); }
  });
}

/** Save workflows wait outside the PDFium queue. Only serialization and
 * snapshots enter it; IO acknowledgements can arrive while other tabs edit. */
async function saveDocument(session: Session, request: ExecuteRequest) {
  let document: PdfDocumentObject | undefined;
  try {
    const args = await runNative(session, async () => session.documents.args('sharedSave', request.args));
    document = args[0] as PdfDocumentObject;
    if (!documentHost?.has(document.id)) throw new Error('Shared document is not open.');
    const id = document.id;
    const options = args[1] as { writerId: string };
    const result = await documentHost.save(id,
      (plan) => writeInPage(session, options.writerId, plan),
      (operation) => runNative(session, operation),
      () => runNative(session, async () => { publishSaveState(id); }),
      () => { if (session.closed) throw new Error('The requesting tab disconnected.'); });
    respond(session, request.id, { type: 'result', data: result });
  } catch (error) {
    respond(session, request.id, { type: 'error', error: taskError(error instanceof Error ? error.message : String(error)) });
  } finally {
    if (document) await runNative(session, () => releaseDocument(document!));
  }
}

async function execute(session: Session, request: ExecuteRequest) {
  if (session.closed) return;
  activeSession = session;
  fontFallbackManager?.setDiagnosticContext(session.id);
  try {
    const engine = native;
    if (!engine || !session.initialized) throw new Error('PDFium is not initialized.');
    let result: unknown;
    if (request.method === 'setRenderTheme') {
      session.theme = (request.args[0] ?? null) as PdfRenderTheme | null;
      result = true;
    } else if (request.method === 'getFontDiagnostics') {
      result = fontFallbackManager?.getDiagnostics() ?? [];
    } else if (request.method === 'closeAllDocuments' || request.method === 'destroy') {
      // A caller owns only its documents, never the shared PDFium library.
      await closeDocuments(session);
      result = true;
    } else if (request.method === 'openDocumentBuffer' && (request.args[0] as { sharedIdentity?: unknown }).sharedIdentity) {
      const file = request.args[0] as { id: string; content: ArrayBuffer; sharedIdentity: SharedFileIdentity; draftLocation?: import('./draft-storage').DraftLocation };
      session.documents.args(request.method, request.args); // validate public ID
      const opened = await documentHost!.open(file.sharedIdentity, file, request.args[1] as never, file.draftLocation);
      session.documents.bind(file.id, opened.document);
      result = { ...opened.document, id: file.id };
    } else {
      const args = session.documents.args(request.method, request.args);
      if (request.method === 'openDocumentBuffer') fontFallbackManager?.resetDiagnostics();
      const document = args[0] as PdfDocumentObject;
      if (request.method === 'closeDocument') {
        session.documents.remove((request.args[0] as PdfDocumentObject).id);
        await releaseDocument(document);
        result = true;
      } else if (request.method.startsWith('shared')) {
        if (!documentHost?.has(document.id)) throw new Error('This document has no shared editing session.');
        if (request.method === 'sharedEdit') await documentHost.edit(document.id, args[1] as SharedAnnotationEdit[]);
        else if (request.method === 'sharedUndo') await documentHost.travel(document.id, 'undo');
        else if (request.method === 'sharedRedo') await documentHost.travel(document.id, 'redo');
        else if (request.method === 'sharedForm') result = await documentHost.form(document.id, args[1] as never, args[2] as unknown[]);
        else if (request.method === 'sharedDiscardDraft') await documentHost.discardDraft(document.id);
        else if (request.method === 'sharedDownloadDraft') result = await documentHost.downloadDraft(document.id);
        else if (request.method !== 'sharedSnapshot') throw new Error('Unknown shared operation.');
        // Full joins go only to the requester. Mutations broadcast one delta;
        // the RPC response is an acknowledgement, not another annotation copy.
        const snapshot = request.method === 'sharedSnapshot' ? documentHost.snapshot(document.id) : documentHost.state(document.id);
        if (request.method !== 'sharedSnapshot') await publishDocument(document.id,
          request.method === 'sharedEdit' ? (args[1] as SharedAnnotationEdit[]).map((edit) => edit.type === 'create' ? edit.annotation.id : edit.id) : []);
        result = { result, snapshot: { ...snapshot, documentId: (request.args[0] as PdfDocumentObject).id } };
      } else {
        const method = (engine as unknown as Record<string, unknown>)[request.method];
        if (typeof method !== 'function') throw new Error(`PDFium method ${request.method} is unavailable.`);
        result = method.apply(engine, args) as unknown;
        if (isTask(result)) {
          result.onProgress((progress) => respond(session, request.id, { type: 'progress', progress }));
          const task = result;
          result = await new Promise((resolve, reject) => task.wait(resolve, reject));
        }
      }
      if (documentHost?.has(document.id) && request.method === 'unlockOwnerPermissions' && result) {
        documentHost.unlocked(document.id);
        await publishDocument(document.id);
      }
      if (documentHost?.has(document.id) && ['setDocumentEncryption', 'removeEncryption', 'setMetadata'].includes(request.method)) {
        documentHost.changed(document.id, request.method === 'setDocumentEncryption' ? true : request.method === 'removeEncryption' ? false : undefined);
        await publishDocument(document.id);
      }
      result = session.documents.result(request.method, request.args, result);
    }
    respond(session, request.id, { type: 'result', data: result }, getResultTransfer(result));
  } catch (error) {
    // Preserve structured PDFium errors (password required, permissions, etc.).
    const failure = error && typeof error === 'object' && 'type' in error
      ? error : taskError(error instanceof Error ? error.message : String(error));
    respond(session, request.id, { type: 'error', error: failure });
  } finally {
    activeSession = null;
  }
}

type InitRequest = Extract<WorkerRequest, { type: 'wasmInit' }>;
async function initialize(request: InitRequest) {
  const startedAt = performance.now();
  const url = new URL(request.wasmUrl, self.location.href);
  const wasmUrl = `${url.origin}${url.pathname}`;
  const slowDownloadWarning = self.setTimeout(() => {
    postStartupLog('PDFium WASM download is taking longer than expected', wasmUrl, 'warn');
  }, 5000);
  try {
    postStartupLog('Loading PDFium WASM', wasmUrl);
    const response = await fetch(request.wasmUrl);
    if (!response.ok) throw new Error(`Could not load PDFium (${response.status}).`);
    const wasmBinary = await response.arrayBuffer();
    self.clearTimeout(slowDownloadWarning);
    postStartupLog('PDFium WASM ready',
      `${(wasmBinary.byteLength / 1024 / 1024).toFixed(1)} MB in ${((performance.now() - startedAt) / 1000).toFixed(2)} s`);
    const module = await init({ wasmBinary });
    native = new PdfiumNative(module);
    documentHost = new SharedDocumentHost(native, {
      run: operation => new Promise((resolve, reject) => enqueue(async () => {
        try { resolve(await operation()); } catch (error) { reject(error); }
      })),
      notify: id => { if (documentHost?.has(id)) publishSaveState(id); },
      settled: id => enqueue(async () => { const document = documentHost?.document(id); if (document) await releaseDocument(document); }),
    });
    if (request.fontFallback) {
      fontFallbackManager = new PdfiumFontFallbackManager(request.fontFallback, postStartupLog);
      fontFallbackManager.initialize(module);
    }
    installThemeRenderer(module, () => activeSession?.theme ?? null);
  } finally {
    self.clearTimeout(slowDownloadWarning);
  }
}

function attach(port: Endpoint) {
  const id = String(++nextSessionId);
  const session: Session = {
    id, port, documents: new PdfWorkerDocuments(id), theme: null,
    closed: false, initialized: false, lease: new AbortController(), writes: new Map(),
  };
  sessions.add(session);
  port.onmessage = ({ data: request }) => {
    if (request.type === 'disconnect') { disconnect(session); return; }
    if (request.type === 'writePdfResult') {
      const write = session.writes.get(request.id);
      if (write) {
        session.writes.delete(request.id);
        if (request.error || !request.result) write.reject(new Error(request.error ?? 'Missing write confirmation.'));
        else write.resolve(request.result);
      }
      return;
    }
    if (request.type === 'execute') {
      if (request.method === 'sharedSave') { void saveDocument(session, request); return; }
      enqueue(() => execute(session, request));
      return;
    }
    // Register before initialization: closing a tab during WASM loading must
    // release it too. Lock ownership belongs to the page, not its worker port.
    if (shared && !session.initialized) {
      if (!request.lease?.startsWith('pdf-ts-session:') || !navigator.locks) {
        respond(session, request.id, { type: 'error', error: taskError('Shared PDF session requires a page lease.') });
        return;
      }
      void navigator.locks.request(request.lease, { signal: session.lease.signal }, () => {
        disconnect(session);
      }).catch(() => { /* Normal disconnect aborts the pending lease observer. */ });
    }
    enqueue(async () => {
      if (session.closed) return;
      try {
        const key = JSON.stringify([request.wasmUrl, request.fontFallback]);
        if (initialization && key !== configuration) throw new Error('Shared PDFium configuration differs; use a dedicated worker.');
        if (!initialization) {
          configuration = key;
          initialization = initialize(request);
        }
        await initialization;
        if (session.closed) return;
        session.initialized = true;
        respond(session, request.id, { type: 'ready' });
      } catch (error) {
        respond(session, request.id, { type: 'error', error: taskError(
          error instanceof Error ? error.message : String(error), PdfErrorCode.Initialization,
        ) });
      }
    });
  };
  port.start?.();
}

if (shared) {
  (self as unknown as { onconnect: (event: MessageEvent) => void }).onconnect = (event) => attach(event.ports[0]);
} else {
  attach(self as unknown as Endpoint);
}
