import {
  getPreference,
  readReadingHistoryStore,
  setPreference,
  writeReadingProgress,
} from './browser-storage';
import {
  BrowserPdfFileHandle,
  createDownloadWriter,
} from './browser-file-handle';
import { blobResource } from './resources';
import { translateWithInstalledModel } from './browser-translation';
import type { PdfFileHandle, PlatformDocument, ViewerPlatform } from './types';
import { getExternalUrl } from '../url';

class DownloadPdfFileHandle implements PdfFileHandle {
  constructor(readonly name: string) {}

  async prepareWrite() {
    const shouldDownload = window.confirm(
      'Direct saving is not available for this file. Download a copy instead?',
    );
    if (!shouldDownload) return null;
    return createDownloadWriter(this.name);
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
      return documentFromFile(
        await handle.getFile(),
        new BrowserPdfFileHandle(handle),
      );
    },
  } : {}),
  openExternal(url) {
    const target = getExternalUrl(url, window.location.href);
    if (target) window.open(target, '_blank', 'noopener,noreferrer');
  },
  translate: translateWithInstalledModel,
  getPreference,
  setPreference,
  async readReadingProgress(documentKey) {
    return (await readReadingHistoryStore())?.[documentKey];
  },
  writeReadingProgress,
};
