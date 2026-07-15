import { get, set, update } from 'idb-keyval';
import type { ReadingProgress, ViewerPlatform } from './types';

export const documentEditingEnabled = true;

const READING_HISTORY_KEY = 'embedpdf-reading-history-v1';
type ReadingHistoryStore = Record<string, ReadingProgress>;

function getDocumentUrl() {
  const params = new URLSearchParams(window.location.search);
  const file = params.get('file') ?? params.get('src');
  if (!file) return undefined;

  try {
    const url = new URL(file);
    return url.protocol === 'file:' && url.pathname.toLowerCase().endsWith('.pdf') ? file : undefined;
  } catch {
    return undefined;
  }
}

function readLegacyHistoryStore() {
  try {
    const raw = window.localStorage.getItem(READING_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : undefined;
    return parsed !== null && typeof parsed === 'object' ? parsed as ReadingHistoryStore : {};
  } catch {
    return {};
  }
}

async function readHistoryStore() {
  const stored = await get<ReadingHistoryStore>(READING_HISTORY_KEY);
  if (stored && typeof stored === 'object') return stored;

  const legacyStore = readLegacyHistoryStore();
  if (Object.keys(legacyStore).length) {
    await set(READING_HISTORY_KEY, legacyStore);
    window.localStorage.removeItem(READING_HISTORY_KEY);
  }
  return legacyStore;
}

export const platform: ViewerPlatform = {
  capabilities: {
    translation: true,
  },
  rendering: {
    maxDpr: 1.75,
  },
  getInitialDocumentUrl: getDocumentUrl,
  getDocumentKey: getDocumentUrl,
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
      ...store,
      [documentKey]: progress,
    }));
  },
};
