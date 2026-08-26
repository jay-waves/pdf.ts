export const TRANSLATION_TARGET_LANGUAGE_PREFERENCE = 'pdf.ts:translation-target-language';

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
  return normalizeTranslationLanguage(
    readPreference(TRANSLATION_TARGET_LANGUAGE_PREFERENCE),
    getBrowserTranslationLanguage(),
  );
}

export function getLanguageName(language: string) {
  try {
    return new Intl.DisplayNames([navigator.language], { type: 'language' }).of(language) ?? language;
  } catch {
    return language;
  }
}
