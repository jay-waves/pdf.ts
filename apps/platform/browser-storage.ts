import { get, set } from 'idb-keyval';
import type { ReadingProgress, ViewerPlatform } from './types';

const READING_HISTORY_KEY = 'embedpdf-reading-history-v1';
const readingKey = (documentKey: string) => `pdf-ts-reading-progress-v2:${documentKey}`;
type ReadingHistoryStore = Record<string, ReadingProgress>;

async function writeReadingProgress(documentKey: string, progress: ReadingProgress) {
  await set(readingKey(documentKey), progress);
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
    return await get<ReadingProgress>(readingKey(documentKey))
      ?? (await get<ReadingHistoryStore>(READING_HISTORY_KEY))?.[documentKey];
  },
  writeReadingProgress,
} satisfies Pick<
  ViewerPlatform,
  'getPreference' | 'setPreference' | 'readReadingProgress' | 'writeReadingProgress'
>;
