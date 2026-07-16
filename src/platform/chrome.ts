import { get, set, update } from 'idb-keyval';
import { getFileNameFromUrl } from '../utils';
import type { ManagedResource, ReadingProgress, SavePdfOptions, ViewerPlatform } from './types';
import { translateText } from './chrome-translation';

export const documentEditingEnabled = true;

const READING_HISTORY_KEY = 'embedpdf-reading-history-v1';
// v1 could contain handles returned by showSaveFilePicker, which may point to
// a copy rather than the source PDF. Do not silently reuse those handles.
const FILE_HANDLES_KEY = 'embedpdf-file-handles-v2';
type ReadingHistoryStore = Record<string, ReadingProgress>;
type FileHandleStore = Record<string, { handle: FileSystemFileHandle }>;
let activeFile: { sourceUrl: string; handle: FileSystemFileHandle } | null = null;

async function verifyWritePermission(handle: FileSystemFileHandle) {
  const options: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' };
  return (await handle.queryPermission(options)) === 'granted' ||
    (await handle.requestPermission(options)) === 'granted';
}

async function getWritableFileHandle({ sourceUrl, fileName }: SavePdfOptions) {
  if (!sourceUrl?.startsWith('file://')) return null;

  if (activeFile?.sourceUrl === sourceUrl && await verifyWritePermission(activeFile.handle)) {
    return activeFile.handle;
  }

  const store = await get<FileHandleStore>(FILE_HANDLES_KEY);
  const storedHandle = store?.[sourceUrl]?.handle;
  if (storedHandle && await verifyWritePermission(storedHandle)) {
    activeFile = { sourceUrl, handle: storedHandle };
    return storedHandle;
  }

  const [pickedHandle] = await window.showOpenFilePicker({
    id: 'pdf-file',
    startIn: 'documents',
    types: [{ description: 'PDF Document', accept: { 'application/pdf': ['.pdf'] } }],
    excludeAcceptAllOption: true,
    multiple: false,
  });
  const expectedName = fileName ?? getFileNameFromUrl(sourceUrl);
  if (expectedName && pickedHandle.name !== expectedName) {
    throw new DOMException(`Please select the original PDF (${expectedName}).`, 'InvalidStateError');
  }
  if (!(await verifyWritePermission(pickedHandle))) return null;

  activeFile = { sourceUrl, handle: pickedHandle };
  return pickedHandle;
}

async function preparePdfFileSave(options: SavePdfOptions) {
  const handle = await getWritableFileHandle(options);
  if (!handle || !options.sourceUrl) return null;

  return {
    async save(data: ArrayBuffer) {
      const writable = await handle.createWritable();
      await writable.write(new Blob([data], { type: 'application/pdf' }));
      await writable.close();

      const writtenFile = await handle.getFile();
      if (writtenFile.size !== data.byteLength) {
        throw new DOMException('The PDF could not be verified after writing.', 'NotReadableError');
      }

      await update<FileHandleStore>(FILE_HANDLES_KEY, (store) => ({
        ...(store && typeof store === 'object' ? store : {}),
        [options.sourceUrl!]: { handle },
      }));
      return true;
    },
  };
}

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

function persistentResource(url: string): ManagedResource {
  return { url, release() {} };
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
  rendering: {
    maxDpr: 1.75,
  },
  async loadViewerResources(bundledWasmUrl) {
    const documentUrl = getDocumentUrl();
    return {
      wasm: persistentResource(bundledWasmUrl),
      document: documentUrl ? {
        resource: persistentResource(documentUrl),
        sourceUrl: documentUrl,
        key: documentUrl,
        name: getFileNameFromUrl(documentUrl),
      } : undefined,
    };
  },
  openExternal(url) {
    window.open(url, '_blank', 'noopener,noreferrer');
  },
  translate: translateText,
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
  preparePdfSave: preparePdfFileSave,
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
