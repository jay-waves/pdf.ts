import {
  BrowserPdfFileHandle,
  createDownloadWriter,
  pickPdfFileHandle,
} from './browser-file-handle';
import type { ManagedResource, PdfFileHandle, PlatformDocument } from './types';

function blobResource(blob: Blob): ManagedResource {
  const url = URL.createObjectURL(blob);
  let released = false;

  return {
    url,
    openStream: () => blob.stream(),
    release() {
      if (released) return;
      released = true;
      URL.revokeObjectURL(url);
    },
  };
}

function createDownloadFileHandle(name: string): PdfFileHandle {
  return {
    async prepareWrite() {
      const shouldDownload = window.confirm(
        'Direct saving is not available for this file. Download a copy instead?',
      );
      return shouldDownload ? createDownloadWriter(name) : null;
    },
  };
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

async function openBrowserLocalDocument(file?: File) {
  if (file) return documentFromFile(file, createDownloadFileHandle(file.name));
  if ('showOpenFilePicker' in window) {
    const handle = await pickPdfFileHandle();
    return documentFromFile(await handle.getFile(), new BrowserPdfFileHandle(handle));
  }
  const pickedFile = await pickFileWithInput();
  return pickedFile
    ? documentFromFile(pickedFile, createDownloadFileHandle(pickedFile.name))
    : undefined;
}

export const browserLocalDocumentCapabilities = {
  openLocalDocument: openBrowserLocalDocument,
};
