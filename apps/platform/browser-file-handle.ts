import { get, update } from 'idb-keyval';
import { downloadPdf } from './browser-download';
import type { PdfFileHandle } from './types';

const FILE_HANDLES_KEY = 'pdf-ts-file-handles-v3';
type FileHandleStore = Record<string, FileSystemFileHandle>;
type LegacyFileHandleStore = Record<string, { handle?: FileSystemFileHandle }>;

export async function readStoredFileHandle(key: string, legacyStoreKey?: string) {
  const current = (await get<FileHandleStore>(FILE_HANDLES_KEY))?.[key];
  if (current || !legacyStoreKey) return current;
  return (await get<LegacyFileHandleStore>(legacyStoreKey))?.[key]?.handle;
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
  return {
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

      if (storageKey) {
        try {
          await storeFileHandle(storageKey, nativeHandle);
        } catch (error) {
          console.warn('[pdf-ts] The PDF was saved, but its persistent file handle was not.', error);
        }
      }
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
