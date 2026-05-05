import type { PluginRegistry } from '@embedpdf/core';
import type { PDFViewerRef } from '@embedpdf/react-pdf-viewer';
import type React from 'react';
import { get, set } from 'idb-keyval';
import { getActiveDocumentId, type ScrollCapability } from './utils';

const EMPTY_CLEANUP = () => {};
const READING_HISTORY_KEY = 'embedpdf-reading-history-v1';
const FILE_HANDLES_KEY = 'embedpdf-file-handles-v1';

interface ReadingHistoryEntry {
  pageNumber: number;
  updatedAt: string;
}

type ReadingHistoryStore = Record<string, ReadingHistoryEntry>;

interface StoredFileHandleEntry {
  fileUrl: string;
  name: string;
  handle: FileSystemFileHandle;
  permissionMode: 'read' | 'readwrite';
  updatedAt: string;
}

type StoredFileHandleStore = Record<string, StoredFileHandleEntry>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function getPermissionOptions(readWrite: boolean): FileSystemHandlePermissionDescriptor {
  return readWrite ? { mode: 'readwrite' } : { mode: 'read' };
}

export async function verifyPermission(handle: FileSystemHandle, readWrite = true) {
  const options = getPermissionOptions(readWrite);

  if ((await handle.queryPermission(options)) === 'granted') {
    return true;
  }

  if ((await handle.requestPermission(options)) === 'granted') {
    return true;
  }

  return false;
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

  const hasPermission = await verifyPermission(entry.handle, readWrite);
  return hasPermission ? entry.handle : null;
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

  const [pickedHandle] = await window.showOpenFilePicker({
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
  viewerRef: React.RefObject<PDFViewerRef | null>,
  fileHandleRef: React.MutableRefObject<FileSystemFileHandle | null>,
  fileUrl?: string,
) {
  if (!viewerRef.current) {
    return;
  }

  const registry = await viewerRef.current.registry;
  const exportPlugin = registry?.getPlugin('export')?.provides?.();

  if (!exportPlugin) {
    return;
  }

  const arrayBuffer = await exportPlugin.saveAsCopy().toPromise();
  if (!arrayBuffer) {
    return;
  }

  const fileHandle = await initFileHandle(fileUrl, fileHandleRef, true);
  if (!fileHandle) {
    return;
  }

  const writable = await fileHandle.createWritable();
  await writable.write(new Blob([arrayBuffer], { type: 'application/pdf' }));
  await writable.close();
}

function readLegacyHistoryStore() {
  try {
    const raw = window.localStorage.getItem(READING_HISTORY_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? (parsed as ReadingHistoryStore) : {};
  } catch {
    return {};
  }
}

async function readHistoryStore() {
  const stored = await get<ReadingHistoryStore>(READING_HISTORY_KEY);
  if (isRecord(stored)) {
    return stored as ReadingHistoryStore;
  }

  const legacyStore = readLegacyHistoryStore();
  if (Object.keys(legacyStore).length) {
    await set(READING_HISTORY_KEY, legacyStore);
    window.localStorage.removeItem(READING_HISTORY_KEY);
  }

  return legacyStore;
}

async function writeHistoryEntry(fileUrl: string, pageNumber: number) {
  if (!fileUrl || pageNumber < 1) {
    return;
  }

  const store = await readHistoryStore();
  store[fileUrl] = {
    pageNumber,
    updatedAt: new Date().toISOString(),
  };
  await set(READING_HISTORY_KEY, store);
}

async function readHistoryEntry(fileUrl: string) {
  return (await readHistoryStore())[fileUrl];
}

export function installReadingHistory(registry: PluginRegistry, fileUrl?: string) {
  if (!fileUrl) {
    return EMPTY_CLEANUP;
  }

  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  if (!scroll) {
    return EMPTY_CLEANUP;
  }

  let restoredDocumentId: string | null = null;
  let pendingPageNumber = 0;
  let pendingWriteId = 0;

  const flushPendingWrite = () => {
    pendingWriteId = 0;
    return writeHistoryEntry(fileUrl, pendingPageNumber);
  };

  const scheduleHistoryWrite = (pageNumber: number) => {
    pendingPageNumber = pageNumber;
    if (pendingWriteId) {
      window.clearTimeout(pendingWriteId);
    }
    pendingWriteId = window.setTimeout(() => {
      flushPendingWrite().catch((error) => {
        console.warn('[shnctl] failed to write reading history', error);
      });
    }, 300);
  };

  const unsubscribePageChange = scroll.onPageChange((event) => {
    scheduleHistoryWrite(event.pageNumber);
  });

  const unsubscribeLayoutReady = scroll.onLayoutReady((event) => {
    if (!event.isInitial || restoredDocumentId === event.documentId) {
      return;
    }

    restoredDocumentId = event.documentId;

    readHistoryEntry(fileUrl)
      .then((saved) => {
        if (!saved || saved.pageNumber <= 1) {
          return;
        }

        scroll.forDocument(event.documentId).scrollToPage({
          pageNumber: saved.pageNumber,
          behavior: 'instant',
        });
      })
      .catch((error) => {
        console.warn('[shnctl] failed to read reading history', error);
      });
  });

  const onBeforeUnload = () => {
    if (pendingWriteId) {
      window.clearTimeout(pendingWriteId);
      flushPendingWrite();
    }

    const documentId = getActiveDocumentId(registry);
    if (!documentId) {
      return;
    }

    writeHistoryEntry(fileUrl, scroll.forDocument(documentId).getCurrentPage());
  };

  window.addEventListener('beforeunload', onBeforeUnload);

  return () => {
    if (pendingWriteId) {
      window.clearTimeout(pendingWriteId);
      flushPendingWrite().catch((error) => {
        console.warn('[shnctl] failed to write reading history', error);
      });
    }
    window.removeEventListener('beforeunload', onBeforeUnload);
    unsubscribePageChange();
    unsubscribeLayoutReady();
  };
}
