import { useEffect, useRef, useState } from 'react';
import { platform } from '#platform';
import type { AiConfig, AiConfigUpdate } from '../ai/types';
import { createDefaultAiConfig } from '../ai/config';
import { SettingsToggle } from './settings-toggle';
import styles from './llm-settings.module.css';
import { SettingsCard } from '../components/settings-card';

const EMPTY_CONFIG = createDefaultAiConfig();
// Keep saves ordered even when the settings dialog is closed and reopened.
let saveQueue: Promise<void> = Promise.resolve();
const supportsLlm = Boolean(platform.ai);

export function LlmSettings({ enabled, onEnabledChange }: {
  enabled: boolean;
  onEnabledChange(enabled: boolean): void;
}) {
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
    if (!supportsLlm) return;
    let active = true;
    void saveQueue.then(() => platform.ai!.getConfig()).then((value) => {
      if (!active) return;
      // Preserve edits made while the browser configuration is loading.
      const next = draft.current.revision === 0 ? value : {
        ...draft.current.config,
        apiKeyConfigured: value.apiKeyConfigured,
        totalTokens: value.totalTokens,
      };
      draft.current.config = next;
      setConfig(next);
      setLoaded(true);
    }).catch((failure) => {
      if (active) {
        setError(failure instanceof Error ? failure.message : 'Could not load LLM settings.');
      }
    });
    return () => { active = false; };
  }, []);

  const save = () => {
    clearTimeout(timer.current);
    if (!dirty.current) return;
    if (!supportsLlm) {
      if (mounted.current) setStatus('LLM is unavailable in this environment.');
      return;
    }
    if (!loaded) return;
    dirty.current = false;
    const snapshot = draft.current;
    const update: AiConfigUpdate = {
      rememberApiKey: snapshot.config.rememberApiKey,
      model: snapshot.config.model.trim(),
      baseUrl: snapshot.config.baseUrl.trim().replace(/\/+$/, ''),
      ...(snapshot.apiKey.trim() ? { apiKey: snapshot.apiKey.trim() } : {}),
    };
    if (mounted.current) { setError(''); setStatus('Saving…'); }
    saveQueue = saveQueue.then(async () => {
      try {
        await platform.ai!.configure(update);
        const saved = await platform.ai!.getConfig();
        if (!mounted.current) return;
        // A slow response must never replace text typed after this save began.
        if (draft.current.revision !== snapshot.revision) return;
        draft.current = { config: saved, apiKey: '', revision: snapshot.revision };
        setConfig(saved); setApiKey('');
        setStatus(saved.rememberApiKey ? 'Saved in this browser.' : 'Settings saved. API key stays in memory until this page reloads or closes.');
      } catch (failure) {
        if (!mounted.current || draft.current.revision !== snapshot.revision) return;
        dirty.current = true;
        setStatus('');
        setError(failure instanceof Error ? failure.message : 'Could not save LLM settings.');
      }
    });
  };
  flush.current = save;
  useEffect(() => {
    if (loaded) flush.current();
  }, [loaded]);

  const scheduleSave = () => {
    draft.current = { ...draft.current, revision: draft.current.revision + 1 };
    dirty.current = true;
    setError(''); setStatus('Saving…');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush.current(), 500);
  };
  const edit = (field: 'model' | 'baseUrl', value: string) => {
    const updated = { ...draft.current.config, [field]: value };
    draft.current = { ...draft.current, config: updated };
    setConfig(updated);
    scheduleSave();
  };

  const runAction = async (action: 'test' | 'reset' | 'clear') => {
    clearTimeout(timer.current);
    save();
    setError(''); setStatus(action === 'test' ? 'Testing…' : 'Saving…');
    try {
      await saveQueue;
      if (dirty.current && action === 'test') throw new Error('Save valid LLM settings before testing the connection.');
      if (action === 'test') await platform.ai!.request({ text: 'hello' });
      if (action === 'clear') await platform.ai!.configure({ apiKey: '', rememberApiKey: false });
      if (action === 'reset') await platform.ai!.configure({ reset: true });
      const value = await platform.ai!.getConfig();
      draft.current = { config: value, apiKey: '', revision: draft.current.revision + 1 };
      setConfig(value); setApiKey('');
      setStatus(action === 'test' ? 'LLM connection successful.' : '');
    } catch (failure) {
      setStatus('');
      setError(failure instanceof Error ? failure.message : 'LLM action failed.');
    }
  };

  return <SettingsCard asChild><form className={styles.editorPanel} data-enabled={enabled} onBlur={() => save()} onSubmit={(event) => { event.preventDefault(); save(); }}>
    <div className={styles.heading}><div><h2>LLM</h2><p>{supportsLlm
      ? 'Connect directly to an OpenAI-compatible model. The provider must allow browser requests (CORS).'
      : 'LLM is unavailable in this environment.'}</p></div><SettingsToggle label="Enable LLM" checked={enabled}
      onCheckedChange={(value) => {
        onEnabledChange(value);
      }} /></div>
    <fieldset disabled={!enabled || !loaded} className={styles.fieldset}>
      <label className={styles.field}>Model name
        <input value={config.model} placeholder="Provider model name" spellCheck={false} onChange={(event) => edit('model', event.target.value)} />
      </label>
      <label className={styles.field}>Base URL
        <input type="url" value={config.baseUrl} placeholder="https://…/v1" spellCheck={false} onChange={(event) => edit('baseUrl', event.target.value)} />
      </label>
      <p className={styles.hint}>HTTPS, or HTTP for localhost / 127.0.0.1 / [::1]. Changing the Base URL clears the current key; enter it again for the new endpoint. Redirects are blocked.</p>
      <label className={styles.field}>API key
        <input type="password" autoComplete="off" spellCheck={false} autoCapitalize="none" value={apiKey}
          placeholder={config.apiKeyConfigured ? '*****' : 'API key'}
          onChange={(event) => {
            const value = event.target.value;
            clearTimeout(timer.current);
            draft.current = { ...draft.current, apiKey: value, revision: draft.current.revision + 1 };
            dirty.current = true;
            setApiKey(value); setError(''); setStatus('');
          }} />
      </label>
      <div className={styles.storageChoice}>
        <div className={styles.storageRow}>
          <span className={styles.fieldTitle}>Remember API key in this browser</span>
          <SettingsToggle label="Remember API key in this browser" checked={config.rememberApiKey} describedBy="llm-key-storage-risk"
            onCheckedChange={(checked) => {
              const updated = { ...draft.current.config, rememberApiKey: checked };
              draft.current = { ...draft.current, config: updated };
              setConfig(updated);
              scheduleSave();
              flush.current();
            }} />
        </div>
        <p id="llm-key-storage-risk" className={styles.hint}>
          {config.rememberApiKey
            ? 'Warning: your API key will be stored unencrypted in this browser. Injected scripts (XSS) or someone with access to your browser profile may steal it. Use a separate, revocable key with a hard spending limit; never use a production or high-limit key.'
            : 'Default: the key stays only in memory and is cleared when this page reloads or closes. This does not protect against injected scripts (XSS). Use a separate key with a hard spending limit.'}
        </p>
      </div>
      <div className={styles.actions}>
        <button type="button" disabled={!supportsLlm || !loaded} onClick={() => void runAction('test')}>Test</button>
        <button type="button" disabled={!supportsLlm || !loaded} onClick={() => void runAction('reset')}>Reset</button>
        <button type="button" disabled={!loaded || !config.apiKeyConfigured} onClick={() => void runAction('clear')}>Clear key</button>
        <span className={styles.tokenCount}><strong>{config.totalTokens.toLocaleString()}</strong><span>tokens</span></span>
      </div>
    </fieldset>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {status && <div className={styles.footer}>
      <span className={styles.hint} role="status">{status}</span>
    </div>}
  </form></SettingsCard>;
}
