import type { PlatformTranslationResult } from './types';

export function translateExternally(text: string): Promise<PlatformTranslationResult> {
  const query = new URLSearchParams({ sl: 'auto', tl: 'zh-CN', text, op: 'translate' });
  return Promise.resolve({
    type: 'external',
    url: `https://translate.google.com/?${query}`,
  });
}
