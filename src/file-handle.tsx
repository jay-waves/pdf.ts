import type { PluginRegistry } from '@embedpdf/core';
import type { PDFViewerRef } from '@embedpdf/react-pdf-viewer';
import type React from 'react';
import { get, set } from 'idb-keyval';
import {
  EMPTY_CLEANUP,
  getActiveDocumentId,
  restoreScrollAnchorAfterLayout,
  runWhenIdle,
  type ScrollCapability,
} from './utils';

const READING_HISTORY_KEY = 'embedpdf-reading-history-v1';
const FILE_HANDLES_KEY = 'embedpdf-file-handles-v1';

type ScrollStrategyValue = 'vertical' | 'horizontal';
type SpreadModeValue = 'none' | 'odd' | 'even';

interface ReadingHistoryEntry {
  pageNumber: number;
  scrollStrategy?: ScrollStrategyValue;
  spreadMode?: SpreadModeValue;
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

interface SpreadCapability {
  forDocument(documentId: string): {
    setSpreadMode(mode: SpreadModeValue): void;
    getSpreadMode(): SpreadModeValue;
  };
  onSpreadChange(listener: (event: { documentId: string; spreadMode: SpreadModeValue }) => void): () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

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
  viewerRef: React.RefObject<PDFViewerRef | null>,
  fileHandleRef: React.MutableRefObject<FileSystemFileHandle | null>,
  fileUrl?: string,
) {
  if (!viewerRef.current) {
    return false;
  }

  const registry = await viewerRef.current.registry;
  const exportPlugin = registry?.getPlugin('export')?.provides?.();

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

function readLegacyHistoryStore() {
  try {
    const raw = window.localStorage.getItem(READING_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : undefined;
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

function isScrollStrategy(value: unknown): value is ScrollStrategyValue {
  return value === 'vertical' || value === 'horizontal';
}

function isSpreadMode(value: unknown): value is SpreadModeValue {
  return value === 'none' || value === 'odd' || value === 'even';
}

async function writeHistoryEntry(fileUrl: string, entry: Omit<ReadingHistoryEntry, 'updatedAt'>) {
  if (!fileUrl || entry.pageNumber < 1) {
    return;
  }

  const store = await readHistoryStore();
  store[fileUrl] = {
    pageNumber: entry.pageNumber,
    scrollStrategy: entry.scrollStrategy,
    spreadMode: entry.spreadMode,
    updatedAt: new Date().toISOString(),
  };
  await set(READING_HISTORY_KEY, store);
}

export function installReadingHistory(registry: PluginRegistry, fileUrl?: string) {
  if (!fileUrl) {
    return EMPTY_CLEANUP;
  }

  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  if (!scroll) {
    return EMPTY_CLEANUP;
  }

  const spread = registry.getPlugin('spread')?.provides?.() as SpreadCapability | undefined;
  let restoredDocumentId: string | null = null;
  let historyReady = false;
  let pendingWriteId = 0;
  let cancelPendingIdleWrite: (() => void) | null = null;

  const getScrollStrategy = (documentId: string) => {
    const state = registry.getStore().getState() as {
      plugins?: {
        scroll?: {
          documents?: Record<string, { strategy?: unknown }>;
        };
      };
    };

    return state.plugins?.scroll?.documents?.[documentId]?.strategy;
  };

  const getHistoryEntry = (documentId: string): Omit<ReadingHistoryEntry, 'updatedAt'> => {
    const scrollScope = scroll.forDocument(documentId);
    const scrollStrategy = getScrollStrategy(documentId);
    const spreadMode = spread?.forDocument(documentId).getSpreadMode();

    return {
      pageNumber: scrollScope.getCurrentPage(),
      scrollStrategy: isScrollStrategy(scrollStrategy) ? scrollStrategy : undefined,
      spreadMode: isSpreadMode(spreadMode) ? spreadMode : undefined,
    };
  };

  const flushPendingWrite = () => {
    pendingWriteId = 0;
    const documentId = getActiveDocumentId(registry);
    if (!documentId) {
      return Promise.resolve();
    }

    return writeHistoryEntry(fileUrl, getHistoryEntry(documentId));
  };

  const scheduleHistoryWrite = () => {
    if (!historyReady) {
      return;
    }

    if (pendingWriteId) {
      window.clearTimeout(pendingWriteId);
    }
    cancelPendingIdleWrite?.();
    cancelPendingIdleWrite = null;

    pendingWriteId = window.setTimeout(() => {
      pendingWriteId = 0;
      cancelPendingIdleWrite = runWhenIdle(() => {
        cancelPendingIdleWrite = null;
        flushPendingWrite().catch((error) => {
          console.warn('[shnctl] failed to write reading history', error);
        });
      });
    }, 300);
  };

  const unsubscribePageChange = scroll.onPageChange(() => scheduleHistoryWrite());
  const unsubscribeSpreadChange = spread?.onSpreadChange(() => scheduleHistoryWrite());
  const unsubscribeScrollStateChange = scroll.onStateChange((state) => {
    if (isScrollStrategy(state.strategy)) {
      scheduleHistoryWrite();
    }
  });

  const unsubscribeLayoutReady = scroll.onLayoutReady((event) => {
    if (!event.isInitial || restoredDocumentId === event.documentId) {
      return;
    }

    restoredDocumentId = event.documentId;

    readHistoryStore()
      .then((store) => store[fileUrl])
      .then((saved) => {
        if (!saved) {
          historyReady = true;
          return;
        }

        if (isSpreadMode(saved.spreadMode)) {
          spread?.forDocument(event.documentId).setSpreadMode(saved.spreadMode);
        }

        if (isScrollStrategy(saved.scrollStrategy)) {
          scroll.setScrollStrategy(saved.scrollStrategy, event.documentId);
        }

        restoreScrollAnchorAfterLayout(registry, {
          documentId: event.documentId,
          pageNumber: saved.pageNumber,
        });
        historyReady = true;
      })
      .catch((error) => {
        historyReady = true;
        console.warn('[shnctl] failed to read reading history', error);
      });
  });

  const flushFinalHistoryWrite = () => {
    if (pendingWriteId) {
      window.clearTimeout(pendingWriteId);
      pendingWriteId = 0;
    }
    cancelPendingIdleWrite?.();
    cancelPendingIdleWrite = null;

    if (!historyReady) {
      return Promise.resolve();
    }

    const documentId = getActiveDocumentId(registry);
    if (!documentId) {
      return Promise.resolve();
    }

    return writeHistoryEntry(fileUrl, getHistoryEntry(documentId));
  };

  const onClose = () => {
    flushFinalHistoryWrite().catch((error) => {
      console.warn('[shnctl] failed to write final reading history', error);
    });
  };

  window.addEventListener('beforeunload', onClose);
  window.addEventListener('pagehide', onClose);

  return () => {
    onClose();
    window.removeEventListener('beforeunload', onClose);
    window.removeEventListener('pagehide', onClose);
    unsubscribePageChange();
    unsubscribeSpreadChange?.();
    unsubscribeScrollStateChange();
    unsubscribeLayoutReady();
  };
}
