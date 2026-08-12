import { useEffect, useSyncExternalStore } from 'react';
import { Dialog, PanelContent, Select } from './components';
import {
  getEffectiveRenderDpr,
  getSystemDpr,
  PDF_TILE_SIZE_CSS_PX,
  sampleRasterPixels,
  viewerDiagnostics,
  type RenderDprMode,
} from './viewer-diagnostics';
import { viewerActivity } from './viewer-activity';
import styles from './developer-dialog.module.css';

const NO_SUBSCRIBE = () => () => undefined;

const DPR_OPTIONS: Array<{ value: RenderDprMode; label: string }> = [
  { value: 'auto', label: 'Auto (max 1.75x)' },
  { value: '1.25', label: 'Performance (1.25x)' },
  { value: '1.5', label: 'Balanced (1.5x)' },
  { value: '1.75', label: 'Quality (1.75x)' },
  { value: 'system', label: `System (${getSystemDpr()}x, native)` },
];

function formatPixels(value: number) {
  return value ? `${(value / 1_000_000).toFixed(2)} MP` : '—';
}

function formatBytes(value: number) {
  return value ? `${(value / 1024 / 1024).toFixed(1)} MB` : '—';
}

function formatTiming({ count, last, average }: {
  count: number;
  last: number;
  average: number;
}) {
  return count ? `${last.toFixed(1)} / ${average.toFixed(1)} ms` : '—';
}

export function DeveloperDialog({
  open,
  dprMode,
  onDprModeChange,
  onClose,
}: {
  open: boolean;
  dprMode: RenderDprMode;
  onDprModeChange(mode: RenderDprMode): void;
  onClose(): void;
}) {
  const snapshot = useSyncExternalStore(
    open ? viewerDiagnostics.subscribe : NO_SUBSCRIBE,
    viewerDiagnostics.getSnapshot,
  );
  const activity = useSyncExternalStore(
    open ? viewerActivity.subscribe : NO_SUBSCRIBE,
    viewerActivity.getSnapshot,
  );
  const dpr = getEffectiveRenderDpr(dprMode);
  const totalPixels = snapshot.basePixels + snapshot.tilePixels;

  useEffect(() => {
    if (!open) return;
    sampleRasterPixels();
    const timer = window.setInterval(sampleRasterPixels, 500);
    return () => window.clearInterval(timer);
  }, [open]);

  const details = [
    `PDF.ts version: ${__PDF_TS_BUILD_INFO__}.`,
    `PDF pages render at ${dpr}x DPR; the system DPR is ${getSystemDpr()}x.`,
    `Base raster uses ${formatPixels(snapshot.basePixels)} and active tiles use ${formatPixels(snapshot.tilePixels)}.`,
    `${snapshot.activeTiles} tile images are currently attached to mounted PDF pages.`,
    `Estimated RGBA raster memory is ${formatBytes(totalPixels * 4)}.`,
    `Base render last / average: ${formatTiming(snapshot.baseTiming)} across ${snapshot.baseTiming.count} completed tasks.`,
    `Tile render last / average: ${formatTiming(snapshot.tileTiming)} across ${snapshot.tileTiming.count} completed tasks.`,
    'Timing is end-to-end task latency; averages cover completed tasks since the last rendering reset.',
    'Raster memory is an estimate and excludes PDFium WASM and GPU copies.',
    snapshot.errors.length
      ? `Recent errors (latest ${snapshot.errors.length}):\n${snapshot.errors.join('\n\n')}`
      : 'Recent errors: none recorded.',
  ].join('\n');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Developer"
      titleVariant="popup"
      contentClassName={styles.dialog}
    >
      <PanelContent className={styles.content}>
        <section className={styles.section} aria-labelledby="developer-statistics">
          <h2 id="developer-statistics" className={styles.sectionTitle}>PDF rendering</h2>
          <dl className={styles.stats}>
            <div><dt>Effective DPR</dt><dd>{dpr}x</dd></div>
            <div><dt>Raster pixels</dt><dd>{formatPixels(totalPixels)}</dd></div>
            <div><dt>Active tiles</dt><dd>{snapshot.activeTiles}</dd></div>
            <div><dt>Raster memory</dt><dd>{formatBytes(totalPixels * 4)}</dd></div>
            <div><dt>Base last / avg</dt><dd>{formatTiming(snapshot.baseTiming)}</dd></div>
            <div><dt>Tiles last / avg</dt><dd>{formatTiming(snapshot.tileTiming)}</dd></div>
            <div><dt>Activity</dt><dd>{activity.label}</dd></div>
          </dl>
        </section>

        <section className={styles.section} aria-labelledby="developer-controls">
          <h2 id="developer-controls" className={styles.sectionTitle}>Viewer controls</h2>
          <div className={styles.control}>
            <span>Device Pixel Ratio (DPR)</span>
            <Select
              className={styles.select}
              value={dprMode}
              options={DPR_OPTIONS}
              label="Device Pixel Ratio"
              onValueChange={(value) => onDprModeChange(value as RenderDprMode)}
            />
          </div>
          <p className={styles.hint}>
            DPR profiles adjust tile raster scale; tile edges follow a fixed {PDF_TILE_SIZE_CSS_PX} CSS px × DPR ratio.
          </p>
        </section>

        <label className={styles.detailsLabel}>
          <span>Details</span>
          <textarea className={styles.details} value={details} readOnly />
        </label>
      </PanelContent>
    </Dialog>
  );
}
