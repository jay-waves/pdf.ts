import { createStore } from 'zustand/vanilla';

export type RenderDprMode = 'auto' | '1.25' | '1.5' | '1.75' | 'system';

const AUTO_DPR_LIMIT = 1.75;
export const PDF_TILE_SIZE_CSS_PX = 768;
const systemDpr = window.devicePixelRatio || 1;

export function getSystemDpr() {
  return systemDpr;
}

export function getEffectiveRenderDpr(
  mode = viewerDiagnosticsStore.getState().renderDprMode,
) {
  if (mode === 'auto') return Math.min(systemDpr, AUTO_DPR_LIMIT);
  if (mode === 'system') return systemDpr;
  return Number(mode);
}

export function setRenderDprMode(mode: RenderDprMode) {
  viewerDiagnosticsStore.setState((state) => ({
    ...EMPTY_SNAPSHOT,
    renderDprMode: mode,
    errors: state.errors,
  }));
}

export function installRenderDprOverride() {
  const ownDescriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  try {
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      get: getEffectiveRenderDpr,
    });
  } catch {
    return () => undefined;
  }

  return () => {
    try {
      if (ownDescriptor) Object.defineProperty(window, 'devicePixelRatio', ownDescriptor);
      else Reflect.deleteProperty(window, 'devicePixelRatio');
    } catch {
      // Keeping the render-only override is safer than failing viewer cleanup.
    }
  };
}

type TimingStats = {
  count: number;
  last: number;
  average: number;
};

type ViewerDiagnosticsSnapshot = {
  renderDprMode: RenderDprMode;
  basePixels: number;
  tilePixels: number;
  activeTiles: number;
  baseTiming: TimingStats;
  tileTiming: TimingStats;
  errors: string[];
};

const EMPTY_TIMING: TimingStats = { count: 0, last: 0, average: 0 };
const EMPTY_SNAPSHOT: ViewerDiagnosticsSnapshot = {
  renderDprMode: 'auto',
  basePixels: 0,
  tilePixels: 0,
  activeTiles: 0,
  baseTiming: EMPTY_TIMING,
  tileTiming: EMPTY_TIMING,
  errors: [],
};

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

function appendTiming(current: TimingStats, duration: number): TimingStats {
  const count = current.count + 1;
  return {
    count,
    last: duration,
    average: current.average + (duration - current.average) / count,
  };
}

export const viewerDiagnosticsStore = createStore<ViewerDiagnosticsSnapshot>(() => EMPTY_SNAPSHOT);

export function recordRenderTiming(kind: 'base' | 'tile', duration: number) {
  viewerDiagnosticsStore.setState((state) => kind === 'base'
    ? { baseTiming: appendTiming(state.baseTiming, duration) }
    : { tileTiming: appendTiming(state.tileTiming, duration) });
}

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
    renderDprMode: state.renderDprMode,
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
  const images = (selector: string) => [...root.querySelectorAll<HTMLImageElement>(selector)];
  const pixels = (items: HTMLImageElement[]) => items
    .reduce((total, image) => total + image.naturalWidth * image.naturalHeight, 0);
  const baseImages = images('.pdf-page-render-image');
  const tileImages = images('.pdf-page-tiling-layer img');
  const basePixels = pixels(baseImages);
  const tilePixels = pixels(tileImages);
  const activeTiles = tileImages.length;
  const current = viewerDiagnosticsStore.getState();
  if (basePixels !== current.basePixels
    || tilePixels !== current.tilePixels
    || activeTiles !== current.activeTiles) {
    viewerDiagnosticsStore.setState({ basePixels, tilePixels, activeTiles });
  }
}
