import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

// Match the bundler's extensionless TypeScript import for this module.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './types' && context.parentURL?.endsWith('/platform/browser-translation.ts')) {
      return nextResolve('./types.ts', context);
    }
    return nextResolve(specifier, context);
  },
});
const { translateWithBrowserModel } = await import('../apps/platform/browser-translation.ts');
hooks.deregister();

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

test('a previous download consent still requires a fresh click for missing models', async () => {
  const previousTranslator = globalThis.Translator;
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.localStorage;
  globalThis.window = globalThis;
  globalThis.localStorage = { getItem: () => JSON.stringify(['de\u0000ja']), setItem() {} };
  let created = 0;
  let activation = false;
  let availability = 'downloadable';
  globalThis.Translator = {
    async availability() { return availability; },
    create() {
      assert.equal(activation, true, 'create must run directly from the click');
      created++;
      return Promise.resolve({ async translate() { return 'translated'; } });
    },
  };
  const options = { sourceLanguage: 'de', targetLanguage: 'ja' };
  try {
    for (const state of ['downloadable', 'downloading']) {
      availability = state;
      const result = await translateWithBrowserModel('Hallo', options);
      assert.equal(result.type, 'downloadable');
      assert.equal(result.downloading, state === 'downloading');
      assert.equal(created, 0);
    }
    activation = true;
    const pending = translateWithBrowserModel('Hallo', { ...options, allowModelDownload: true });
    activation = false;
    assert.equal((await pending).text, 'translated');
    assert.equal(created, 1);
    assert.equal((await translateWithBrowserModel('Hallo', options)).text, 'translated');
    assert.equal(created, 1);
  } finally {
    globalThis.Translator = previousTranslator;
    globalThis.window = previousWindow;
    globalThis.localStorage = previousStorage;
  }
});

test('language detection offers a resumable download without creating a model in the background', async () => {
  const { detectLanguageWithBrowserModel } = await import('../apps/platform/browser-translation.ts');
  const { LanguageDetectionDownloadRequired } = await import('../apps/platform/types.ts');
  const previousDetector = globalThis.LanguageDetector;
  const previousWindow = globalThis.window;
  globalThis.window = globalThis;
  let created = 0;
  let activation = false;
  globalThis.LanguageDetector = {
    async availability() { return 'downloadable'; },
    create() {
      assert.equal(activation, true);
      created++;
      return Promise.resolve({ async detect() { return [{ detectedLanguage: 'de', confidence: 1 }]; } });
    },
  };
  try {
    let download;
    await assert.rejects(detectLanguageWithBrowserModel('Hallo'), (error) => {
      assert.ok(error instanceof LanguageDetectionDownloadRequired);
      download = error;
      return true;
    });
    assert.equal(created, 0);
    activation = true;
    const pending = download.resume();
    activation = false;
    assert.equal((await pending).detectedLanguage, 'de');
    assert.equal(created, 1);
  } finally {
    globalThis.LanguageDetector = previousDetector;
    globalThis.window = previousWindow;
  }
});
