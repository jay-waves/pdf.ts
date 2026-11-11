import { useEffect, useRef, useState } from 'react';
import type { Kernel } from '@embedpdf/core';
import { SelectionToken } from '@embedpdf/plugin-selection';
import { FloatingPopover } from '../components';
import { platform } from '#platform';
import { SelectionLlm } from './selection-llm';
import { normalizePdfText } from '../shared/utils';
import type { ViewerTranslationRequest } from '../viewer/viewer-controller';
import { googleTranslationUrl, isLlmEnabled } from './translation-settings';
import styles from './selection-translate.module.css';

type Props = { registry?: Kernel; request: ViewerTranslationRequest; onClose(): void };
export function SelectionTranslate(props: Props) {
  return props.request.mode === 'llm' ? <SelectionLlm {...props} /> : <TranslationPopover {...props} />;
}

function TranslationPopover({ registry, request, onClose }: Props) {
  const [sourceText, setSourceText] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    setSourceText(''); setText(''); setError(''); setLoading(true);
    const scope = registry?.tryCapability(SelectionToken, request.documentId);
    void (async () => {
      try {
        if (!scope) throw new Error('Could not read the selected text.');
        const parts = await scope.readText();
        if (active.signal.aborted) return;
        const selected = normalizePdfText(parts).trim();
        setSourceText(selected);
        if (!isLlmEnabled(platform.getPreference)) throw new Error('LLM is disabled. Open Google Translate to translate this selection.');
        if (!platform.ai?.request) throw new Error('Configure LLM in Developer > LLM to translate.');
        const result = await platform.ai?.request({ text: selected, task: 'translate' }, active.signal, (reply) => {
          if (!active.signal.aborted) setText(reply);
        });
        if (active.signal.aborted) return;
        if (!result.trim()) throw new Error('The LLM returned an empty translation.');
        setText(result);
      } catch (failure) {
        if (!active.signal.aborted) setError(failure instanceof Error ? failure.message : 'Translation failed.');
      } finally {
        if (!active.signal.aborted) setLoading(false);
      }
    })();
    return () => { active.abort(); if (controller.current === active) controller.current = null; };
  }, [registry, request]);

  return <FloatingPopover anchor={request.anchor} sideOffset={10} onClose={onClose}
    dismissOnFocusOutside={false} label="Translate" role="dialog"
    className={`pdf-glass-surface pdf-glass-popover ${styles.panel}`}>
    <div aria-busy={loading}>{text || (loading ? 'Translating with LLM…' : '')}</div>
    {error && <p className="text-danger" role="alert">{error}</p>}
    {!loading && error && sourceText && <a className={styles.externalLink} href={googleTranslationUrl(sourceText)}
      onClick={(event) => { event.preventDefault(); platform.openExternal(event.currentTarget.href); onClose(); }}>
      Open in Google Translate
    </a>}
  </FloatingPopover>;
}
