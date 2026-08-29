import assert from 'node:assert/strict';
import test from 'node:test';
import { translateWithBrowserModel } from '../apps/platform/browser-translation.ts';

test('Edge Chinese translation uses the temporary lzh compatibility route', async () => {
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
      sourceLanguage: 'zh-Hans',
      targetLanguage: 'en',
    });
    assert.equal(createdWith.sourceLanguage, 'lzh');
    assert.equal(createdWith.targetLanguage, 'en');
  } finally {
    globalThis.Translator = previousTranslator;
    globalThis.window = previousWindow;
  }
});
