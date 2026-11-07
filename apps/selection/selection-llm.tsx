import { PopoverResizeHandle } from '../components/popover-resize-handle';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PluginRegistry } from '@embedpdf/core';
import type { SelectionCapability } from '@embedpdf/plugin-selection';
import { Check, Copy, MessageSquareMore, Pencil, Send } from 'lucide-react';
import { FloatingPopover, IconButton } from '../components';
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
  const [copied, setCopied] = useState(false);
  useEffect(() => { setCopied(false); }, [text]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const history = useRef<AiMessage[]>([]);
  const controller = useRef<AbortController | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const sizeInitialDraft = useRef(false);

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
          const selected = normalizePdfText(parts.join(' ')).trim().slice(0, 4000);
          setText(selected ? `${selected.split(/\r?\n/).map((line) => `> ${line}`).join('\n')}\n\n` : '');
          sizeInitialDraft.current = true;
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

  useLayoutEffect(() => {
    const input = textarea.current;
    if (status !== 'editing' || !input || !sizeInitialDraft.current) return;
    sizeInitialDraft.current = false;
    const panel = input.parentElement;
    if (!panel) return;
    // Size the initial selection before the user starts editing.
    panel.style.removeProperty('height');
    input.style.height = '144px';
    const height = Math.min(Math.max(144, input.scrollHeight), 280, window.innerHeight * 0.45);
    panel.style.height = `${height + panel.getBoundingClientRect().height - input.getBoundingClientRect().height}px`;
    input.style.removeProperty('height');
  }, [status, text]);

  useLayoutEffect(() => {
    const input = textarea.current;
    const panel = input?.parentElement;
    if (!input || !panel || (status !== 'loading' && status !== 'answer')) return;
    const currentHeight = input.getBoundingClientRect().height;
    const height = Math.min(input.scrollHeight, 420, window.innerHeight * 0.6);
    // Grow with streamed content; preserve a larger manually resized panel.
    if (height > currentHeight) {
      panel.style.height = `${panel.getBoundingClientRect().height + height - currentHeight}px`;
    }
  }, [status, text]);

  useEffect(() => {
    if (status === 'editing' && textarea.current) {
      const input = textarea.current;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      input.scrollTop = input.scrollHeight;
    }
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
      const onText = (text: string) => {
        if (!active.signal.aborted) setText(text);
      };
      if (!platform.requestAi) throw new Error('LLM is unavailable in this environment.');
      const answer = await platform.requestAi({ text: prompt, history: history.current }, active.signal, onText);
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
    dismissOnFocusOutside={false} stableSide label="Ask LLM" role="dialog"
    className={`pdf-glass-surface pdf-glass-popover ${styles.commentPopover}`}>
    <div className={styles.editorHeading}>
      <MessageSquareMore size={14} className="text-accent" />
      <span className={styles.type}>{status === 'loading' || status === 'answer' ? 'Response' : 'Ask'}</span>
      <div className={styles.actions}>
        {status === 'answer'
          ? <IconButton label="Ask a follow-up" icon={Pencil} onClick={() => { setText(''); setStatus('editing'); }} />
          : <IconButton label={status === 'loading' ? 'Sending…' : 'Send'} icon={Send}
            disabled={status !== 'editing' || !text.trim()} onClick={() => void send()} />}
        <IconButton label={copied ? 'Copied' : 'Copy text'} icon={copied ? Check : Copy} disabled={!text}
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => {
              setError('Could not copy text. Select the text and copy it manually.');
            });
          }} />
      </div>
    </div>
    <textarea ref={textarea} className={styles.textarea} value={text}
      readOnly={status !== 'editing'} aria-label={status === 'answer' ? 'LLM response' : 'Ask'}
      aria-busy={status === 'loading'}
      placeholder={status === 'loading' ? 'Running LLM…' : history.current.length ? 'Ask a follow-up…' : 'Ask…'}
      onChange={(event) => setText(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
          event.preventDefault();
          void send();
        }
      }} />
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  <PopoverResizeHandle />
    </FloatingPopover>;
}
