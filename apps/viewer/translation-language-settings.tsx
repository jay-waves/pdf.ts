import { useState } from 'react';
import { platform } from '#platform';
import type { PlatformLanguageDetectionResult } from '../platform/types';
import {
  getBrowserTranslationLanguage, getConfiguredTranslationTargetLanguage,
  getTranslationSourceLanguage, normalizeTranslationLanguage,
  TRANSLATION_SOURCE_LANGUAGE_PREFERENCE, TRANSLATION_TARGET_LANGUAGE_PREFERENCE,
} from '../selection/translation-settings';
import styles from './llm-settings.module.css';

export function TranslationLanguageSettings({ detectedLanguage }: { detectedLanguage?: PlatformLanguageDetectionResult }) {
  const [source, setSource] = useState(() => getTranslationSourceLanguage(platform.getPreference) ?? '');
  const [target, setTarget] = useState(() => getConfiguredTranslationTargetLanguage(platform.getPreference) ?? '');
  const [error, setError] = useState('');
  const save = (kind: 'source' | 'target', value: string) => {
    try {
      const normalized = value.trim() ? normalizeTranslationLanguage(value) : '';
      const stored = kind === 'target' && normalized === getBrowserTranslationLanguage() ? '' : normalized;
      platform.setPreference(kind === 'source' ? TRANSLATION_SOURCE_LANGUAGE_PREFERENCE : TRANSLATION_TARGET_LANGUAGE_PREFERENCE, stored);
      (kind === 'source' ? setSource : setTarget)(stored);
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Invalid language.');
    }
  };
  return <div className={styles.languageFields}>
    <label className={styles.field}>Source language
      <input value={source} placeholder={`Auto${detectedLanguage ? ` (${detectedLanguage.detectedLanguage})` : ''}`}
        spellCheck={false} onChange={(e) => setSource(e.target.value)} onBlur={() => save('source', source)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} />
    </label>
    <label className={styles.field}>Target language
      <input value={target} placeholder={`Auto (${getBrowserTranslationLanguage()})`}
        spellCheck={false} onChange={(e) => setTarget(e.target.value)} onBlur={() => save('target', target)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} />
    </label>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}
