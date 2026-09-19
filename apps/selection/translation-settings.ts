export const TRANSLATION_TARGET_LANGUAGE_PREFERENCE = 'pdf.ts:translation-target-language';
export const TRANSLATION_SOURCE_LANGUAGE_PREFERENCE = 'pdf.ts:translation-source-language';
export const TRANSLATOR_PREFERENCE = 'pdf.ts:translator';
export type TranslatorMode = 'builtin' | 'llm' | 'google';

export function getTranslatorMode(read: (key: string) => string | null, supportsLlm: boolean): TranslatorMode {
  const mode = read(TRANSLATOR_PREFERENCE);
  if (mode === 'google') return mode;
  if (mode === 'llm' && supportsLlm) return mode;
  return 'builtin';
}

export function googleTranslationUrl(text: string, targetLanguage: string, sourceLanguage = 'auto') {
  const url = new URL('https://translate.google.com/');
  url.search = new URLSearchParams({ sl: sourceLanguage, tl: targetLanguage, text, op: 'translate' }).toString();
  return url.href;
}

export function getBrowserTranslationLanguage() {
  return normalizeTranslationLanguage(
    navigator.languages[0] ?? navigator.language,
    'en',
  );
}

export function normalizeTranslationLanguage(value: unknown, fallback?: string) {
  const language = typeof value === 'string' ? value.trim().replaceAll('_', '-') : '';
  try {
    if (language) return Intl.getCanonicalLocales(language)[0] ?? fallback ?? 'en';
  } catch {
    // Invalid persisted values use the fallback; invalid user input is reported below.
  }
  if (fallback) return fallback;
  throw new TypeError("Enter a valid BCP 47 language tag, such as 'en', 'zh-CN', or 'ja'.");
}

export function getTranslationTargetLanguage(readPreference: (key: string) => string | null) {
  return getConfiguredTranslationTargetLanguage(readPreference) ?? getBrowserTranslationLanguage();
}

export function getConfiguredTranslationTargetLanguage(
  readPreference: (key: string) => string | null,
) {
  const configured = readPreference(TRANSLATION_TARGET_LANGUAGE_PREFERENCE)?.trim();
  if (!configured) return undefined;
  const language = normalizeTranslationLanguage(configured);
  return language === getBrowserTranslationLanguage() ? undefined : language;
}

export function getTranslationSourceLanguage(readPreference: (key: string) => string | null) {
  const configured = readPreference(TRANSLATION_SOURCE_LANGUAGE_PREFERENCE)?.trim();
  return configured ? normalizeTranslationLanguage(configured) : undefined;
}

export function getLanguageName(language: string) {
  try {
    return new Intl.DisplayNames([navigator.language], { type: 'language' }).of(language) ?? language;
  } catch {
    return language;
  }
}
