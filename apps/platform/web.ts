import {
  getPreference,
  readReadingHistoryStore,
  setPreference,
  writeReadingProgress,
} from './browser-storage';
import {
  BrowserPdfFileHandle,
  storeFileHandle,
} from './browser-file-handle';
import { blobResource } from './resources';
import { translateWithInstalledModel } from './browser-translation';
import type { PdfFileHandle, PlatformDocument, ViewerPlatform } from './types';

const RECENT_FILE_KEY = 'web:recent-pdf';

class DownloadPdfFileHandle implements PdfFileHandle {
  constructor(readonly name: string) {}

  async prepareWrite() {
    const shouldDownload = window.confirm(
      'Direct saving is not available for this file. Download a copy instead?',
    );
    if (!shouldDownload) return null;

    const fileName = this.name;
    return {
      async save(data: ArrayBuffer) {
        const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        anchor.hidden = true;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        return true;
      },
    };
  }
}

function documentFromFile(file: File, fileHandle: PdfFileHandle): PlatformDocument {
  return {
    resource: blobResource(file),
    key: `local:${file.name}:${file.size}:${file.lastModified}`,
    name: file.name,
    fileHandle,
  };
}

export const platform: ViewerPlatform = {
  async loadViewerResources(bundledWasmUrl) {
    return {
      wasm: { url: bundledWasmUrl },
      document: undefined,
    };
  },
  openLocalDocument(file) {
    return documentFromFile(file, new DownloadPdfFileHandle(file.name));
  },
  ...('showOpenFilePicker' in window ? {
    async pickLocalDocument() {
      const [handle] = await window.showOpenFilePicker({
        id: 'pdf-file',
        startIn: 'documents',
        types: [{ description: 'PDF Document', accept: { 'application/pdf': ['.pdf'] } }],
        excludeAcceptAllOption: true,
        multiple: false,
      });
      await storeFileHandle(RECENT_FILE_KEY, handle);
      return documentFromFile(
        await handle.getFile(),
        new BrowserPdfFileHandle(handle, RECENT_FILE_KEY),
      );
    },
  } : {}),
  openExternal(url) {
    try {
      const target = new URL(url, window.location.href);
      if (target.protocol !== 'http:' && target.protocol !== 'https:') return;
      window.open(target.href, '_blank', 'noopener,noreferrer');
    } catch {
      // Ignore malformed or unsafe targets embedded in a PDF.
    }
  },
  translate: translateWithInstalledModel,
  getPreference,
  setPreference,
  async readReadingProgress(documentKey) {
    return (await readReadingHistoryStore())?.[documentKey];
  },
  writeReadingProgress,
};
