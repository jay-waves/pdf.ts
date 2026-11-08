import { createStore } from 'zustand/vanilla';

type ViewerDiagnosticsSnapshot = { rasterPixels: number; rasterImages: number; errors: string[] };
const EMPTY_SNAPSHOT: ViewerDiagnosticsSnapshot = { rasterPixels: 0, rasterImages: 0, errors: [] };

const MAX_ERROR_EXCERPTS = 5;
const MAX_ERROR_LENGTH = 800;

function describeError(value: unknown) {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const viewerDiagnosticsStore = createStore<ViewerDiagnosticsSnapshot>(() => EMPTY_SNAPSHOT);

export function recordViewerError(value: unknown) {
  const description = describeError(value).trim();
  if (!description) return;
  const excerpt = description.length > MAX_ERROR_LENGTH
    ? `${description.slice(0, MAX_ERROR_LENGTH)}…`
    : description;
  const entry = `[${new Date().toLocaleTimeString()}] ${excerpt}`;
  viewerDiagnosticsStore.setState((state) => ({
    errors: [...state.errors, entry].slice(-MAX_ERROR_EXCERPTS),
  }));
}

export function resetViewerDiagnostics() {
  viewerDiagnosticsStore.setState((state) => ({
    ...EMPTY_SNAPSHOT,
    errors: state.errors,
  }));
}

export function installErrorDiagnostics() {
  const originalConsoleError = console.error;
  const onError = (event: ErrorEvent) => {
    recordViewerError(event.error ?? event.message);
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    recordViewerError(event.reason);
  };
  const captureConsoleError = (...values: unknown[]) => {
    originalConsoleError.apply(console, values);
    recordViewerError(values.map(describeError).join(' '));
  };
  console.error = captureConsoleError;
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  return () => {
    if (console.error === captureConsoleError) console.error = originalConsoleError;
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
  };
}

export function sampleRasterPixels(root: ParentNode = document) {
  const images = [...root.querySelectorAll<HTMLImageElement>('.pdf-native-render-layer img')];
  const rasterPixels = images.reduce((total, image) => total + image.naturalWidth * image.naturalHeight, 0);
  const rasterImages = images.length;
  const current = viewerDiagnosticsStore.getState();
  if (rasterPixels !== current.rasterPixels || rasterImages !== current.rasterImages) {
    viewerDiagnosticsStore.setState({ rasterPixels, rasterImages });
  }
}
