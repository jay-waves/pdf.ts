import { useEffect, useRef, useState } from 'react';
import { platform } from '#platform';
import { getBrowserDefaultLanguage } from '../ai/ai-prompt';
import { isTranslationEnabled, TRANSLATION_ENABLED_PREFERENCE } from '../selection/translation-settings';
import { SettingsToggle } from './settings-toggle';
import type { AiService } from '../ai/types';
import { DEFAULT_AI_PROMPT } from '../ai/config';
import styles from './llm-settings.module.css';
import { SettingsCard } from '../components/settings-card';

export function TranslatorSettings({ llmEnabled }: { llmEnabled: boolean }) {
  const [enabled, setEnabled] = useState(() => isTranslationEnabled(platform.getPreference));
  const editor = useTranslationPrompt(platform.ai);
  return <SettingsCard data-enabled={enabled} aria-labelledby="translator-title" onBlur={editor.save}>
    <div className={styles.heading}><div><h2 id="translator-title">Translate</h2>
      <p>{llmEnabled ? 'Uses the model and API key configured in LLM. The prompt controls the translation language.' : 'LLM is off. Translate opens Google Translate in a new tab.'}</p>
    </div><SettingsToggle label="Enable Translate" checked={enabled} onCheckedChange={(value) => {
      platform.setPreference(TRANSLATION_ENABLED_PREFERENCE, String(value)); setEnabled(value);
    }} /></div>
    <fieldset disabled={!enabled || !llmEnabled || !editor.loaded} className={styles.fieldset}>
      <label className={styles.field}>Translation Prompt
        <textarea rows={7} value={editor.prompt} onChange={(event) => editor.edit(event.target.value)} />
      </label>
      <p className={styles.hint}>{'{{browserDefault}}'} uses your browser language ({getBrowserDefaultLanguage()}). Replace it with a language of your choice. {'{{selectedText}}'} inserts the selected text. Clear the prompt to restore the default.</p>
    </fieldset>
    {editor.error && <p className={styles.error} role="alert">{editor.error}</p>}
  </SettingsCard>;
}

let promptSaveQueue: Promise<void> = Promise.resolve();

function useTranslationPrompt(ai: AiService | undefined) {
  const getConfig = ai?.getConfig;
  const setConfig = ai?.configure;
  const [prompt, setPrompt] = useState(DEFAULT_AI_PROMPT);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const draft = useRef({ value: DEFAULT_AI_PROMPT, revision: 0 });
  const dirty = useRef(false);
  const mounted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useRef<() => void>(() => {});

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(timer.current); flush.current(); };
  }, []);
  useEffect(() => {
    if (!getConfig || !setConfig) return;
    let active = true;
    void promptSaveQueue.then(getConfig).then((config) => {
      if (!active) return;
      draft.current = { value: config.prompt, revision: 0 };
      setPrompt(config.prompt);
      setLoaded(true);
    }).catch(() => { if (active) setError('Could not load translation settings.'); });
    return () => { active = false; };
  }, [getConfig, setConfig]);

  const save = () => {
    clearTimeout(timer.current);
    if (!dirty.current || !loaded || !setConfig) return;
    dirty.current = false;
    const snapshot = draft.current;
    const value = snapshot.value.trim() ? snapshot.value : DEFAULT_AI_PROMPT;
    promptSaveQueue = promptSaveQueue.then(async () => {
      await setConfig({ prompt: value });
      if (!mounted.current || draft.current.revision !== snapshot.revision) return;
      draft.current = { value, revision: snapshot.revision };
      setPrompt(value);
      setError('');
    }).catch((failure) => {
      if (!mounted.current || draft.current.revision !== snapshot.revision) return;
      dirty.current = true;
      setError(failure instanceof Error ? failure.message : 'Could not save translation prompt.');
    });
  };
  flush.current = save;
  const edit = (value: string) => {
    draft.current = { value, revision: draft.current.revision + 1 };
    dirty.current = true;
    setPrompt(value); setError('');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush.current(), 500);
  };
  return { prompt, loaded, error, edit, save };
}
