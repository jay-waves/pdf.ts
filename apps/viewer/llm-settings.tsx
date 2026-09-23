import { useEffect, useRef, useState } from 'react';
import { platform } from '#platform';
import type { AiConfig, AiConfigUpdate } from '../platform/types';
import { TRANSLATOR_PREFERENCE } from '../selection/translation-settings';
import styles from './llm-settings.module.css';

const DEFAULT_PROMPT = 'Translate the following text into Chinese. Preserve meaning, tone, names, formatting, and paragraph breaks. Output only the translation.\n\n{{selectedText}}';
const EMPTY_CONFIG: AiConfig = { model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', apiKeyConfigured: false, prompt: DEFAULT_PROMPT, totalTokens: 0 };
// Keep saves ordered even when the settings dialog is closed and reopened.
let saveQueue: Promise<void> = Promise.resolve();
const supportsLlm = Boolean(platform.getAiConfig && platform.setAiConfig && platform.requestAi);

export function LlmSettings({ onAvailabilityChange }: { onAvailabilityChange(available: boolean): void }) {
  const [config, setConfig] = useState<AiConfig>(EMPTY_CONFIG);
  const [apiKey, setApiKey] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const draft = useRef({ config: EMPTY_CONFIG, apiKey: '', revision: 0 });
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(false);
  const flush = useRef<() => void>(() => {});

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      flush.current();
    };
  }, []);

  useEffect(() => {
    if (!supportsLlm) { onAvailabilityChange(false); return; }
    let active = true;
    void saveQueue.then(() => platform.getAiConfig!()).then((value) => {
      if (!active) return;
      draft.current.config = value;
      setConfig(value);
      setLoaded(true);
      const available = Boolean(value.model && value.baseUrl && value.apiKeyConfigured);
      if (!available && platform.getPreference(TRANSLATOR_PREFERENCE) === 'llm') {
        platform.setPreference(TRANSLATOR_PREFERENCE, 'builtin');
      }
      onAvailabilityChange(available);
    }).catch((failure) => {
      if (active) {
        setError(failure instanceof Error ? failure.message : 'Could not load translation settings.');
        onAvailabilityChange(false);
      }
    });
    return () => { active = false; };
  }, [onAvailabilityChange]);

  const save = () => {
    clearTimeout(timer.current);
    if (!loaded || !dirty.current) return;
    dirty.current = false;
    const snapshot = draft.current;
    const update: AiConfigUpdate = {
      model: snapshot.config.model.trim(),
      baseUrl: snapshot.config.baseUrl.trim().replace(/\/+$/, ''),
      prompt: snapshot.config.prompt.trim() ? snapshot.config.prompt : DEFAULT_PROMPT,
      ...(snapshot.apiKey.trim() ? { apiKey: snapshot.apiKey.trim() } : {}),
    };
    if (mounted.current) { setError(''); setStatus('Saving…'); }
    saveQueue = saveQueue.then(async () => {
      try {
        await platform.setAiConfig!(update);
        const saved = await platform.getAiConfig!();
        const available = Boolean(saved.model && saved.baseUrl && saved.apiKeyConfigured);
        if (!available && platform.getPreference(TRANSLATOR_PREFERENCE) === 'llm') {
          platform.setPreference(TRANSLATOR_PREFERENCE, 'builtin');
        }
        if (!mounted.current) return;
        onAvailabilityChange(available);
        // A slow response must never replace text typed after this save began.
        if (draft.current.revision !== snapshot.revision) return;
        draft.current = { config: saved, apiKey: '', revision: snapshot.revision };
        setConfig(saved); setApiKey('');
        setStatus('Automatically saved.');
      } catch (failure) {
        if (!mounted.current || draft.current.revision !== snapshot.revision) return;
        dirty.current = true;
        setStatus('');
        setError(failure instanceof Error ? failure.message : 'Could not save translation settings.');
      }
    });
  };
  flush.current = save;

  const scheduleSave = () => {
    draft.current = { ...draft.current, revision: draft.current.revision + 1 };
    dirty.current = true;
    setError(''); setStatus('Saving…');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush.current(), 500);
  };
  const edit = (field: 'model' | 'baseUrl' | 'prompt', value: string) => {
    const updated = { ...draft.current.config, [field]: value };
    draft.current = { ...draft.current, config: updated };
    setConfig(updated);
    scheduleSave();
  };

  const runAction = async (action: 'test' | 'reset') => {
    clearTimeout(timer.current);
    save();
    setError(''); setStatus(action === 'test' ? 'Testing…' : 'Saving…');
    try {
      await saveQueue;
      if (action === 'test') await platform.requestAi!({ text: 'hello', targetLanguage: 'zh-CN' });
      if (action === 'reset') await platform.setAiConfig!({ reset: true });
      const value = await platform.getAiConfig!();
      draft.current = { config: value, apiKey: '', revision: draft.current.revision + 1 };
      setConfig(value); setApiKey('');
      onAvailabilityChange(Boolean(value.model && value.baseUrl && value.apiKeyConfigured));
      setStatus(action === 'test' ? 'LLM connection successful.' : '');
    } catch (failure) {
      setStatus('');
      setError(failure instanceof Error ? failure.message : 'LLM action failed.');
    }
  };

  return <form className={styles.editorPanel} onBlur={() => save()} onSubmit={(event) => { event.preventDefault(); save(); }}>
    <div className={styles.heading}><div><h2>Translate</h2><p>{supportsLlm
      ? 'Configure the model used when Translator is set to LLM.'
      : 'LLM translation is available in the desktop launcher. API keys are disabled on the web.'}</p></div></div>
    <fieldset disabled={!supportsLlm || !loaded} className={styles.fieldset}>
      <label className={styles.field}>Model name
        <input value={config.model} placeholder="Provider model name" spellCheck={false} onChange={(event) => edit('model', event.target.value)} />
      </label>
      <label className={styles.field}>Base URL
        <input type="url" value={config.baseUrl} placeholder="https://…/v1" spellCheck={false} onChange={(event) => edit('baseUrl', event.target.value)} />
      </label>
      <label className={styles.field}>API key
        <input type="password" autoComplete="off" value={apiKey}
          placeholder={config.apiKeyConfigured ? '*****' : 'API key'}
          onChange={(event) => {
            const value = event.target.value;
            clearTimeout(timer.current);
            draft.current = { ...draft.current, apiKey: value, revision: draft.current.revision + 1 };
            dirty.current = true;
            setApiKey(value); setError(''); setStatus('');
          }} />
      </label>
      <label className={styles.field}>Prompt
        <textarea rows={9} value={config.prompt} onChange={(event) => edit('prompt', event.target.value)} />
      </label>
      <div className={styles.actions}>
        <button type="button" onClick={() => void runAction('test')}>Test</button>
        <button type="button" onClick={() => void runAction('reset')}>Reset</button>
        <span className={styles.tokenCount}><strong>{config.totalTokens.toLocaleString()}</strong><span>tokens</span></span>
      </div>
    </fieldset>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {supportsLlm && status && <div className={styles.footer}>
      <span className={styles.hint} role="status">{status}</span>
    </div>}
  </form>;
}
