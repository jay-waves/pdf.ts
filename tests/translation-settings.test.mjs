import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getBrowserTranslationLanguage,
  getConfiguredTranslationTargetLanguage,
  getTranslationSourceLanguage,
  normalizeTranslationLanguage,
  TRANSLATION_SOURCE_LANGUAGE_PREFERENCE,
  TRANSLATION_TARGET_LANGUAGE_PREFERENCE,
  isTranslationEnabled,
  isLlmEnabled,
  googleTranslationUrl,
  TRANSLATION_ENABLED_PREFERENCE,
  LLM_ENABLED_PREFERENCE,
} from '../apps/selection/translation-settings.ts';

function preferences(entries) {
  return (key) => entries[key] ?? null;
}

test('translation and LLM default to enabled independently of legacy provider selection', () => {
  for (const legacy of [undefined, 'builtin', 'llm', 'google']) {
    const read = preferences({ 'pdf.ts:translator': legacy });
    assert.equal(isTranslationEnabled(read), true);
    assert.equal(isLlmEnabled(read), true);
  }
});

test('translation and LLM can each be disabled without affecting the other', () => {
  const translationDisabled = preferences({ [TRANSLATION_ENABLED_PREFERENCE]: 'false' });
  assert.equal(isTranslationEnabled(translationDisabled), false);
  assert.equal(isLlmEnabled(translationDisabled), true);
  const llmDisabled = preferences({ [LLM_ENABLED_PREFERENCE]: 'false' });
  assert.equal(isTranslationEnabled(llmDisabled), true);
  assert.equal(isLlmEnabled(llmDisabled), false);
  const bothDisabled = preferences({
    [TRANSLATION_ENABLED_PREFERENCE]: 'false',
    [LLM_ENABLED_PREFERENCE]: 'false',
  });
  assert.equal(isTranslationEnabled(bothDisabled), false);
  assert.equal(isLlmEnabled(bothDisabled), false);
  const reenabled = preferences({
    [TRANSLATION_ENABLED_PREFERENCE]: 'true',
    [LLM_ENABLED_PREFERENCE]: 'true',
  });
  assert.equal(isTranslationEnabled(reenabled), true);
  assert.equal(isLlmEnabled(reenabled), true);
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
