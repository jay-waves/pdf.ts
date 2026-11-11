import { useEffect, useRef, useState } from 'react';
import type { AiService } from '../ai/types';
import { DEFAULT_AI_PROMPT } from '../ai/config';

let promptSaveQueue: Promise<void> = Promise.resolve();

export function useTranslationPrompt(ai: AiService | undefined) {
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
