import { blobResource } from './resources';
import { translateWithInstalledModel } from './browser-translation';
import type { PdfFileHandle, ReadingProgress, ViewerPlatform } from './types';

interface VsCodeApi {
  postMessage(message: unknown): void;
}

interface HostResponse {
  type: 'response';
  requestId: number;
  value?: unknown;
  error?: string;
}

interface HostSaveRequest {
  type: 'performSave';
  requestId: number;
  preserveDirty?: boolean;
}

interface HostReloadRequest {
  type: 'reloadDocument';
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const preferences = new Map<string, string>();
const pending = new Map<number, {
  resolve(value: unknown): void;
  reject(error: Error): void;
}>();
let nextRequestId = 1;
let saveHandler: ((preserveDirty: boolean) => Promise<boolean>) | undefined;

window.addEventListener('message', (event: MessageEvent<HostResponse | HostSaveRequest | HostReloadRequest>) => {
  const message = event.data;
  if (message?.type === 'performSave') {
    void (saveHandler?.(Boolean(message.preserveDirty)) ?? Promise.resolve(false))
      .then((saved) => {
        vscode.postMessage({
          type: 'saveResponse',
          requestId: message.requestId,
          saved,
        });
      });
    return;
  }
  if (message?.type === 'reloadDocument') {
    window.location.reload();
    return;
  }
  if (message?.type !== 'response') return;
  const request = pending.get(message.requestId);
  if (!request) return;

  pending.delete(message.requestId);
  if (message.error) request.reject(new Error(message.error));
  else request.resolve(message.value);
});

function readMeta(name: string) {
  return document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content || undefined;
}

async function fetchResource(url: string, contentType: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to load ${contentType}: HTTP ${response.status}`);
  }

  return blobResource(new Blob([await response.arrayBuffer()], { type: contentType }));
}

function request<T>(
  type: 'readReadingProgress' | 'writeReadingProgress' | 'writeDocument',
  documentKey: string,
  payload: { progress?: ReadingProgress; data?: Uint8Array } = {},
) {
  const requestId = nextRequestId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(requestId, {
      resolve: (value) => resolve(value as T),
      reject,
    });
    vscode.postMessage({ type, requestId, documentKey, ...payload });
  });
}

class VsCodePdfFileHandle implements PdfFileHandle {
  constructor(
    private readonly documentKey: string,
    readonly name?: string,
  ) {}

  async prepareWrite() {
    const { documentKey } = this;
    return {
      async save(data: ArrayBuffer) {
        await request<void>('writeDocument', documentKey, {
          data: new Uint8Array(data),
        });
        return true;
      },
    };
  }
}

export const platform: ViewerPlatform = {
  viewerThemePolicy: 'host',
  async loadViewerResources(bundledWasmUrl) {
    const documentUrl = readMeta('pdf-document-url');
    const documentKey = readMeta('pdf-document-key');
    const documentName = readMeta('pdf-document-name');
    const wasmUrl = readMeta('pdfium-wasm-url') ?? bundledWasmUrl;
    const [wasmResult, documentResult] = await Promise.allSettled([
      fetchResource(wasmUrl, 'application/wasm'),
      documentUrl ? fetchResource(documentUrl, 'application/pdf') : Promise.resolve(undefined),
    ]);

    if (wasmResult.status === 'rejected' || documentResult.status === 'rejected') {
      if (wasmResult.status === 'fulfilled') wasmResult.value.release?.();
      if (documentResult.status === 'fulfilled') documentResult.value?.release?.();
      if (wasmResult.status === 'rejected') throw wasmResult.reason;
      if (documentResult.status === 'rejected') throw documentResult.reason;
    }

    return {
      wasm: wasmResult.value,
      document: documentResult.value && documentKey ? {
        resource: documentResult.value,
        key: documentKey,
        name: documentName,
        fileHandle: new VsCodePdfFileHandle(documentKey, documentName),
      } : undefined,
    };
  },
  openExternal(url) {
    vscode.postMessage({ type: 'openExternal', url });
  },
  requestDocumentSave() {
    vscode.postMessage({ type: 'requestDocumentSave' });
  },
  onDocumentSaveRequested(handler) {
    saveHandler = handler;
    return () => {
      if (saveHandler === handler) saveHandler = undefined;
    };
  },
  setDocumentDirty(dirty) {
    vscode.postMessage({ type: 'documentDirty', dirty });
  },
  translate: translateWithInstalledModel,
  getPreference: (key) => preferences.get(key) ?? null,
  setPreference(key, value) {
    preferences.set(key, value);
  },
  readReadingProgress(documentKey) {
    return request<ReadingProgress | undefined>('readReadingProgress', documentKey);
  },
  async writeReadingProgress(documentKey, progress) {
    await request<void>('writeReadingProgress', documentKey, { progress });
  },
};
