import { createStore } from 'zustand/vanilla';
import { platform } from '#platform';

export type RenderDprMode = 'auto' | '1.25' | '1.5' | '1.75' | 'system';

const AUTO_DPR_LIMIT = 1.75;
const RENDER_DPR_STORAGE_KEY = 'pdf-viewer-render-dpr-v1';
export const PDF_TILE_SIZE_CSS_PX = 768;

function getStoredRenderDprMode(): RenderDprMode {
  const mode = platform.getPreference(RENDER_DPR_STORAGE_KEY);
  return mode === '1.25' || mode === '1.5' || mode === '1.75' || mode === 'system'
    ? mode
    : 'auto';
}

export function getSystemDpr() {
  return window.devicePixelRatio || 1;
}

export function getEffectiveRenderDpr(
  mode = viewerDiagnosticsStore.getState().renderDprMode,
  systemDpr = getSystemDpr(),
) {
  if (mode === 'auto') return Math.min(systemDpr, AUTO_DPR_LIMIT);
  if (mode === 'system') return systemDpr;
  return Number(mode);
}

export function setRenderDprMode(mode: RenderDprMode) {
  platform.setPreference(RENDER_DPR_STORAGE_KEY, mode);
  viewerDiagnosticsStore.setState((state) => ({
    ...EMPTY_SNAPSHOT,
    systemDpr: getSystemDpr(),
    renderDprMode: mode,
    errors: state.errors,
  }));
}

export function installRenderDprMonitor() {
  let query: MediaQueryList;
  const update = () => {
    query?.removeEventListener('change', update);
    const systemDpr = getSystemDpr();
    viewerDiagnosticsStore.setState({ systemDpr });
    query = window.matchMedia(`(resolution: ${systemDpr}dppx)`);
    query.addEventListener('change', update);
  };
  update();
  return () => query.removeEventListener('change', update);
}

type TimingStats = {
  count: number;
  last: number;
  average: number;
};

type ViewerDiagnosticsSnapshot = {
  systemDpr: number;
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
  systemDpr: getSystemDpr(),
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

export const viewerDiagnosticsStore = createStore<ViewerDiagnosticsSnapshot>(() => ({
  ...EMPTY_SNAPSHOT,
  renderDprMode: getStoredRenderDprMode(),
}));

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
    systemDpr: getSystemDpr(),
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
