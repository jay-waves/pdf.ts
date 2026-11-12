import { useEffect, useState } from 'react';
import type { Kernel } from '@embedpdf/core';
import { SelectionToken } from '@embedpdf/plugin-selection';
import { FloatingPopover } from '../components';
import { platform } from '#platform';
import { SelectionLlm } from './selection-llm';
import { normalizePdfText } from '../shared/utils';
import type { ViewerTranslationRequest } from '../viewer/viewer-controller';
import { googleTranslationUrl, isLlmEnabled } from './translation-settings';

type Props = { registry?: Kernel; request: ViewerTranslationRequest; onClose(): void };
export function SelectionTranslate(props: Props) {
  return props.request.mode === 'llm' ? <SelectionLlm {...props} /> : <TranslationPopover {...props} />;
}

function TranslationPopover({ registry, request, onClose }: Props) {
  const [sourceText, setSourceText] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const active = new AbortController();
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
    return () => active.abort();
  }, [registry, request]);

  return <FloatingPopover anchor={request.anchor} sideOffset={10} onClose={onClose}
    dismissOnFocusOutside={false} label="Translate" role="dialog"
    className="ui-glass ui-popover pointer-events-auto z-[2147483647] max-h-[min(256px,calc(100vh-24px))] w-72 max-w-[calc(100vw-24px)] overflow-auto rounded-xl border px-2.5 py-2 text-[10.5px] leading-[1.45] whitespace-pre-wrap text-foreground select-text [overflow-wrap:anywhere]">
    <div aria-busy={loading}>{text || (loading ? 'Translating with LLM…' : '')}</div>
    {error && <p className="text-danger" role="alert">{error}</p>}
    {!loading && error && sourceText && <a className="mt-2 block text-accent underline underline-offset-2" href={googleTranslationUrl(sourceText)}
      onClick={(event) => { event.preventDefault(); platform.openExternal(event.currentTarget.href); onClose(); }}>
      Open in Google Translate
    </a>}
  </FloatingPopover>;
}
