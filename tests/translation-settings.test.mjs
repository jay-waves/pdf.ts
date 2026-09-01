import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getBrowserTranslationLanguage,
  getConfiguredTranslationTargetLanguage,
  getTranslationSourceLanguage,
  normalizeTranslationLanguage,
  TRANSLATION_SOURCE_LANGUAGE_PREFERENCE,
  TRANSLATION_TARGET_LANGUAGE_PREFERENCE,
} from '../apps/selection/translation-settings.ts';

function preferences(entries) {
  return (key) => entries[key] ?? null;
}

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
