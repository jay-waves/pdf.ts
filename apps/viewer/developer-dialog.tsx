import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { Dialog, PanelContent, Select } from '../components';
import {
  getEffectiveRenderDpr,
  getSystemDpr,
  PDF_TILE_SIZE_CSS_PX,
  sampleRasterPixels,
  setRenderDprMode,
  viewerDiagnosticsStore,
  type RenderDprMode,
} from '../renderer/viewer-diagnostics';
import {
  describeFallbackFont,
  describeFontCharset,
  PDFIUM_FONT_FALLBACK_INFO,
  type PdfFontDiagnostic,
} from '../fonts';
import type { PdfRuntime } from '../renderer/pdf-engine';
import type { PlatformLanguageDetectionResult } from '../platform/types';
import { formatStartupDiagnostics, startupLogStore } from './startup-log';
import { platform } from '#platform';
import {
  getBrowserTranslationLanguage,
  getConfiguredTranslationTargetLanguage,
  getTranslationSourceLanguage,
  getTranslationTargetLanguage,
  normalizeTranslationLanguage,
  TRANSLATION_SOURCE_LANGUAGE_PREFERENCE,
  TRANSLATION_TARGET_LANGUAGE_PREFERENCE,
} from '../selection/translation-settings';
import styles from './developer-dialog.module.css';


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
  detectedDocumentLanguage,
  open,
  pdfium,
  onClose,
}: {
  detectedDocumentLanguage?: PlatformLanguageDetectionResult;
  open: boolean;
  pdfium: PdfRuntime;
  onClose(): void;
}) {
  const [fontDiagnostics, setFontDiagnostics] = useState<PdfFontDiagnostic[]>([]);
  const [translationTargetLanguage, setTranslationTargetLanguage] = useState(
    () => getConfiguredTranslationTargetLanguage(platform.getPreference) ?? '',
  );
  const [translationSourceLanguage, setTranslationSourceLanguage] = useState(
    () => getTranslationSourceLanguage(platform.getPreference) ?? '',
  );
  const [translationLanguageError, setTranslationLanguageError] = useState('');
  const [translationSourceLanguageError, setTranslationSourceLanguageError] = useState('');
  const snapshot = useStore(viewerDiagnosticsStore);
  const startupSnapshot = useStore(startupLogStore);
  const dprMode = snapshot.renderDprMode;
  const dpr = getEffectiveRenderDpr(dprMode);
  const totalPixels = snapshot.basePixels + snapshot.tilePixels;
  const translationSourcePlaceholder = detectedDocumentLanguage
    ? `Auto (${detectedDocumentLanguage.detectedLanguage}${
      detectedDocumentLanguage.confidence === undefined
        ? ''
        : `, ${Math.round(detectedDocumentLanguage.confidence * 100)}% confidence`
    })`
    : 'Auto (detecting document language)';

  useEffect(() => {
    if (!open) return;
    setTranslationSourceLanguage(getTranslationSourceLanguage(platform.getPreference) ?? '');
    setTranslationTargetLanguage(getConfiguredTranslationTargetLanguage(platform.getPreference) ?? '');
    setTranslationLanguageError('');
    setTranslationSourceLanguageError('');
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

  const saveTranslationSourceLanguage = async () => {
    const configured = translationSourceLanguage.trim();
    if (!configured) {
      platform.setPreference(TRANSLATION_SOURCE_LANGUAGE_PREFERENCE, '');
      setTranslationSourceLanguage('');
      setTranslationSourceLanguageError('');
      return;
    }
    try {
      const language = normalizeTranslationLanguage(configured);
      const targetLanguage = getTranslationTargetLanguage(platform.getPreference);
      const availability = await platform.getTranslationAvailability(language, targetLanguage);
      if (availability === 'unavailable') {
        throw new Error(`Translation from ${language} to ${targetLanguage} is not supported.`);
      }
      platform.setPreference(TRANSLATION_SOURCE_LANGUAGE_PREFERENCE, language);
      setTranslationSourceLanguage(language);
      setTranslationSourceLanguageError('');
    } catch (error) {
      setTranslationSourceLanguage(getTranslationSourceLanguage(platform.getPreference) ?? '');
      setTranslationSourceLanguageError(
        error instanceof Error ? error.message : 'Invalid language tag.',
      );
    }
  };

  const saveTranslationTargetLanguage = async () => {
    const configured = translationTargetLanguage.trim();
    if (!configured) {
      platform.setPreference(TRANSLATION_TARGET_LANGUAGE_PREFERENCE, '');
      setTranslationTargetLanguage('');
      setTranslationLanguageError('');
      return;
    }
    try {
      const language = normalizeTranslationLanguage(configured);
      const browserLanguage = getBrowserTranslationLanguage();
      const sourceLanguage = getTranslationSourceLanguage(platform.getPreference)
        ?? detectedDocumentLanguage?.detectedLanguage;
      if (sourceLanguage) {
        const availability = await platform.getTranslationAvailability(sourceLanguage, language);
        if (availability === 'unavailable') {
          throw new Error(`Translation from ${sourceLanguage} to ${language} is not supported.`);
        }
      }
      const override = language === browserLanguage ? '' : language;
      platform.setPreference(TRANSLATION_TARGET_LANGUAGE_PREFERENCE, override);
      setTranslationTargetLanguage(override);
      setTranslationLanguageError('');
    } catch (error) {
      setTranslationTargetLanguage(
        getConfiguredTranslationTargetLanguage(platform.getPreference) ?? '',
      );
      setTranslationLanguageError(error instanceof Error ? error.message : 'Invalid language tag.');
    }
  };

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

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Developer"
      titleVariant="popup"
      contentClassName={styles.dialog}
      overlayClassName={styles.overlay}
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
          </dl>
        </section>

        <section className={styles.section} aria-labelledby="developer-controls">
          <h2 id="developer-controls" className={styles.sectionTitle}>Viewer controls</h2>
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
          <div className={styles.control}>
            <label htmlFor="translation-source-language">Translation source language</label>
            <input
              id="translation-source-language"
              className={styles.input}
              value={translationSourceLanguage}
              placeholder={translationSourcePlaceholder}
              spellCheck={false}
              onBlur={() => void saveTranslationSourceLanguage()}
              onChange={(event) => {
                const value = event.target.value;
                setTranslationSourceLanguage(value);
                if (!value.trim()) {
                  setTranslationSourceLanguageError('');
                  return;
                }
                try {
                  normalizeTranslationLanguage(value);
                  setTranslationSourceLanguageError('');
                } catch (error) {
                  setTranslationSourceLanguageError(
                    error instanceof Error ? error.message : 'Invalid language tag.',
                  );
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
          </div>
          {translationSourceLanguageError ? (
            <p className={`${styles.hint} text-danger`}>{translationSourceLanguageError}</p>
          ) : null}
          <div className={styles.control}>
            <label htmlFor="translation-target-language">Translation target language</label>
            <input
              id="translation-target-language"
              className={styles.input}
              value={translationTargetLanguage}
              placeholder={`Auto (browser ${getBrowserTranslationLanguage()})`}
              spellCheck={false}
              onBlur={() => void saveTranslationTargetLanguage()}
              onChange={(event) => {
                const value = event.target.value;
                setTranslationTargetLanguage(value);
                if (!value.trim()) {
                  setTranslationLanguageError('');
                  return;
                }
                try {
                  normalizeTranslationLanguage(value);
                  setTranslationLanguageError('');
                } catch (error) {
                  setTranslationLanguageError(
                    error instanceof Error ? error.message : 'Invalid language tag.',
                  );
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
          </div>
          {translationLanguageError ? (
            <p className={`${styles.hint} text-danger`}>{translationLanguageError}</p>
          ) : null}
          <p className={styles.hint}>
            DPR profiles adjust tile raster scale; tile edges follow a fixed {PDF_TILE_SIZE_CSS_PX} CSS px × DPR ratio.
          </p>
        </section>

        <textarea aria-label="Details" className={styles.details} value={details} readOnly />
      </PanelContent>
    </Dialog>
  );
}
