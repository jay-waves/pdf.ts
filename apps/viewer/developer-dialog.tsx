import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { PluginRegistry } from '@embedpdf/core';
import type { PdfMetadataObject } from '@embedpdf/models';
import { Dialog, PanelContent, Select } from '../components';
import { getDocument } from '../document/viewer-document';
import { getErrorMessage } from '../shared/utils';
import {
  sampleRasterPixels,
  viewerDiagnosticsStore,
} from '../renderer/viewer-diagnostics';
import {
  getEffectiveRenderDpr,
  getSystemDpr,
  PDF_TILE_SIZE_CSS_PX,
  renderSettingsStore,
  setRenderDprMode,
  type RenderDprMode,
} from '../renderer/render-settings';
import {
  describeFallbackFont,
  describeFontCharset,
  PDFIUM_FONT_FALLBACK_INFO,
  type PdfFontDiagnostic,
} from '../fonts';
import type { PdfRuntime } from '../renderer/pdf-engine';
import type { PlatformLanguageDetectionResult } from '../platform/types';
import { formatStartupDiagnostics, startupLogStore } from './startup-log';
import { LlmSettings } from './llm-settings';
import { TranslatorSettings } from './translator-settings';
import styles from './developer-dialog.module.css';


const DPR_OPTIONS: Array<{ value: RenderDprMode; label: string }> = [
  { value: 'auto', label: 'Auto (max 1.75x)' },
  { value: '1.25', label: 'Performance (1.25x)' },
  { value: '1.5', label: 'Balanced (1.5x)' },
  { value: '1.75', label: 'Quality (1.75x)' },
  { value: 'system', label: 'System (native)' },
];

function formatPixels(value: number) {
  return value ? `${(value / 1_000_000).toFixed(2)} MP` : '—';
}

function formatBytes(value: number) {
  return value ? `${(value / 1024 / 1024).toFixed(1)} MB` : '—';
}

function formatDpr(value: number) {
  return `${Number(value.toFixed(2))}x`;
}

function formatTiming({ count, last, average }: {
  count: number;
  last: number;
  average: number;
}) {
  return count ? `${last.toFixed(1)} / ${average.toFixed(1)} ms` : '—';
}

function formatMetadataDate(value: Date | null) {
  if (!value || Number.isNaN(value.getTime())) return 'Not provided';
  return `${new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  }).format(value)} UTC`;
}

