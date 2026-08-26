import type {
  PlatformTranslationOptions,
  PlatformTranslationResult,
} from './types';

type TranslationAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

const OPERATION_TIMEOUT_MS = 3 * 60 * 1000;
let languageDetectorPromise: Promise<ChromeLanguageDetector> | null = null;

interface DownloadMonitor {
  addEventListener(type: 'downloadprogress', listener: (event: { loaded: number }) => void): void;
}

interface ChromeTranslator {
  destroy?(): void;
  ready?: Promise<void>;
  translate(text: string, options?: { signal?: AbortSignal }): Promise<string>;
}

interface ChromeTranslatorConstructor {
  availability(options: {
    sourceLanguage: string;
    targetLanguage: string;
  }): Promise<TranslationAvailability>;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
    signal?: AbortSignal;
    monitor?(monitor: DownloadMonitor): void;
  }): Promise<ChromeTranslator>;
}

interface ChromeLanguageDetector {
  detect(text: string): Promise<Array<{ confidence?: number; detectedLanguage: string }>>;
}

interface ChromeLanguageDetectorConstructor {
  availability(): Promise<TranslationAvailability>;
  create(): Promise<ChromeLanguageDetector>;
}

function baseLanguage(language: string) {
  try {
    return new Intl.Locale(language).language;
  } catch {
    return language.toLowerCase().split('-')[0];
  }
}

function translationModelLanguage(language: string) {
  try {
    const locale = new Intl.Locale(language);
    if (locale.language === 'zh') {
      return locale.script === 'Hant' || ['HK', 'MO', 'TW'].includes(locale.region ?? '')
        ? 'zh-Hant'
        : 'zh';
    }
    return locale.language;
  } catch {
    return baseLanguage(language);
  }
}

function withTimeout<Result>(promise: Promise<Result>, message: string, onTimeout?: () => void) {
  return new Promise<Result>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error(message));
      onTimeout?.();
    }, OPERATION_TIMEOUT_MS);
    promise.then(
      (result) => {
        window.clearTimeout(timeout);
        resolve(result);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function detectSourceLanguage(text: string) {
  const LanguageDetector = (
    globalThis as typeof globalThis & { LanguageDetector?: ChromeLanguageDetectorConstructor }
  ).LanguageDetector;
  if (!LanguageDetector) {
    throw new Error('Built-in language detection is not available in this browser.');
  }

  if (!languageDetectorPromise) {
    languageDetectorPromise = (async () => {
      const availability = await LanguageDetector.availability();
      if (availability === 'unavailable') {
        throw new Error('The built-in language detection model is not available in this browser.');
      }
      return withTimeout(LanguageDetector.create(), 'Language detection took too long.');
    })();
    languageDetectorPromise.catch(() => {
      languageDetectorPromise = null;
    });
  }

  const detector = await languageDetectorPromise;
  const [bestMatch] = await withTimeout(detector.detect(text), 'Language detection took too long.');
  return bestMatch?.confidence !== undefined && bestMatch.confidence < 0.45
    ? 'en'
    : bestMatch?.detectedLanguage || 'en';
}

export async function translateWithBrowserModel(
  text: string,
  options: PlatformTranslationOptions,
): Promise<PlatformTranslationResult> {
  const sourceLanguage = translationModelLanguage(
    options.sourceLanguage ?? await detectSourceLanguage(text),
  );
  const targetLanguage = translationModelLanguage(options.targetLanguage);
  if (baseLanguage(sourceLanguage) === baseLanguage(targetLanguage)) {
    return { type: 'inline', text };
  }

  const Translator = (
    globalThis as typeof globalThis & { Translator?: ChromeTranslatorConstructor }
  ).Translator;
  if (!Translator) {
    throw new Error('Built-in translation is not available in this browser.');
  }

  const languagePair = { sourceLanguage, targetLanguage };
  if (!options.allowModelDownload) {
    const availability = await Translator.availability(languagePair);
    if (availability === 'unavailable') {
      throw new Error(`Local translation from ${sourceLanguage} to ${targetLanguage} is not available.`);
    }
    if (availability !== 'available') {
      return {
        type: 'downloadable',
        downloading: availability === 'downloading',
        sourceLanguage,
        targetLanguage,
      };
    }
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  let translator: ChromeTranslator | undefined;
  try {
    translator = await withTimeout(Translator.create({
      ...languagePair,
      signal: controller.signal,
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', ({ loaded }) => {
          options.onDownloadProgress?.(loaded);
        });
      },
    }), 'The built-in translation model took too long to become ready.', abort);
    if (translator.ready) {
      await withTimeout(
        translator.ready,
        'The built-in translation model took too long to become ready.',
        abort,
      );
    }
    return {
      type: 'inline',
      text: await withTimeout(
        translator.translate(text, { signal: controller.signal }),
        'Translation took too long.',
        abort,
      ),
    };
  } finally {
    options.signal?.removeEventListener('abort', abort);
    try {
      translator?.destroy?.();
    } catch {
      // The browser may already have released an aborted translation session.
    }
  }
}

export const browserTranslationCapabilities = {
  translate: translateWithBrowserModel,
};
