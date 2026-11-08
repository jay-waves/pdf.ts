import type { PdfWritePlan, PdfWriteResult } from '../renderer/document-save';
import { fingerprintFile } from './file-fingerprint';
import { get, update } from 'idb-keyval';
import { downloadPdf } from './browser-download';
import type { PdfFileHandle } from './types';

const FILE_HANDLES_KEY = 'pdf-ts-file-handles-v3';
type FileHandleStore = Record<string, FileSystemFileHandle>;

export async function readStoredFileHandle(key: string) {
  return (await get<FileHandleStore>(FILE_HANDLES_KEY))?.[key];
}

async function storeFileHandle(key: string, handle: FileSystemFileHandle) {
  await update<FileHandleStore>(FILE_HANDLES_KEY, (store) => ({
    ...(store && typeof store === 'object' ? store : {}),
    [key]: handle,
  }));
}

export async function verifyFilePermission(
  handle: FileSystemFileHandle,
  mode: 'read' | 'readwrite',
  request: boolean,
) {
  const options: FileSystemHandlePermissionDescriptor = { mode };
  const current = await handle.queryPermission(options);
  return current === 'granted' ||
    (request && await handle.requestPermission(options) === 'granted');
}

export async function pickPdfFileHandle() {
  const [handle] = await window.showOpenFilePicker({
    id: 'pdf-file',
    startIn: 'documents',
    types: [{ description: 'PDF Document', accept: { 'application/pdf': ['.pdf'] } }],
    excludeAcceptAllOption: true,
    multiple: false,
  });
  return handle;
}

export function createDownloadWriter(fileName: string) {
  return {
    async writeShared(plan: PdfWritePlan): Promise<PdfWriteResult> {
      downloadPdf(plan.data, fileName);
      return { status: 'copy' };
    },
    async save(data: ArrayBuffer) {
      downloadPdf(data, fileName);
      return true;
    },
  };
}

export function createBrowserWriter(
  nativeHandle: FileSystemFileHandle,
  storageKey?: string,
) {
  const remember = async () => {
    if (storageKey) {
      try { await storeFileHandle(storageKey, nativeHandle); }
      catch (error) { console.warn('[pdf-ts] The PDF was saved, but its persistent file handle was not.', error); }
    }
  };
  return {
    async writeShared(plan: PdfWritePlan): Promise<PdfWriteResult> {
      if (plan.destination === 'copy') {
        downloadPdf(plan.data, nativeHandle.name);
        return { status: 'copy' };
      }
      const before = await nativeHandle.getFile();
      if (await fingerprintFile(before) !== plan.expectedVersion) {
        return { status: window.confirm('This PDF changed on disk. Download your edits as a separate copy?') ? 'retry-copy' : 'cancelled' };
      }
      const writable = await nativeHandle.createWritable({ keepExistingData: false });
      const size = plan.data.byteLength;
      try {
        await writable.write(plan.data);
        await writable.truncate(size);
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => {});
        throw error;
      }
      const after = await nativeHandle.getFile();
      if (after.size !== size || await fingerprintFile(after) !== plan.outputVersion) {
        throw new Error('The PDF could not be verified after writing.');
      }
      await remember();
      return { status: 'saved', version: plan.outputVersion };
    },
    async save(data: ArrayBuffer) {
      const writable = await nativeHandle.createWritable();
      try {
        await writable.write(new Blob([data], { type: 'application/pdf' }));
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => {});
        throw error;
      }

      const writtenFile = await nativeHandle.getFile();
      if (writtenFile.size !== data.byteLength) {
        throw new DOMException('The PDF could not be verified after writing.', 'NotReadableError');
      }

      await remember();
      return true;
    },
  };
}

export class BrowserPdfFileHandle implements PdfFileHandle {
  constructor(
    private readonly nativeHandle: FileSystemFileHandle,
    private readonly storageKey?: string,
  ) {}

  async prepareWrite() {
    if (!(await verifyFilePermission(this.nativeHandle, 'readwrite', true))) {
      const shouldDownload = window.confirm(
        'Write permission was not granted. Download a copy instead?',
      );
      if (!shouldDownload) return null;
      return createDownloadWriter(this.nativeHandle.name);
    }

    return createBrowserWriter(this.nativeHandle, this.storageKey);
  }
}
