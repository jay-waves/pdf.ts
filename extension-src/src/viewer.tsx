import { createRoot } from 'react-dom/client';
import type { PluginRegistry } from '@embedpdf/core';
import type { PDFViewerConfig } from '../../dist/index.js';
import { PDFViewer } from '../../dist/index.js';
import './viewer.css';

interface ZoomScope {
  getState(): { currentZoomLevel: number };
  requestZoom(level: 'fit-page'): void;
  requestZoomBy(delta: number, center?: { vx: number; vy: number }): void;
}

interface ZoomCapability {
  forDocument(documentId: string): ZoomScope;
}

interface ViewportCapability {
  forDocument(documentId: string): {
    getBoundingRect(): {
      origin: { x: number; y: number };
    };
  };
}

interface ScrollPageChangeEvent {
  documentId: string;
  pageNumber: number;
  totalPages: number;
}

interface ScrollLayoutReadyEvent {
  documentId: string;
  isInitial: boolean;
}

interface ScrollScope {
  getCurrentPage(): number;
  scrollToPage(options: { pageNumber: number; behavior?: 'instant' | 'smooth' | 'auto' }): void;
}

interface ScrollCapability {
  forDocument(documentId: string): ScrollScope;
  onPageChange(listener: (event: ScrollPageChangeEvent) => void): () => void;
  onLayoutReady(listener: (event: ScrollLayoutReadyEvent) => void): () => void;
}

interface ReadingHistoryEntry {
  pageNumber: number;
  updatedAt: string;
}

type ViewerConfig = Omit<PDFViewerConfig, 'commands' | 'ui'> & {
  commands?: Partial<NonNullable<PDFViewerConfig['commands']>> & {
    disabledCategories?: string[];
  };
  ui?: Partial<NonNullable<PDFViewerConfig['ui']>> & {
    disabledCategories?: string[];
  };
};

const READING_HISTORY_KEY = 'embedpdf-reading-history-v1';

