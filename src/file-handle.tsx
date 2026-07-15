import type { PluginRegistry } from '@embedpdf/core';
import type { ExportCapability } from '@embedpdf/plugin-export';
import type React from 'react';
import { get, update } from 'idb-keyval';
import { getFileNameFromUrl } from './utils';

const FILE_HANDLES_KEY = 'embedpdf-file-handles-v1';

interface StoredFileHandleEntry {
  handle: FileSystemFileHandle;
}

type StoredFileHandleStore = Record<string, StoredFileHandleEntry>;

async function verifyPermission(handle: FileSystemHandle) {
  const options: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' };
  return (await handle.queryPermission(options)) === 'granted' || (await handle.requestPermission(options)) === 'granted';
}

async function readStoredFileHandles() {
  const store = await get<StoredFileHandleStore>(FILE_HANDLES_KEY);
  return store && typeof store === 'object' ? store : {};
}

async function writeStoredFileHandle(fileUrl: string, handle: FileSystemFileHandle) {
  await update<StoredFileHandleStore>(FILE_HANDLES_KEY, (store) => ({
    ...(store && typeof store === 'object' ? store : {}),
    [fileUrl]: { handle },
  }));
}

async function getStoredFileHandle(fileUrl: string) {
  const store = await readStoredFileHandles();
  const entry = store[fileUrl];

  if (!entry?.handle) {
    return null;
  }

  return (await verifyPermission(entry.handle)) ? entry.handle : null;
}

async function initFileHandle(
  fileUrl: string | undefined,
  fileHandleRef: React.MutableRefObject<FileSystemFileHandle | null>,
) {
  if (!fileUrl?.startsWith('file://')) {
    return null;
  }

  if (fileHandleRef.current && (await verifyPermission(fileHandleRef.current))) {
    return fileHandleRef.current;
  }

  const storedHandle = await getStoredFileHandle(fileUrl);
  if (storedHandle) {
    fileHandleRef.current = storedHandle;
    return storedHandle;
  }

  const pickedHandle = await window.showSaveFilePicker({
    id: 'pdf-file',
    suggestedName: getFileNameFromUrl(fileUrl) ?? 'document.pdf',
    startIn: 'documents',
    types: [{ description: 'PDF Document', accept: { 'application/pdf': ['.pdf'] } }],
    excludeAcceptAllOption: true,
  });

  if (!(await verifyPermission(pickedHandle))) {
    return null;
  }

  fileHandleRef.current = pickedHandle;
  await writeStoredFileHandle(fileUrl, pickedHandle);
  return pickedHandle;
}

export async function savePdfToOriginalFile(
  registry: PluginRegistry | undefined,
  fileHandleRef: React.MutableRefObject<FileSystemFileHandle | null>,
  fileUrl?: string,
) {
  if (!registry) {
    return false;
  }

  const exportPlugin = registry.getPlugin('export')?.provides?.() as ExportCapability | undefined;

  if (!exportPlugin) {
    return false;
  }

  const fileHandle = await initFileHandle(fileUrl, fileHandleRef);
  if (!fileHandle) {
    return false;
  }

  const arrayBuffer = await exportPlugin.saveAsCopy().toPromise();
  if (!arrayBuffer) {
    return false;
  }

  const writable = await fileHandle.createWritable();
  await writable.write(new Blob([arrayBuffer], { type: 'application/pdf' }));
  await writable.close();
  return true;
}
