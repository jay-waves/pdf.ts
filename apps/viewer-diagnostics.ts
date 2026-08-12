export type RenderDprMode = 'auto' | '1.25' | '1.5' | '1.75' | 'system';

const AUTO_DPR_LIMIT = 1.75;
export const PDF_TILE_SIZE_CSS_PX = 768;
const systemDpr = window.devicePixelRatio || 1;
let renderDprMode: RenderDprMode = 'auto';

export function getSystemDpr() {
  return systemDpr;
}

export function getRenderDprMode() {
  return renderDprMode;
}

export function getEffectiveRenderDpr(mode = renderDprMode) {
  if (mode === 'auto') return Math.min(systemDpr, AUTO_DPR_LIMIT);
  if (mode === 'system') return systemDpr;
  return Number(mode);
}

export function setRenderDprMode(mode: RenderDprMode) {
  renderDprMode = mode;
  viewerDiagnostics.resetRendering();
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
  basePixels: number;
  tilePixels: number;
  activeTiles: number;
  baseTiming: TimingStats;
  tileTiming: TimingStats;
  errors: string[];
};

const EMPTY_TIMING: TimingStats = { count: 0, last: 0, average: 0 };
const EMPTY_SNAPSHOT: ViewerDiagnosticsSnapshot = {
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

class ViewerDiagnosticsStore {
  private snapshot = EMPTY_SNAPSHOT;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private update(patch: Partial<ViewerDiagnosticsSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  record(kind: 'base' | 'tile', duration: number) {
    this.update(kind === 'base'
      ? { baseTiming: appendTiming(this.snapshot.baseTiming, duration) }
      : { tileTiming: appendTiming(this.snapshot.tileTiming, duration) });
  }

  recordError(value: unknown) {
    const description = describeError(value).trim();
    if (!description) return;
    const excerpt = description.length > MAX_ERROR_LENGTH
      ? `${description.slice(0, MAX_ERROR_LENGTH)}…`
      : description;
    const entry = `[${new Date().toLocaleTimeString()}] ${excerpt}`;
    this.update({ errors: [...this.snapshot.errors, entry].slice(-MAX_ERROR_EXCERPTS) });
  }

  setRasterPixels(basePixels: number, tilePixels: number, activeTiles: number) {
    if (basePixels === this.snapshot.basePixels
      && tilePixels === this.snapshot.tilePixels
      && activeTiles === this.snapshot.activeTiles) return;
    this.update({ basePixels, tilePixels, activeTiles });
  }

  resetRendering() {
    this.snapshot = { ...EMPTY_SNAPSHOT, errors: this.snapshot.errors };
    this.listeners.forEach((listener) => listener());
  }
}

export const viewerDiagnostics = new ViewerDiagnosticsStore();

export function installErrorDiagnostics() {
  const originalConsoleError = console.error;
  const onError = (event: ErrorEvent) => {
    viewerDiagnostics.recordError(event.error ?? event.message);
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    viewerDiagnostics.recordError(event.reason);
  };
  const captureConsoleError = (...values: unknown[]) => {
    originalConsoleError.apply(console, values);
    viewerDiagnostics.recordError(values.map(describeError).join(' '));
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
  const images = (selector: string) => Array.from(root.querySelectorAll<HTMLImageElement>(selector));
  const pixels = (items: HTMLImageElement[]) => items
    .reduce((total, image) => total + image.naturalWidth * image.naturalHeight, 0);
  const baseImages = images('.pdf-page-render-image');
  const tileImages = images('.pdf-page-tiling-layer img');
  viewerDiagnostics.setRasterPixels(
    pixels(baseImages),
    pixels(tileImages),
    tileImages.length,
  );
}
