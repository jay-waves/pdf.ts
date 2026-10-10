import { useState } from 'react';
import { platform } from '#platform';
import type { PlatformLanguageDetectionResult } from '../platform/types';
import { isTranslationEnabled, TRANSLATION_ENABLED_PREFERENCE } from '../selection/translation-settings';
import { TranslationLanguageSettings } from './translation-language-settings';
import { SettingsToggle } from './settings-toggle';
import styles from './llm-settings.module.css';

export function TranslatorSettings({ detectedLanguage }: {
  detectedLanguage?: PlatformLanguageDetectionResult;
}) {
  const [enabled, setEnabled] = useState(() => isTranslationEnabled(platform.getPreference));
  return (
    <section className={styles.card} data-enabled={enabled} aria-labelledby="translator-title">
      <div className={styles.heading}><div><h2 id="translator-title">Translate</h2>
        <p>Use built-in translation, with an external Google Translate link as fallback.</p>
      </div><SettingsToggle label="Enable Translate" checked={enabled} onCheckedChange={(value) => {
        platform.setPreference(TRANSLATION_ENABLED_PREFERENCE, String(value));
        setEnabled(value);
      }} /></div>
      <fieldset disabled={!enabled} className={styles.fieldset}>
        <TranslationLanguageSettings detectedLanguage={detectedLanguage} />
      </fieldset>
    </section>
  );
}
