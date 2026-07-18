import { get, update } from 'idb-keyval';
import type { ReadingProgress } from './types';

const READING_HISTORY_KEY = 'embedpdf-reading-history-v1';
type ReadingHistoryStore = Record<string, ReadingProgress>;

export async function readReadingHistoryStore() {
  return get<ReadingHistoryStore>(READING_HISTORY_KEY);
}

export async function writeReadingProgress(documentKey: string, progress: ReadingProgress) {
  await update<ReadingHistoryStore>(READING_HISTORY_KEY, (store) => ({
    ...store,
    [documentKey]: progress,
  }));
}

export function getPreference(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setPreference(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preferences remain effective for the current React state.
  }
}
