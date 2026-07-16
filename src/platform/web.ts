import { get, update } from 'idb-keyval';
import type { ReadingProgress, ViewerPlatform } from './types';

export const documentEditingEnabled = true;
export const documentSelectionEnabled = true;

const READING_HISTORY_KEY = 'embedpdf-reading-history-v1';
type ReadingHistoryStore = Record<string, ReadingProgress>;

async function readHistoryStore() {
  const stored = await get<ReadingHistoryStore>(READING_HISTORY_KEY);
  return stored && typeof stored === 'object' ? stored : {};
}

export const platform: ViewerPlatform = {
  capabilities: {
    translation: true,
  },
  rendering: {
    maxDpr: 1.75,
  },
  getInitialDocumentUrl: () => undefined,
  getDocumentKey: () => undefined,
  getPdfiumWasmUrl: (bundledUrl) => bundledUrl,
  prepareResourceUrl: async (url) => url,
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
