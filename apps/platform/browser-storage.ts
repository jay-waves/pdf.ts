import { get, update } from 'idb-keyval';
import type { ReadingProgress, ViewerPlatform } from './types';

const READING_HISTORY_KEY = 'embedpdf-reading-history-v1';
type ReadingHistoryStore = Record<string, ReadingProgress>;

async function writeReadingProgress(documentKey: string, progress: ReadingProgress) {
  await update<ReadingHistoryStore>(READING_HISTORY_KEY, (store) => ({
    ...store,
    [documentKey]: progress,
  }));
}

function getPreference(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setPreference(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preferences remain effective for the current React state.
  }
}

export const browserPersistence = {
  getPreference,
  setPreference,
  async readReadingProgress(documentKey: string) {
    return (await get<ReadingHistoryStore>(READING_HISTORY_KEY))?.[documentKey];
  },
  writeReadingProgress,
} satisfies Pick<
  ViewerPlatform,
  'getPreference' | 'setPreference' | 'readReadingProgress' | 'writeReadingProgress'
>;
