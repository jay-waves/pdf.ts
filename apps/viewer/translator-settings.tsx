import { useState } from 'react';
import { platform } from '#platform';
import { getBrowserDefaultLanguage } from '../ai/ai-prompt';
import { isTranslationEnabled, TRANSLATION_ENABLED_PREFERENCE } from '../selection/translation-settings';
import { SettingsToggle } from './settings-toggle';
import { useTranslationPrompt } from './use-translation-prompt';
import styles from './llm-settings.module.css';
import cardStyles from '../components/settings-card.module.css';

export function TranslatorSettings({ llmEnabled }: { llmEnabled: boolean }) {
  const [enabled, setEnabled] = useState(() => isTranslationEnabled(platform.getPreference));
  const editor = useTranslationPrompt(platform.ai);
  return <section className={cardStyles.card} data-enabled={enabled} aria-labelledby="translator-title" onBlur={editor.save}>
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
  </section>;
}
