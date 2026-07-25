import { useEffect, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import type { SelectionCapability } from '@embedpdf/plugin-selection';
import { FloatingPopover } from './components';
import { platform } from '#platform';
import { getPluginCapability, normalizePdfText } from './utils';

const MAX_TEXT_LENGTH = 4000;

interface TranslationState {
  text: string;
  status: 'success' | 'error';
}

export interface SelectionTranslationRequest {
  documentId: string;
  anchor: { x: number; y: number };
}

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
  request: SelectionTranslationRequest;
  onClose(): void;
}) {
  const [result, setResult] = useState<TranslationState | null>(null);

  useEffect(() => {
    setResult(null);
    const selection = getPluginCapability<SelectionCapability>(registry, 'selection');
    const translate = platform.translate;
    if (!selection) return;

    let cancelled = false;
    selection.forDocument(request.documentId).getSelectedText().toPromise()
      .then((parts) => translate(normalizeText(parts)))
      .then((translation) => {
        if (cancelled) return;
        if (translation.type === 'external') {
          platform.openExternal(translation.url);
          onClose();
          return;
        }
        setResult({ text: translation.text, status: 'success' });
      })
      .catch((error) => {
        if (cancelled) return;
        setResult({
          text: error instanceof Error ? error.message : 'Translation failed.',
          status: 'error',
        });
      });

    const close = () => onClose();
    window.addEventListener('scroll', close, { capture: true, passive: true });
    const unsubscribeSelectionChange = selection.onSelectionChange((event) => {
      if (!event.selection) close();
    });

    return () => {
      cancelled = true;
      window.removeEventListener('scroll', close, { capture: true });
      unsubscribeSelectionChange();
    };
  }, [registry, request]);

  return (
    <FloatingPopover
      onClose={onClose}
      anchor={request.anchor}
      sideOffset={10}
      className={`shnctl-translate-panel${result?.status === 'error' ? ' is-error' : ''}`}
      label="Translation"
      role="status"
    >
      {result?.text ?? 'Translating...'}
    </FloatingPopover>
  );
}
