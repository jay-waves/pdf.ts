import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getBrowserTranslationLanguage,
  getConfiguredTranslationTargetLanguage,
  getTranslationSourceLanguage,
  normalizeTranslationLanguage,
  TRANSLATION_SOURCE_LANGUAGE_PREFERENCE,
  TRANSLATION_TARGET_LANGUAGE_PREFERENCE,
  getTranslatorMode,
  googleTranslationUrl,
  TRANSLATOR_PREFERENCE,
} from '../apps/selection/translation-settings.ts';

function preferences(entries) {
  return (key) => entries[key] ?? null;
}

test('Translator selection alone controls LLM usage, which remains unavailable on web', () => {
  const configured = preferences({ [TRANSLATOR_PREFERENCE]: 'llm' });
  assert.equal(getTranslatorMode(configured, false), 'builtin');
  assert.equal(getTranslatorMode(configured, true), 'llm');
  assert.equal(getTranslatorMode(preferences({ [TRANSLATOR_PREFERENCE]: 'llm', 'pdf.ts:llm-enabled': 'false' }), true), 'llm');
  assert.equal(getTranslatorMode(preferences({ [TRANSLATOR_PREFERENCE]: 'builtin' }), true), 'builtin');
  assert.equal(getTranslatorMode(preferences({}), true), 'builtin');
  assert.equal(getTranslatorMode(preferences({ [TRANSLATOR_PREFERENCE]: 'google' }), false), 'google');
});

test('Google Translate links safely preserve text and requested languages', () => {
  const text = 'a & b # c? 中文\n%s';
  const url = new URL(googleTranslationUrl(text, 'zh-CN'));
  assert.equal(url.origin, 'https://translate.google.com');
  assert.equal(url.searchParams.get('text'), text);
  assert.equal(url.searchParams.get('tl'), 'zh-CN');
  assert.equal(url.searchParams.get('sl'), 'auto');
});

test('translation language overrides use empty values for automatic detection', () => {
  const automatic = preferences({
    [TRANSLATION_SOURCE_LANGUAGE_PREFERENCE]: '',
    [TRANSLATION_TARGET_LANGUAGE_PREFERENCE]: '   ',
  });
  assert.equal(getTranslationSourceLanguage(automatic), undefined);
  assert.equal(getConfiguredTranslationTargetLanguage(automatic), undefined);
});

test('translation language overrides canonicalize BCP 47 tags', () => {
  const configured = preferences({
    [TRANSLATION_SOURCE_LANGUAGE_PREFERENCE]: 'zh_cn',
    [TRANSLATION_TARGET_LANGUAGE_PREFERENCE]: 'FR_fr',
  });
  assert.equal(getTranslationSourceLanguage(configured), 'zh-CN');
  assert.equal(getConfiguredTranslationTargetLanguage(configured), 'fr-FR');
  assert.equal(normalizeTranslationLanguage('zh_hant_tw'), 'zh-Hant-TW');
});

test('a target override equal to the browser language is automatic', () => {
  const browserLanguage = getBrowserTranslationLanguage();
  const configured = preferences({
    [TRANSLATION_TARGET_LANGUAGE_PREFERENCE]: browserLanguage,
  });
  assert.equal(getConfiguredTranslationTargetLanguage(configured), undefined);
});
