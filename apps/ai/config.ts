import type { AiConfig } from './types';

export const DEFAULT_AI_PROMPT = 'Translate the following text into {{browserDefault}}. Preserve meaning, tone, names, formatting, and paragraph breaks. Output only the translation.\n\n{{selectedText}}';
export const createDefaultAiConfig = (): AiConfig => ({ model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', prompt: DEFAULT_AI_PROMPT, apiKeyConfigured: false, rememberApiKey: false, totalTokens: 0 });
