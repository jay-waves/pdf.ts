import { useCallback, useEffect, useRef, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import type { SelectionCapability } from '@embedpdf/plugin-selection';
import { FloatingPopover } from '../components';
import { platform } from '#platform';
import { getPluginCapability, normalizePdfText } from '../shared/utils';
import type { ViewerTranslationRequest } from '../viewer/viewer-controller';
import {
  getLanguageName,
  getTranslationTargetLanguage,
} from './translation-settings';
import styles from './selection-translate.module.css';

const MAX_TEXT_LENGTH = 4000;

type TranslationState =
  | { status: 'loading'; progress?: number }
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
    if (!selection || !scope) return;

    let cancelled = false;
    scope.getSelectedText().toPromise().then((parts) => {
      if (cancelled) return;
      const text = normalizeText(parts);
      setSourceText(text);
      void translate(text, false);
    }).catch((error) => {
      if (cancelled) return;
      setResult({
        status: 'error',
        text: error instanceof Error ? error.message : 'Could not read the selected text.',
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

  const downloadable = result.status === 'downloadable';
  const message = (() => {
    if (result.status === 'success' || result.status === 'error') return result.text;
    if (result.status === 'downloadable') {
      const direction = `${getLanguageName(result.sourceLanguage)} → ${getLanguageName(result.targetLanguage)}`;
      return result.downloading
        ? `${direction}\nModel download is in progress. Click to continue.`
        : `${direction}\nThis language direction is not ready for this site. Click to prepare and translate.`;
    }
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
      className={`${styles.panel} ${result.status === 'error' ? 'text-danger' : ''} ${downloadable ? styles.downloadable : ''}`.trim()}
      label="Translation"
      role={downloadable ? 'dialog' : 'status'}
    >
      {downloadable ? (
        <button
          className={styles.downloadAction}
          type="button"
          onClick={() => void translate(sourceText, true, result.sourceLanguage)}
        >
          {message}
        </button>
      ) : message}
    </FloatingPopover>
  );
}
