import assert from 'node:assert/strict';
import test from 'node:test';
import { translateWithBrowserModel } from '../apps/platform/browser-translation.ts';

test('Chinese translation only supplements an unspecified zh language', async () => {
  const previousTranslator = globalThis.Translator;
  const previousWindow = globalThis.window;
  let createdWith;
  globalThis.window = globalThis;
  globalThis.Translator = {
    async availability() {
      return 'available';
    },
    async create(options) {
      createdWith = options;
      return { async translate(text) { return text; } };
    },
  };

  try {
    await translateWithBrowserModel('测试', {
      sourceLanguage: 'zh',
      targetLanguage: 'en',
    });
    assert.equal(createdWith.sourceLanguage, 'zh-Hans');
    assert.equal(createdWith.targetLanguage, 'en');

    await translateWithBrowserModel('测试', {
      sourceLanguage: 'zh-Hans',
      targetLanguage: 'fr',
    });
    assert.equal(createdWith.sourceLanguage, 'zh-Hans');

    await translateWithBrowserModel('測試', {
      sourceLanguage: 'zh-Hant',
      targetLanguage: 'en',
    });
    assert.equal(createdWith.sourceLanguage, 'zh-Hant');

    await translateWithBrowserModel('測試', {
      sourceLanguage: 'lzh',
      targetLanguage: 'en',
    });
    assert.equal(createdWith.sourceLanguage, 'lzh');
  } finally {
    globalThis.Translator = previousTranslator;
    globalThis.window = previousWindow;
  }
});
