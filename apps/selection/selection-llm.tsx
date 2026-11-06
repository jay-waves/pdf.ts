import { useEffect, useRef, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import type { SelectionCapability } from '@embedpdf/plugin-selection';
import { MessageSquareMore, Pencil, X } from 'lucide-react';
import { Button, FloatingPopover, IconButton } from '../components';
import { platform } from '#platform';
import type { AiMessage } from '../platform/types';
import { getPluginCapability, normalizePdfText } from '../shared/utils';
import type { ViewerTranslationRequest } from '../viewer/viewer-controller';
import styles from '../annotations/comments.module.css';

export function SelectionLlm({ registry, request, onClose }: {
  registry?: PluginRegistry;
  request: ViewerTranslationRequest;
  onClose(): void;
}) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'preparing' | 'editing' | 'loading' | 'answer'>('preparing');
  const [error, setError] = useState('');
  const history = useRef<AiMessage[]>([]);
  const controller = useRef<AbortController | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    history.current = [];
    setText('');
    setError('');
    setStatus('preparing');
    const scope = getPluginCapability<SelectionCapability>(registry, 'selection')?.forDocument(request.documentId);
    void (async () => {
      try {
        if (!scope) throw new Error('Could not read the selected text.');
        const parts = await scope.getSelectedText().toPromise();
        if (!cancelled) {
          setText(normalizePdfText(parts.join(' ')).trim().slice(0, 4000));
          setStatus('editing');
        }
      } catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : 'Could not read the selected text.');
          setStatus('editing');
        }
      }
    })();
    return () => { cancelled = true; controller.current?.abort(); controller.current = null; };
  }, [registry, request]);

  useEffect(() => {
    if (status === 'editing') textarea.current?.focus();
  }, [status]);

  const send = async () => {
    if (status !== 'editing' || !text.trim() || controller.current) return;
    const prompt = text.trim();
    const active = new AbortController();
    controller.current = active;
    setStatus('loading');
    setError('');
    setText('');
    try {
      if (!platform.requestAi) throw new Error('The desktop launcher is unavailable.');
      const answer = await platform.requestAi({ text: prompt, history: history.current }, active.signal, (text) => {
        if (!active.signal.aborted) setText(text);
      });
      if (active.signal.aborted) return;
      history.current = [...history.current, { role: 'user', content: prompt }, { role: 'assistant', content: answer }];
      setText(answer);
      setStatus('answer');
    } catch (error) {
      if (active.signal.aborted) return;
      setText(prompt);
      setStatus('editing');
      setError(error instanceof Error ? error.message : 'LLM request failed.');
    } finally {
      if (controller.current === active) controller.current = null;
    }
  };

  return <FloatingPopover anchor={request.anchor} sideOffset={10} onClose={onClose}
    dismissOnFocusOutside={false} label="Ask LLM" role="dialog"
    className={`pdf-glass-surface pdf-glass-popover ${styles.commentPopover}`}>
    <div className={styles.editorHeading}>
      <MessageSquareMore size={14} className="text-accent" />
      <span className={styles.type}>Ask</span>
      <div className={styles.actions}>
        {status === 'answer'
          ? <IconButton label="Ask a follow-up" icon={Pencil} onClick={() => { setText(''); setStatus('editing'); }} />
          : <Button disabled={status !== 'editing' || !text.trim()} onClick={() => void send()}>
            {status === 'loading' ? 'Sending…' : 'Send'}
          </Button>}
        <IconButton label="Close" icon={X} onClick={onClose} />
      </div>
    </div>
    <textarea ref={textarea} className={styles.textarea} value={text}
      readOnly={status !== 'editing'} aria-label={status === 'answer' ? 'LLM response' : 'Ask'}
      aria-busy={status === 'loading'}
      placeholder={status === 'loading' ? 'Running LLM…' : history.current.length ? 'Ask a follow-up…' : 'Ask…'}
      onChange={(event) => setText(event.currentTarget.value)}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void send(); }
      }} />
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </FloatingPopover>;
}
