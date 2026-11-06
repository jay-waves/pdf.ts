export const TRANSLATION_ENABLED_PREFERENCE = 'pdf.ts:translation-enabled';
export const LLM_ENABLED_PREFERENCE = 'pdf.ts:llm-enabled';

export function isTranslationEnabled(read: (key: string) => string | null) {
  return read(TRANSLATION_ENABLED_PREFERENCE) !== 'false';
}

export function isLlmEnabled(read: (key: string) => string | null) {
  return read(LLM_ENABLED_PREFERENCE) !== 'false';
}

export function googleTranslationUrl(text: string) {
  const url = new URL('https://translate.google.com/');
  url.search = new URLSearchParams({ sl: 'auto', text, op: 'translate' }).toString();
  return url.href;
}

export function runTranslateAction({ text, llmEnabled, openLlm, openExternal }: {
  text: string;
  llmEnabled: boolean;
  openLlm(): void;
  openExternal(url: string): void;
}) {
  if (llmEnabled) openLlm();
  else if (text.trim()) openExternal(googleTranslationUrl(text));
}
