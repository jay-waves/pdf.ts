import { getFileNameFromUrl, parseUrl } from '../shared/url';
import { browserPersistence } from './browser-storage';
import {
  createBrowserWriter,
  pickPdfFileHandle,
  readStoredFileHandle,
  verifyFilePermission,
} from './browser-file-handle';
import { translateWithModelDownload } from './browser-translation';
import type { PdfFileHandle, ViewerPlatform } from './types';

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

class ChromePdfFileHandle implements PdfFileHandle {
  private nativeHandle?: FileSystemFileHandle;

  constructor(
    private readonly sourceUrl: string,
    readonly name: string,
  ) {}

  private async resolveHandle() {
    if (
      this.nativeHandle &&
      await verifyFilePermission(this.nativeHandle, 'readwrite', true)
    ) {
      return this.nativeHandle;
    }

    const storedHandle = await readStoredFileHandle(this.sourceUrl);
    if (storedHandle && await verifyFilePermission(storedHandle, 'readwrite', true)) {
      this.nativeHandle = storedHandle;
      return storedHandle;
    }

    const pickedHandle = await pickPdfFileHandle();
    if (pickedHandle.name !== this.name) {
      throw new DOMException(`Please select the original PDF (${this.name}).`, 'InvalidStateError');
    }
    if (!(await verifyFilePermission(pickedHandle, 'readwrite', true))) return null;

    this.nativeHandle = pickedHandle;
    return pickedHandle;
  }

  async prepareWrite() {
    const handle = await this.resolveHandle();
    return handle ? createBrowserWriter(handle, this.sourceUrl) : null;
  }
}

function getDocumentUrl() {
  const params = new URLSearchParams(window.location.search);
  const file = params.get('file');
  if (!file) return undefined;

  const url = parseUrl(file);
  return url?.protocol === 'file:' && url.pathname.toLowerCase().endsWith('.pdf')
    ? file
    : undefined;
}

export const platform: ViewerPlatform = {
  async loadViewerResources(bundledWasmUrl) {
    const documentUrl = getDocumentUrl();
    const documentName = documentUrl ? getFileNameFromUrl(documentUrl) ?? 'document.pdf' : undefined;
    activeDocumentUrl = documentUrl;
    return {
      wasm: { url: bundledWasmUrl },
      document: documentUrl ? {
        resource: { url: documentUrl },
        key: documentUrl,
        name: documentName,
        fileHandle: new ChromePdfFileHandle(documentUrl, documentName ?? 'document.pdf'),
      } : undefined,
    };
  },
  openExternal(url) {
    const target = parseUrl(url, activeDocumentUrl ?? window.location.href);
    if (!target || !['file:', 'http:', 'https:'].includes(target.protocol)) return;
    if (target.hostname === 'translate.google.com') {
      void openGoogleTranslate(target.href).catch(() => {});
      return;
    }
    void (globalThis as ChromeGlobal).chrome.tabs.create({ url: target.href });
  },
  translate: translateWithModelDownload,
  ...browserPersistence,
};
