import type { PlatformTranslationResult } from './types';

type ModelPolicy = 'allow-download' | 'external-fallback';
type TranslationAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

const TRANSLATION_TARGET_LANGUAGE = 'zh';
const translatorCache = new Map<string, Promise<ChromeTranslator>>();
let languageDetectorPromise: Promise<ChromeLanguageDetector> | null = null;

interface ChromeTranslator {
  translate(text: string): Promise<string>;
}

interface ChromeTranslatorConstructor {
  availability(options: {
    sourceLanguage: string;
    targetLanguage: string;
  }): Promise<TranslationAvailability>;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
  }): Promise<ChromeTranslator>;
}

interface ChromeLanguageDetector {
  detect(text: string): Promise<Array<{ detectedLanguage: string }>>;
}

interface ChromeLanguageDetectorConstructor {
  availability(): Promise<TranslationAvailability>;
  create(): Promise<ChromeLanguageDetector>;
}

class ModelUnavailableError extends Error {}

function googleTranslate(text: string): PlatformTranslationResult {
  const query = new URLSearchParams({ sl: 'auto', tl: 'zh-CN', text, op: 'translate' });
  return {
    type: 'external',
    url: `https://translate.google.com/?${query}`,
  };
}

function ensureModelCanRun(
  availability: TranslationAvailability,
  modelPolicy: ModelPolicy,
) {
  if (
    availability === 'unavailable' ||
    (modelPolicy === 'external-fallback' && availability !== 'available')
  ) {
    throw new ModelUnavailableError();
  }
}

async function detectSourceLanguage(text: string, modelPolicy: ModelPolicy) {
  const LanguageDetector = (
    globalThis as typeof globalThis & { LanguageDetector?: ChromeLanguageDetectorConstructor }
  ).LanguageDetector;
  if (!LanguageDetector) throw new ModelUnavailableError();

  if (!languageDetectorPromise) {
    languageDetectorPromise = (async () => {
      ensureModelCanRun(await LanguageDetector.availability(), modelPolicy);
      return LanguageDetector.create();
    })();
    languageDetectorPromise.catch(() => {
      languageDetectorPromise = null;
    });
  }

  const detector = await languageDetectorPromise;
  const [bestMatch] = await detector.detect(text);
  return bestMatch?.detectedLanguage || 'en';
}

async function getTranslator(
  sourceLanguage: string,
  targetLanguage: string,
  modelPolicy: ModelPolicy,
) {
  const cacheKey = `${modelPolicy}:${sourceLanguage}:${targetLanguage}`;
  let translatorPromise = translatorCache.get(cacheKey);
  if (!translatorPromise) {
    const Translator = (
      globalThis as typeof globalThis & { Translator?: ChromeTranslatorConstructor }
    ).Translator;
    if (!Translator) throw new ModelUnavailableError();

    translatorPromise = (async () => {
      ensureModelCanRun(
        await Translator.availability({ sourceLanguage, targetLanguage }),
        modelPolicy,
      );
      return Translator.create({ sourceLanguage, targetLanguage });
    })();
    translatorCache.set(cacheKey, translatorPromise);
    translatorPromise.catch(() => translatorCache.delete(cacheKey));
  }
  return translatorPromise;
}

function createBrowserTranslator(modelPolicy: ModelPolicy) {
  return async (text: string): Promise<PlatformTranslationResult> => {
    try {
      const sourceLanguage = await detectSourceLanguage(text, modelPolicy);
      if (sourceLanguage.toLowerCase().startsWith('zh')) {
        return { type: 'inline', text };
      }
      const translator = await getTranslator(
        sourceLanguage,
        TRANSLATION_TARGET_LANGUAGE,
        modelPolicy,
      );
      return {
        type: 'inline',
        text: await translator.translate(text),
      };
    } catch (error) {
      if (error instanceof ModelUnavailableError) return googleTranslate(text);
      throw error;
    }
  };
}

export const translateWithInstalledModel = createBrowserTranslator('external-fallback');
export const translateWithModelDownload = createBrowserTranslator('allow-download');
