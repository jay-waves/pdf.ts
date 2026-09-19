import { useEffect, useState } from 'react';
import { Cpu, Languages, ExternalLink } from 'lucide-react';
import { platform } from '#platform';
import type { PlatformLanguageDetectionResult } from '../platform/types';
import { getTranslatorMode, TRANSLATOR_PREFERENCE, type TranslatorMode } from '../selection/translation-settings';
import { TranslationLanguageSettings } from './translation-language-settings';
import styles from './llm-settings.module.css';

export function TranslatorSettings({ detectedLanguage, llmAvailability }: {
  detectedLanguage?: PlatformLanguageDetectionResult;
  llmAvailability: { available: boolean };
}) {
  const [translator, setTranslator] = useState<TranslatorMode>(() => getTranslatorMode(platform.getPreference, Boolean(platform.requestAi)));
  useEffect(() => {
    setTranslator(getTranslatorMode(platform.getPreference, Boolean(platform.requestAi)));
  }, [llmAvailability]);
  const chooseTranslator = (mode: TranslatorMode) => {
    platform.setPreference(TRANSLATOR_PREFERENCE, mode);
    setTranslator(mode);
  };
  return (
    <section className={styles.card} aria-labelledby="translator-title">
      <div className={styles.heading}><div><h2 id="translator-title">Translator</h2><p>Choose how selected text is translated.</p></div><Languages size={18} /></div>
      <div className={styles.providers} role="group" aria-label="Translation provider">
        {([
          ['builtin', 'Built-in', 'On-device translation', Languages],
          ['llm', 'LLM', 'Use translation settings', Cpu],
          ['google', 'Google Translate', 'Open an external link', ExternalLink],
        ] as const).map(([mode, name, description, Icon]) => <button key={mode} type="button" aria-pressed={translator === mode}
          disabled={mode === 'llm' && !llmAvailability.available} onClick={() => chooseTranslator(mode)}>
          <Icon size={16} /><strong>{name}</strong><span>{description}</span>
        </button>)}
      </div>
      <TranslationLanguageSettings detectedLanguage={detectedLanguage} />
    </section>
  );
}
