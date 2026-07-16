import { useEffect, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import type { SelectionCapability } from '@embedpdf/plugin-selection';
import { FloatingPopover } from './components';
import { platform } from '#platform';

const MAX_TEXT_LENGTH = 4000;

interface TranslationResult {
  text: string;
  status: 'success' | 'error';
}

export interface SelectionTranslationRequest {
  id: number;
  documentId: string;
  anchor: { x: number; y: number };
}

function normalizeText(parts: string[]) {
  return parts
    .join(' ')
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
  const [result, setResult] = useState<TranslationResult | null>(null);

  useEffect(() => {
    const selection = registry?.getPlugin('selection')?.provides?.() as SelectionCapability | undefined;
    if (!selection) return;

    let cancelled = false;
    selection.forDocument(request.documentId).getSelectedText().toPromise()
      .then((parts) => {
        if (!platform.translate) throw new Error('Translation is not available.');
        return platform.translate(normalizeText(parts));
      })
      .then((text) => {
        if (!cancelled) setResult({ text, status: 'success' });
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
