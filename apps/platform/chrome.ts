import { get, update } from 'idb-keyval';
import { getFileNameFromUrl } from '../utils';
import {
  getPreference,
  readReadingHistoryStore,
  setPreference,
  writeReadingProgress,
} from './browser-storage';
import { translateText } from './chrome-translation';
import type { SavePdfOptions, ViewerPlatform } from './types';

export const documentEditingEnabled = true;

// v1 could contain handles returned by showSaveFilePicker, which may point to
// a copy rather than the source PDF. Do not silently reuse those handles.
const FILE_HANDLES_KEY = 'embedpdf-file-handles-v2';
type FileHandleStore = Record<string, { handle: FileSystemFileHandle }>;
let activeFile: { sourceUrl: string; handle: FileSystemFileHandle } | null = null;
let activeDocumentUrl: string | undefined;
let googleTranslateTabId: number | undefined;
interface ChromeTab {
  id?: number;
  windowId: number;
}
type ChromeGlobal = typeof globalThis & {
  chrome: {
    tabs: {
      create(options: { url: string }): Promise<ChromeTab>;
      query(options: { url: string }): Promise<ChromeTab[]>;
      update(tabId: number, options: { url: string; active: boolean }): Promise<ChromeTab>;
    };
    windows: {
      update(windowId: number, options: { focused: boolean }): Promise<unknown>;
    };
  };
};

async function updateGoogleTranslateTab(tabId: number, url: string) {
  try {
    const tab = await (globalThis as ChromeGlobal).chrome.tabs.update(tabId, { url, active: true });
    googleTranslateTabId = tabId;
    void (globalThis as ChromeGlobal).chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    return true;
  } catch {
    if (googleTranslateTabId === tabId) googleTranslateTabId = undefined;
    return false;
  }
}

async function openGoogleTranslate(url: string) {
  const { tabs } = (globalThis as ChromeGlobal).chrome;
  if (googleTranslateTabId !== undefined && await updateGoogleTranslateTab(googleTranslateTabId, url)) {
    return;
  }

  try {
    const [existingTab] = await tabs.query({ url: 'https://translate.google.com/*' });
    if (existingTab?.id !== undefined && await updateGoogleTranslateTab(existingTab.id, url)) return;
  } catch {
    // Fall through and create a replacement tab.
  }

  const createdTab = await tabs.create({ url });
  googleTranslateTabId = createdTab.id;
}

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
  const { sourceUrl } = options;
  if (!handle || !sourceUrl) return null;

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
        [sourceUrl]: { handle },
      }));
      return true;
    },
  };
}

function getDocumentUrl() {
  const params = new URLSearchParams(window.location.search);
  const file = params.get('file');
  if (!file) return undefined;

  try {
    const url = new URL(file);
    return url.protocol === 'file:' && url.pathname.toLowerCase().endsWith('.pdf') ? file : undefined;
  } catch {
    return undefined;
  }
}

export const platform: ViewerPlatform = {
  async loadViewerResources(bundledWasmUrl) {
    const documentUrl = getDocumentUrl();
    activeDocumentUrl = documentUrl;
    return {
      wasm: { url: bundledWasmUrl },
      document: documentUrl ? {
        resource: { url: documentUrl },
        sourceUrl: documentUrl,
        key: documentUrl,
        name: getFileNameFromUrl(documentUrl),
      } : undefined,
    };
  },
  openExternal(url) {
    try {
      const target = new URL(url, activeDocumentUrl ?? window.location.href);
      if (!['file:', 'http:', 'https:'].includes(target.protocol)) return;
      if (target.hostname === 'translate.google.com') {
        void openGoogleTranslate(target.href).catch(() => {});
        return;
      }
      void (globalThis as ChromeGlobal).chrome.tabs.create({ url: target.href });
    } catch {
      // Ignore malformed or unsafe targets embedded in a PDF.
    }
  },
  translate: translateText,
  getPreference,
  setPreference,
  preparePdfSave: preparePdfFileSave,
  async readReadingProgress(documentKey) {
    return (await readReadingHistoryStore())?.[documentKey];
  },
  writeReadingProgress,
};
