import { LanguageDetectionDownloadRequired } from './types';
import type {
  PlatformLanguageDetectionResult,
  PlatformTranslationAvailability,
  PlatformTranslationOptions,
  PlatformTranslationResult,
} from './types';

const OPERATION_TIMEOUT_MS = 60 * 1000;
const AVAILABILITY_TIMEOUT_MS = 5 * 1000;
let languageDetectorPromise: Promise<ChromeLanguageDetector> | null = null;
let cachedTranslator: {
  languagePairKey: string;
  session: ChromeTranslator;
} | null = null;

interface DownloadMonitor {
  addEventListener(type: 'downloadprogress', listener: (event: { loaded: number }) => void): void;
}

interface ChromeTranslator {
  destroy?(): void;
  translate(text: string, options?: { signal?: AbortSignal }): Promise<string>;
}

interface ChromeTranslatorConstructor {
  availability(options: {
    sourceLanguage: string;
    targetLanguage: string;
  }): Promise<PlatformTranslationAvailability>;
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
  availability(): Promise<PlatformTranslationAvailability>;
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
    // The Translator API expects a script for an otherwise-unspecified
    // Chinese language. Preserve explicit scripts, regions, and lzh instead
    // of replacing the user's requested language.
    if (locale.baseName === 'zh') return 'zh-Hans';
    return locale.baseName;
  } catch {
    return baseLanguage(language);
  }
}

function isSameTranslationLanguage(sourceLanguage: string, targetLanguage: string) {
  if (sourceLanguage === targetLanguage) return true;
  try {
    const source = new Intl.Locale(sourceLanguage).maximize();
    const target = new Intl.Locale(targetLanguage).maximize();
    return source.language === target.language && source.script === target.script;
  } catch {
    return baseLanguage(sourceLanguage) === baseLanguage(targetLanguage);
  }
}

function withTimeout<Result>(
  promise: Promise<Result>,
  message: string,
  onTimeout?: () => void,
  timeoutMs = OPERATION_TIMEOUT_MS,
) {
  return new Promise<Result>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error(message));
      onTimeout?.();
    }, timeoutMs);
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

async function detectSourceLanguage(text: string, allowModelDownload = false) {
  const LanguageDetector = (
    globalThis as typeof globalThis & { LanguageDetector?: ChromeLanguageDetectorConstructor }
  ).LanguageDetector;
  if (!LanguageDetector) {
    throw new Error('Built-in language detection is not available in this browser.');
  }

  if (!languageDetectorPromise) {
    languageDetectorPromise = (async () => {
      if (allowModelDownload) {
        return withTimeout(LanguageDetector.create(), 'Language detection took too long.');
      }
      const availability = await withTimeout(
        LanguageDetector.availability(),
        'The browser did not report language detection availability.',
        undefined,
        AVAILABILITY_TIMEOUT_MS,
      );
      if (availability === 'unavailable') {
        throw new Error('The built-in language detection model is not available in this browser.');
      }
      if (availability !== 'available') {
        throw new LanguageDetectionDownloadRequired(availability === 'downloading', () => detectSourceLanguage(text, true));
      }
      return withTimeout(LanguageDetector.create(), 'Language detection took too long.');
    })();
    languageDetectorPromise.catch(() => {
      languageDetectorPromise = null;
    });
  }

  const detector = await languageDetectorPromise;
  const [bestMatch] = await withTimeout(detector.detect(text), 'Language detection took too long.');
  if (!bestMatch || bestMatch.detectedLanguage === 'und') {
    throw new Error('The source language could not be detected.');
  }
  return bestMatch;
}

export async function detectLanguageWithBrowserModel(
  text: string,
): Promise<PlatformLanguageDetectionResult> {
  return detectSourceLanguage(text);
}

export async function getBrowserTranslationAvailability(
  sourceLanguage: string,
  targetLanguage: string,
) {
  const Translator = (
    globalThis as typeof globalThis & { Translator?: ChromeTranslatorConstructor }
  ).Translator;
  if (!Translator) return 'unavailable';
  return withTimeout(
    Translator.availability({
      sourceLanguage: translationModelLanguage(sourceLanguage),
      targetLanguage: translationModelLanguage(targetLanguage),
    }),
    'The browser did not report translation model availability.',
    undefined,
    AVAILABILITY_TIMEOUT_MS,
  );
}

export async function translateWithBrowserModel(
  text: string,
  options: PlatformTranslationOptions,
): Promise<PlatformTranslationResult> {
  const detection = options.sourceLanguage
    ? { detectedLanguage: options.sourceLanguage }
    : await detectSourceLanguage(text);

  const sourceLanguage = translationModelLanguage(detection.detectedLanguage);
  const targetLanguage = translationModelLanguage(options.targetLanguage);
  if (isSameTranslationLanguage(sourceLanguage, targetLanguage)) {
    return { type: 'inline', text };
  }

  const Translator = (
    globalThis as typeof globalThis & { Translator?: ChromeTranslatorConstructor }
  ).Translator;
  if (!Translator) {
    throw new Error('Built-in translation is not available in this browser.');
  }

  const languagePair = { sourceLanguage, targetLanguage };
  const languagePairKey = `${sourceLanguage}\u0000${targetLanguage}`;
  let translator = cachedTranslator?.languagePairKey === languagePairKey
    ? cachedTranslator.session
    : undefined;
  // Stored consent cannot replace the transient activation from this click.
  if (!translator && !options.allowModelDownload) {
    const availability = await withTimeout(
      Translator.availability(languagePair),
      'The browser did not report translation model availability.',
      undefined,
      AVAILABILITY_TIMEOUT_MS,
    );
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
  try {
    if (!translator) {
      translator = await withTimeout(Translator.create({
        ...languagePair,
        signal: controller.signal,
        monitor(monitor) {
          monitor.addEventListener('downloadprogress', ({ loaded }) => {
            options.onDownloadProgress?.(Math.max(0, Math.min(1, loaded)));
          });
        },
      }), 'The built-in translation model took too long to become ready.', abort);
      cachedTranslator?.session.destroy?.();
      cachedTranslator = { languagePairKey, session: translator };
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
  }
}

export const browserTranslationCapabilities = {
  detectLanguage: detectLanguageWithBrowserModel,
  getTranslationAvailability: getBrowserTranslationAvailability,
  translate: translateWithBrowserModel,
};
