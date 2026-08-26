import { getFileNameFromUrl, parseUrl } from '../shared/url';
import { browserPersistence } from './browser-storage';
import { browserLocalDocumentCapabilities } from './browser-local-document';
import {
  createBrowserWriter,
  pickPdfFileHandle,
  readStoredFileHandle,
  verifyFilePermission,
} from './browser-file-handle';
import { browserTranslationCapabilities } from './browser-translation';
import type { PdfFileHandle, ViewerPlatform } from './types';

let activeDocumentUrl: string | undefined;
type ChromeGlobal = typeof globalThis & {
  chrome: {
    tabs: {
      create(options: { url: string }): Promise<unknown>;
    };
  };
};

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
  ...browserLocalDocumentCapabilities,
  openExternal(url) {
    const target = parseUrl(url, activeDocumentUrl ?? window.location.href);
    if (!target || !['file:', 'http:', 'https:'].includes(target.protocol)) return;
    void (globalThis as ChromeGlobal).chrome.tabs.create({ url: target.href });
  },
  ...browserTranslationCapabilities,
  ...browserPersistence,
};
