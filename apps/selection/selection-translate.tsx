import { LanguageDetectionDownloadRequired } from '../platform/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import type { SelectionCapability } from '@embedpdf/plugin-selection';
import { FloatingPopover } from '../components';
import { getDocument } from '../document/viewer-document';
import { platform } from '#platform';
import { getPluginCapability, normalizePdfText } from '../shared/utils';
import type { ViewerTranslationRequest } from '../viewer/viewer-controller';
import { detectDocumentLanguage } from './document-language';
import {
  getLanguageName,
  getTranslationSourceLanguage,
  getTranslationTargetLanguage,
} from './translation-settings';
import styles from './selection-translate.module.css';

const MAX_TEXT_LENGTH = 4000;

type TranslationState =
  | { status: 'loading'; progress?: number; detecting?: boolean }
  | { status: 'detection-download'; request: LanguageDetectionDownloadRequired }
  | { status: 'downloadable'; downloading: boolean; sourceLanguage: string; targetLanguage: string }
  | { status: 'success'; text: string }
  | { status: 'error'; text: string };

function normalizeText(parts: string[]) {
  return normalizePdfText(parts.join(' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

export function SelectionTranslate({
  registry,
  request,
  onClose,
}: {
  registry?: PluginRegistry;
  request: ViewerTranslationRequest;
  onClose(): void;
}) {
  const [sourceText, setSourceText] = useState('');
  const [result, setResult] = useState<TranslationState>({ status: 'loading' });
  const activeController = useRef<AbortController | null>(null);

  const translate = useCallback(async (
    text: string,
    allowModelDownload: boolean,
    sourceLanguage?: string,
  ) => {
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setResult({ status: 'loading' });
    try {
      const translation = await platform.translate(text, {
        allowModelDownload,
        signal: controller.signal,
        sourceLanguage,
        targetLanguage: getTranslationTargetLanguage(platform.getPreference),
        onDownloadProgress(progress) {
          if (!controller.signal.aborted) setResult({ status: 'loading', progress });
        },
      });
      if (controller.signal.aborted) return;
      if (translation.type === 'downloadable') {
        setResult({ status: 'downloadable', ...translation });
      } else {
        setResult({ status: 'success', text: translation.text });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof LanguageDetectionDownloadRequired) {
        setResult({ status: 'detection-download', request: error });
        return;
      }
      setResult({
        status: 'error',
        text: error instanceof Error ? error.message : 'Translation failed.',
      });
    }
  }, []);

  useEffect(() => {
    setSourceText('');
    setResult({ status: 'loading' });
    const selection = getPluginCapability<SelectionCapability>(registry, 'selection');
    const scope = selection?.forDocument(request.documentId);
    if (!registry || !selection || !scope) return;

    let cancelled = false;
    const configuredSourceLanguage = getTranslationSourceLanguage(platform.getPreference);
    const document = getDocument(registry, request.documentId)!;
    Promise.all([
      scope.getSelectedText().toPromise().then((parts) => {
        if (!cancelled) setSourceText(normalizeText(parts));
        return parts;
      }),
      configuredSourceLanguage
        ? Promise.resolve(configuredSourceLanguage)
        : detectDocumentLanguage(registry.getEngine(), document)
          .then((result) => result.detectedLanguage),
    ]).then(([parts, sourceLanguage]) => {
      if (cancelled) return;
      const text = normalizeText(parts);
      setSourceText(text);
      void translate(text, false, sourceLanguage);
    }).catch((error) => {
      if (cancelled) return;
      if (error instanceof LanguageDetectionDownloadRequired) {
        setResult({ status: 'detection-download', request: error });
        return;
      }
      setResult({
        status: 'error',
        text: error instanceof Error ? error.message : 'Could not prepare translation.',
      });
    });

    const close = () => onClose();
    window.addEventListener('scroll', close, { capture: true, passive: true });
    const unsubscribeSelectionChange = selection.onSelectionChange((event) => {
      if (!event.selection) close();
    });

    return () => {
      cancelled = true;
      activeController.current?.abort();
      activeController.current = null;
      window.removeEventListener('scroll', close, { capture: true });
      unsubscribeSelectionChange();
    };
  }, [onClose, registry, request, translate]);

  const resumeDetection = async (download: LanguageDetectionDownloadRequired) => {
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setResult({ status: 'loading', detecting: true });
    try {
      const detection = await download.resume();
      if (!controller.signal.aborted) {
        // Detection may outlast user activation. Translation gets its own button if needed.
        void translate(sourceText, false, detection.detectedLanguage);
      }
    } catch (error) {
      if (!controller.signal.aborted) setResult({ status: 'error', text: error instanceof Error ? error.message : 'Language detection failed.' });
    }
  };

  const downloadable = result.status === 'downloadable' || result.status === 'detection-download';
  const message = (() => {
    if (result.status === 'success' || result.status === 'error') return result.text;
    if (result.status === 'detection-download') return result.request.downloading
      ? 'Language detection model is downloading. Click to continue.'
      : 'Download the language detection model to translate. Click to download.';
    if (result.status === 'downloadable') {
      const direction = `${getLanguageName(result.sourceLanguage)} → ${getLanguageName(result.targetLanguage)}`;
      return result.downloading
        ? `${direction}\nModel download is in progress. Click to continue.`
        : `${direction}\nDownload this language model to translate. Click to download.`;
    }
    if (result.detecting) return 'Preparing the language detection model...';
    if (typeof result.progress === 'number') {
      return result.progress >= 1
        ? 'Preparing the built-in translation model...'
        : `Downloading the built-in translation model... ${Math.round(result.progress * 100)}%`;
    }
    return 'Translating...';
  })();

  return (
    <FloatingPopover
      onClose={onClose}
      anchor={request.anchor}
      sideOffset={10}
      className={`pdf-glass-surface pdf-glass-popover ${styles.panel} ${result.status === 'error' ? 'text-danger' : ''} ${downloadable ? styles.downloadable : ''}`.trim()}
      label="Translation"
      role={downloadable ? 'dialog' : 'status'}
    >
      {downloadable ? (
        <button
          className={styles.downloadAction}
          type="button"
          onClick={() => {
            if (result.status === 'detection-download') void resumeDetection(result.request);
            else if (result.status === 'downloadable') void translate(sourceText, true, result.sourceLanguage);
          }}
          disabled={!sourceText}
        >
          {message}
        </button>
      ) : message}
    </FloatingPopover>
  );
}
