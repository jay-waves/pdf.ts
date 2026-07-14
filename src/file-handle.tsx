import type { PluginRegistry } from '@embedpdf/core';
import type { ExportCapability } from '@embedpdf/plugin-export';
import type React from 'react';
import { get, set } from 'idb-keyval';

const FILE_HANDLES_KEY = 'embedpdf-file-handles-v1';

interface StoredFileHandleEntry {
  fileUrl: string;
  name: string;
  handle: FileSystemFileHandle;
  permissionMode: 'read' | 'readwrite';
  updatedAt: string;
}

type StoredFileHandleStore = Record<string, StoredFileHandleEntry>;

function getFileName(fileUrl: string) {
  try {
    return decodeURIComponent(new URL(fileUrl).pathname.split('/').pop() || 'document.pdf');
  } catch {
    return 'document.pdf';
  }
}

export async function verifyPermission(handle: FileSystemHandle, readWrite = true) {
  const options: FileSystemHandlePermissionDescriptor = readWrite ? { mode: 'readwrite' } : { mode: 'read' };

  return (await handle.queryPermission(options)) === 'granted' || (await handle.requestPermission(options)) === 'granted';
}

async function readStoredFileHandles() {
  const store = await get<StoredFileHandleStore>(FILE_HANDLES_KEY);
  return store && typeof store === 'object' ? store : {};
}

async function writeStoredFileHandle(fileUrl: string, handle: FileSystemFileHandle, readWrite = true) {
  const store = await readStoredFileHandles();
  store[fileUrl] = {
    fileUrl,
    name: handle.name,
    handle,
    permissionMode: readWrite ? 'readwrite' : 'read',
    updatedAt: new Date().toISOString(),
  };
  await set(FILE_HANDLES_KEY, store);
}

async function getStoredFileHandle(fileUrl: string, readWrite = true) {
  const store = await readStoredFileHandles();
  const entry = store[fileUrl];

  if (!entry?.handle) {
    return null;
  }

  return (await verifyPermission(entry.handle, readWrite)) ? entry.handle : null;
}

export async function initFileHandle(
  fileUrl: string | undefined,
  fileHandleRef: React.MutableRefObject<FileSystemFileHandle | null>,
  readWrite = true,
) {
  if (!fileUrl?.startsWith('file://')) {
    return null;
  }

  if (fileHandleRef.current && (await verifyPermission(fileHandleRef.current, readWrite))) {
    return fileHandleRef.current;
  }

  const storedHandle = await getStoredFileHandle(fileUrl, readWrite);
  if (storedHandle) {
    fileHandleRef.current = storedHandle;
    return storedHandle;
  }

  const pickedHandle = await window.showSaveFilePicker({
    id: 'pdf-file',
    suggestedName: getFileName(fileUrl),
    startIn: 'documents',
    types: [{ description: 'PDF Document', accept: { 'application/pdf': ['.pdf'] } }],
    excludeAcceptAllOption: true,
  });

  if (!(await verifyPermission(pickedHandle, readWrite))) {
    return null;
  }

  fileHandleRef.current = pickedHandle;
  await writeStoredFileHandle(fileUrl, pickedHandle, readWrite);
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

  const fileHandle = await initFileHandle(fileUrl, fileHandleRef, true);
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