const isPdfFileUrl = (value: string) =>
  value.startsWith('file://') && value.toLowerCase().split(/[?#]/, 1)[0].endsWith('.pdf');

function getInitialFileUrl() {
  const params = new URLSearchParams(window.location.search);
  const file = params.get('file') ?? params.get('src');

  return file && isPdfFileUrl(file) ? file : undefined;
}

function getActiveDocumentId(registry: PluginRegistry) {
  return registry.getStore().getState().core.activeDocumentId;
}

function readHistoryStore() {
  try {
    const raw = window.localStorage.getItem(READING_HISTORY_KEY);
    if (!raw) {
      return {} as Record<string, ReadingHistoryEntry>;
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, ReadingHistoryEntry>) : {};
  } catch {
    return {} as Record<string, ReadingHistoryEntry>;
  }
}

function writeHistoryEntry(fileUrl: string, pageNumber: number) {
  if (!fileUrl || pageNumber < 1) {
    return;
  }

  const store = readHistoryStore();
  store[fileUrl] = {
    pageNumber,
    updatedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(READING_HISTORY_KEY, JSON.stringify(store));
}

function readHistoryEntry(fileUrl: string) {
  return readHistoryStore()[fileUrl];
}

function requestPdfZoom(registry: PluginRegistry, direction: 1 | -1, event?: WheelEvent | KeyboardEvent) {
  const documentId = getActiveDocumentId(registry);
  const zoom = registry.getPlugin('zoom')?.provides?.() as ZoomCapability | undefined;

  if (!documentId || !zoom) {
    return;
  }

  const zoomScope = zoom.forDocument(documentId);
  const currentZoom = zoomScope.getState().currentZoomLevel || 1;
  const delta = currentZoom * 0.12 * direction;
  const viewportCapability = registry.getPlugin('viewport')?.provides?.() as ViewportCapability | undefined;
  const viewport = viewportCapability?.forDocument(documentId);
  const viewportRect = viewport?.getBoundingRect?.();
  const clientX = event instanceof WheelEvent ? event.clientX : window.innerWidth / 2;
  const clientY = event instanceof WheelEvent ? event.clientY : window.innerHeight / 2;
  const center = viewportRect
    ? {
        vx: clientX - viewportRect.origin.x,
        vy: clientY - viewportRect.origin.y,
      }
    : undefined;

  zoomScope.requestZoomBy(delta, center);
}

function installBrowserZoomInterceptor(registry: PluginRegistry) {
  let lastWheelZoomAt = 0;

  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const now = performance.now();
    if (now - lastWheelZoomAt < 45) {
      return;
    }

    lastWheelZoomAt = now;
    requestPdfZoom(registry, event.deltaY < 0 ? 1 : -1, event);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    if (event.key !== '+' && event.key !== '=' && event.key !== '-' && event.key !== '_' && event.key !== '0') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.key === '0') {
      const documentId = getActiveDocumentId(registry);
      const zoom = registry.getPlugin('zoom')?.provides?.() as ZoomCapability | undefined;

      if (documentId && zoom) {
        zoom.forDocument(documentId).requestZoom('fit-page');
      }

      return;
    }

    requestPdfZoom(registry, event.key === '-' || event.key === '_' ? -1 : 1, event);
  };

  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  window.addEventListener('keydown', onKeyDown, { capture: true });

  return () => {
    window.removeEventListener('wheel', onWheel, { capture: true });
    window.removeEventListener('keydown', onKeyDown, { capture: true });
  };
}

function installReadingHistory(registry: PluginRegistry, fileUrl?: string) {
  if (!fileUrl) {
    return () => {};
  }

  const scroll = registry.getPlugin('scroll')?.provides?.() as ScrollCapability | undefined;
  if (!scroll) {
    return () => {};
  }

  let restoredDocumentId: string | null = null;
  let pendingPageNumber = 0;
  let pendingWriteId = 0;

  const flushPendingWrite = () => {
    pendingWriteId = 0;
    writeHistoryEntry(fileUrl, pendingPageNumber);
  };

  const scheduleHistoryWrite = (pageNumber: number) => {
    pendingPageNumber = pageNumber;
    if (pendingWriteId) {
      window.clearTimeout(pendingWriteId);
    }
    pendingWriteId = window.setTimeout(flushPendingWrite, 300);
  };

  const unsubscribePageChange = scroll.onPageChange((event) => {
    scheduleHistoryWrite(event.pageNumber);
  });

  const unsubscribeLayoutReady = scroll.onLayoutReady((event) => {
    if (!event.isInitial || restoredDocumentId === event.documentId) {
      return;
    }

    const saved = readHistoryEntry(fileUrl);
    if (!saved || saved.pageNumber <= 1) {
      restoredDocumentId = event.documentId;
      return;
    }

    restoredDocumentId = event.documentId;
    scroll.forDocument(event.documentId).scrollToPage({
      pageNumber: saved.pageNumber,
      behavior: 'instant',
    });
  });

  window.addEventListener('beforeunload', () => {
    if (pendingWriteId) {
      window.clearTimeout(pendingWriteId);
      flushPendingWrite();
    }

    const documentId = getActiveDocumentId(registry);
    if (!documentId) {
      return;
    }

    writeHistoryEntry(fileUrl, scroll.forDocument(documentId).getCurrentPage());
  });

  return () => {
    if (pendingWriteId) {
      window.clearTimeout(pendingWriteId);
      flushPendingWrite();
    }
    unsubscribePageChange();
    unsubscribeLayoutReady();
  };
}

function App() {
  const fileUrl = getInitialFileUrl();
  const viewerConfig: ViewerConfig = {
    ...(fileUrl ? { src: fileUrl } : {}),
    worker: true,
    tabBar: 'never',
    theme: {
      preference: 'system',
    },
    scroll: {
      defaultBufferSize: 1,
    },
    ui: {
      disabledCategories: ['redaction'],
    },
    commands: {
      disabledCategories: ['redaction'],
    },
  };

  return (
    <main className="app-shell">
      <PDFViewer
        config={viewerConfig as PDFViewerConfig}
        className="viewer"
        onReady={(registry) => {
          installBrowserZoomInterceptor(registry);
          installReadingHistory(registry, fileUrl);
        }}
      />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
