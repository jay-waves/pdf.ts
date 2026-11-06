import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTranslationEnabled,
  isLlmEnabled,
  googleTranslationUrl,
  runTranslateAction,
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

test('Google Translate links preserve selection and delegate language choice to Google', () => {
  const text = 'a & b # c? 中文\n%s';
  const url = new URL(googleTranslationUrl(text));
  assert.equal(url.origin, 'https://translate.google.com');
  assert.equal(url.searchParams.get('text'), text);
  assert.equal(url.searchParams.has('tl'), false);
  assert.equal(url.searchParams.get('sl'), 'auto');
});

test('Translate opens LLM when enabled and opens Google directly without LLM when disabled', () => {
  const events = [];
  const options = { text: 'hello & 中文', openLlm: () => events.push('llm'), openExternal: (url) => events.push(new URL(url)) };
  runTranslateAction({ ...options, llmEnabled: true });
  assert.deepEqual(events, ['llm']);
  runTranslateAction({ ...options, llmEnabled: false });
  assert.equal(events.length, 2, 'external navigation must happen synchronously in the click handler');
  assert.equal(events[1].hostname, 'translate.google.com');
  assert.equal(events[1].searchParams.get('text'), options.text);
});
