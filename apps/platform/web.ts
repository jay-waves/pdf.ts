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
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new TypeError('Please select a PDF file.');
  }
  return {
    resource: blobResource(file),
    key: `local:${file.name}:${file.size}:${file.lastModified}`,
    name: file.name,
    fileHandle,
  };
}

function pickFileWithInput() {
  return new Promise<File | undefined>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.hidden = true;
    const finish = (file?: File) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => finish(input.files?.[0]), { once: true });
    input.addEventListener('cancel', () => finish(), { once: true });
    document.body.append(input);
    input.click();
  });
}

export const platform: ViewerPlatform = {
  async loadViewerResources(bundledWasmUrl) {
    return {
      wasm: { url: bundledWasmUrl },
    };
  },
  async openLocalDocument(file) {
    if (file) return documentFromFile(file, new DownloadPdfFileHandle(file.name));
    if ('showOpenFilePicker' in window) {
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
    }
    const pickedFile = await pickFileWithInput();
    return pickedFile
      ? documentFromFile(pickedFile, new DownloadPdfFileHandle(pickedFile.name))
      : undefined;
  },
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