export function DeveloperDialog({
  detectedDocumentLanguage,
  registry,
  documentId,
  fileName,
  pageCount,
  open,
  pdfium,
  onClose,
}: {
  detectedDocumentLanguage?: PlatformLanguageDetectionResult;
  registry?: PluginRegistry;
  documentId?: string | null;
  fileName?: string;
  pageCount: number;
  open: boolean;
  pdfium: PdfRuntime;
  onClose(): void;
}) {
  const [fontDiagnostics, setFontDiagnostics] = useState<PdfFontDiagnostic[]>([]);
  const [metadata, setMetadata] = useState<PdfMetadataObject | null>(null);
  const [metadataError, setMetadataError] = useState('');
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [page, setPage] = useState<'pdf' | 'llm'>('pdf');
  const [llmAvailability, setLlmAvailability] = useState({ available: false });
  const updateLlmAvailability = useCallback((available: boolean) => setLlmAvailability({ available }), []);
  const loggedOpenRef = useRef(false);
  const snapshot = useStore(viewerDiagnosticsStore);
  const renderSettings = useStore(renderSettingsStore);
  const startupSnapshot = useStore(startupLogStore);
  const dprMode = renderSettings.dprMode;
  const dpr = getEffectiveRenderDpr(dprMode, renderSettings.systemDpr);
  const totalPixels = snapshot.basePixels + snapshot.tilePixels;
  useEffect(() => {
    if (!open) return;
    let active = true;
    const sample = () => {
      sampleRasterPixels();
      void pdfium.getFontDiagnostics().then((diagnostics) => {
        if (active) setFontDiagnostics(diagnostics);
      });
    };
    sample();
    const timer = window.setInterval(sample, 500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [open, pdfium]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const document = getDocument(registry, documentId);
    const engine = registry?.getEngine();

    setMetadata(null);
    setMetadataError('');
    setMetadataLoading(false);
    if (!document || !engine) {
      setMetadataError('Document metadata is not available.');
      return;
    }

    setMetadataLoading(true);
    void engine.getMetadata(document).toPromise().then((nextMetadata) => {
      if (!cancelled) setMetadata(nextMetadata);
    }).catch((error: unknown) => {
      if (!cancelled) setMetadataError(getErrorMessage(error, 'Failed to read document metadata.'));
    }).finally(() => {
      if (!cancelled) setMetadataLoading(false);
    });
    return () => { cancelled = true; };
  }, [documentId, open, registry]);

  const fontRequestDetails = fontDiagnostics.length
    ? fontDiagnostics.map((font) => {
        const status = [
          font.selectedFamily,
          font.status,
          font.bytes ? `${(font.bytes / 1024 / 1024).toFixed(1)} MB` : '',
          font.httpStatus ? `HTTP ${font.httpStatus}` : '',
        ].filter(Boolean).join(', ');
        return [
          `- ${font.face}: ${describeFontCharset(font.charset)}, requested ${font.family}`,
          `${font.weight}${font.italic ? ' italic' : ''}`,
          `→ ${describeFallbackFont(font.url)} (${status})`,
          font.error ? `\n  Error: ${font.error}` : '',
          `\n  ${font.url}`,
        ].join(' ');
      }).join('\n')
    : '- No PDFium fallback request recorded for this document.';

  const details = [
    `PDF.ts version: ${__PDF_TS_BUILD_INFO__}.`,
    `PDF pages render at ${dpr}x DPR; the system DPR is ${getSystemDpr()}x.`,
    `Fallback catalog: ${PDFIUM_FONT_FALLBACK_INFO.family} (${PDFIUM_FONT_FALLBACK_INFO.coverage}).`,
    `Font source: ${PDFIUM_FONT_FALLBACK_INFO.source}.`,
    `Font cache: ${PDFIUM_FONT_FALLBACK_INFO.cache}.`,
    `PDFium fallback requests:\n${fontRequestDetails}`,
    `Base raster uses ${formatPixels(snapshot.basePixels)} and active tiles use ${formatPixels(snapshot.tilePixels)}.`,
    `${snapshot.activeTiles} tile images are currently attached to mounted PDF pages.`,
    `Estimated RGBA raster memory is ${formatBytes(totalPixels * 4)}.`,
    `Base render last / average: ${formatTiming(snapshot.baseTiming)} across ${snapshot.baseTiming.count} completed tasks.`,
    `Tile render last / average: ${formatTiming(snapshot.tileTiming)} across ${snapshot.tileTiming.count} completed tasks.`,
    'Timing is end-to-end task latency; averages cover completed tasks since the last rendering reset.',
    'Raster memory is an estimate and excludes PDFium WASM and GPU copies.',
    formatStartupDiagnostics(startupSnapshot),
    snapshot.errors.length
      ? `Recent errors (latest ${snapshot.errors.length}):\n${snapshot.errors.join('\n\n')}`
      : 'Recent errors: none recorded.',
  ].join('\n');

  useEffect(() => {
    if (!open) {
      loggedOpenRef.current = false;
      return;
    }
    if (loggedOpenRef.current) return;
    loggedOpenRef.current = true;
    console.info(`[pdf-ts] Developer diagnostics\n${details}`);
  }, [details, open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Developer"
      titleVariant="hidden"
      variant="flatPanel"
      contentClassName={styles.dialog}
      overlayClassName={styles.overlay}
    >
      <PanelContent className={styles.content}>
        <div className={styles.breadcrumbs}>
          <span className={styles.dialogTitle}>Developer</span>
          <span className={styles.pageToggle} role="group" aria-label="Settings page">
            <button type="button" aria-pressed={page === 'pdf'} onClick={() => setPage('pdf')}>PDF</button>
            <button type="button" aria-pressed={page === 'llm'} onClick={() => setPage('llm')}>LLM</button>
          </span>
        </div>
        <div hidden={page !== 'pdf'} className={styles.pdfPage}>
        <section className={styles.section} aria-labelledby="developer-statistics">
          <h2 id="developer-statistics" className={styles.sectionTitle}>PDF rendering</h2>
          <dl className={styles.stats}>
            <div><dt>Effective DPR</dt><dd><span>{formatDpr(dpr)}</span></dd></div>
            <div><dt>Raster pixels</dt><dd><span>{formatPixels(totalPixels)}</span></dd></div>
            <div><dt>Active tiles</dt><dd><span>{snapshot.activeTiles}</span></dd></div>
            <div><dt>Raster memory</dt><dd><span>{formatBytes(totalPixels * 4)}</span></dd></div>
            <div><dt>Base last / avg</dt><dd><span>{formatTiming(snapshot.baseTiming)}</span></dd></div>
            <div><dt>Tiles last / avg</dt><dd><span>{formatTiming(snapshot.tileTiming)}</span></dd></div>
          </dl>
          <div className={styles.control}>
            <span>Device Pixel Ratio (DPR)</span>
            <Select
              className={styles.select}
              contentClassName={styles.selectContent}
              value={dprMode}
              options={DPR_OPTIONS}
              label="Device Pixel Ratio"
              onValueChange={(value) => setRenderDprMode(value as RenderDprMode)}
            />
          </div>
          <p className={styles.hint}>
            DPR profiles adjust tile raster scale; tile edges follow a fixed {PDF_TILE_SIZE_CSS_PX} CSS px × DPR ratio.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="developer-metadata">
          <h2 id="developer-metadata" className={styles.sectionTitle}>Metadata</h2>
          {metadataLoading ? <p className={styles.metadataStatus}>Loading metadata…</p> : null}
          {metadataError ? <p className={styles.metadataError} role="alert">{metadataError}</p> : null}
          <dl className={styles.metadata}>
            <div className={styles.metadataTitle}>
              <dt>Title</dt>
              <dd>{fileName || 'Not provided'}</dd>
            </div>
            {metadata ? [
                ['Pages', String(pageCount)],
                ['Author', metadata.author],
                ['Creator', metadata.creator],
                ['Producer', metadata.producer],
                ['Created', formatMetadataDate(metadata.creationDate)],
                ['Modified', formatMetadataDate(metadata.modificationDate)],
              ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd><span>{value || 'Not provided'}</span></dd>
              </div>
            )) : null}
          </dl>
        </section>

        {open && <TranslatorSettings detectedLanguage={detectedDocumentLanguage} llmAvailability={llmAvailability} />}
        </div>
        {open && <div hidden={page !== 'llm'}><LlmSettings onAvailabilityChange={updateLlmAvailability} /></div>}
      </PanelContent>
    </Dialog>
  );
}
