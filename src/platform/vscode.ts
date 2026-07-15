import type { ReadingProgress, ViewerPlatform } from './types';

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
  capabilities: {
    translation: false,
  },
  rendering: {
    maxDpr: 1.3,
  },
  getInitialDocumentUrl: () => readMeta('pdf-document-url'),
  getDocumentKey: () => readMeta('pdf-document-key'),
  getPdfiumWasmUrl: (bundledUrl) => readMeta('pdfium-wasm-url') ?? bundledUrl,
  async prepareResourceUrl(url, contentType) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Unable to load ${contentType}: HTTP ${response.status}`);
    }

    const bytes = await response.arrayBuffer();
    return URL.createObjectURL(new Blob([bytes], { type: contentType }));
  },
  getPreference: (key) => preferences.get(key) ?? null,
  setPreference(key, value) {
    preferences.set(key, value);
    if (key === THEME_STORAGE_KEY) {
      vscode.postMessage({ type: 'writeThemePreference', value });
    }
  },
  readReadingProgress(documentKey) {
    return request('readReadingProgress', documentKey);
  },
  async writeReadingProgress(documentKey, progress) {
    await request('writeReadingProgress', documentKey, progress);
  },
};
