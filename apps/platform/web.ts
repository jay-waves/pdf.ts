import { get, update } from 'idb-keyval';
import type { ManagedResource, ReadingProgress, ViewerPlatform } from './types';

export const documentEditingEnabled = true;

const READING_HISTORY_KEY = 'embedpdf-reading-history-v1';
type ReadingHistoryStore = Record<string, ReadingProgress>;

async function readHistoryStore() {
  const stored = await get<ReadingHistoryStore>(READING_HISTORY_KEY);
  return stored && typeof stored === 'object' ? stored : {};
}

function persistentResource(url: string): ManagedResource {
  return { url, release() {} };
}

function blobResource(blob: Blob): ManagedResource {
  const url = URL.createObjectURL(blob);
  let released = false;
  return {
    url,
    release() {
      if (released) return;
      released = true;
      URL.revokeObjectURL(url);
    },
  };
}

export const platform: ViewerPlatform = {
  rendering: {
    maxDpr: 1.75,
  },
  async loadViewerResources(bundledWasmUrl) {
    return { wasm: persistentResource(bundledWasmUrl) };
  },
  openLocalDocument(file) {
    return {
      resource: blobResource(file),
      key: `local:${file.name}:${file.size}:${file.lastModified}`,
      name: file.name,
    };
  },
  openExternal(url) {
    window.open(url, '_blank', 'noopener,noreferrer');
  },
  getPreference(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setPreference(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Preferences remain effective for the current React state.
    }
  },
  async preparePdfSave({ fileName }) {
    return {
      async save(data) {
        const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName ?? 'document.pdf';
        anchor.click();
        URL.revokeObjectURL(url);
        return true;
      },
    };
  },
  async readReadingProgress(documentKey) {
    return (await readHistoryStore())[documentKey];
  },
  async writeReadingProgress(documentKey, progress) {
    await update<ReadingHistoryStore>(READING_HISTORY_KEY, (store) => ({
      ...(store && typeof store === 'object' ? store : {}),
      [documentKey]: progress,
    }));
  },
};
