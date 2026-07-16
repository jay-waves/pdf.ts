import type { ManagedResource, ReadingProgress, ViewerPlatform } from './types';

export const documentEditingEnabled = false;

interface VsCodeApi {
  postMessage(message: unknown): void;
}

interface HostResponse {
  type: 'response';
  requestId: number;
  value?: ReadingProgress;
  error?: string;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const preferences = new Map<string, string>();
const THEME_STORAGE_KEY = 'shnctl-viewer-theme-v1';
const pending = new Map<number, {
  resolve(value: ReadingProgress | undefined): void;
  reject(error: Error): void;
}>();
let nextRequestId = 1;

window.addEventListener('message', (event: MessageEvent<HostResponse>) => {
  const message = event.data;
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

async function fetchResource(url: string, contentType: string): Promise<ManagedResource> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to load ${contentType}: HTTP ${response.status}`);
  }

  const objectUrl = URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: contentType }));
  let released = false;
  return {
    url: objectUrl,
    release() {
      if (released) return;
      released = true;
      URL.revokeObjectURL(objectUrl);
    },
  };
}

const configuredTheme = readMeta('pdf-ts-theme');
if (configuredTheme) preferences.set(THEME_STORAGE_KEY, configuredTheme);

function request(type: 'readReadingProgress' | 'writeReadingProgress', documentKey: string, progress?: ReadingProgress) {
  const requestId = nextRequestId++;
  const result = new Promise<ReadingProgress | undefined>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
  });
  vscode.postMessage({ type, requestId, documentKey, progress });
  return result;
}

export const platform: ViewerPlatform = {
  rendering: {
    maxDpr: 1.3,
  },
  async loadViewerResources(bundledWasmUrl) {
    const documentUrl = readMeta('pdf-document-url');
    const documentKey = readMeta('pdf-document-key');
    const wasmUrl = readMeta('pdfium-wasm-url') ?? bundledWasmUrl;
    const [wasm, documentResource] = await Promise.all([
      fetchResource(wasmUrl, 'application/wasm'),
      documentUrl ? fetchResource(documentUrl, 'application/pdf') : Promise.resolve(undefined),
    ]);
    return {
      wasm,
      document: documentResource ? { resource: documentResource, key: documentKey } : undefined,
    };
  },
  openExternal(url) {
    vscode.postMessage({ type: 'openExternal', url });
  },
  getPreference: (key) => preferences.get(key) ?? null,
  setPreference(key, value) {
    preferences.set(key, value);
    if (key === THEME_STORAGE_KEY) {
      vscode.postMessage({ type: 'writeThemePreference', value });
    }
  },
  async preparePdfSave() {
    return null;
  },
  readReadingProgress(documentKey) {
    return request('readReadingProgress', documentKey);
  },
  async writeReadingProgress(documentKey, progress) {
    await request('writeReadingProgress', documentKey, progress);
  },
};
