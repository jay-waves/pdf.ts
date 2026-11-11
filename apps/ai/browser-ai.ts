import { buildLlmPrompt } from "./ai-prompt";
import { readAiStream } from './ai-stream';
import type { AiConfig, AiConfigUpdate, AiRequest, AiService } from './types';

export const AI_STORAGE_KEY = 'pdf.ts:ai-config';
import { createDefaultAiConfig, DEFAULT_AI_PROMPT } from './config';

export function normalizeAiEndpoint(value: string) {
  const url = new URL(value.trim());
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((!localHttp && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) {
    throw new Error('Use HTTPS, or HTTP on localhost, 127.0.0.1, or [::1], without credentials, query, or fragment.');
  }
  return url.href.replace(/\/+$/, '');
}

// The closure limits accidental exposure; it is not a security boundary against XSS.
export function createBrowserAi(storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, send: typeof fetch = (...args) => fetch(...args)): AiService {
  let config = createDefaultAiConfig();
  let apiKey = '';
  let initialized = false;
  let generation = 0;
  function initialize() {
    if (initialized) return;
    initialized = true;
    try {
      const saved = JSON.parse(storage().getItem(AI_STORAGE_KEY) ?? 'null');
      if (!saved || typeof saved.model !== 'string' || typeof saved.prompt !== 'string') return;
      config = { ...createDefaultAiConfig(), model: saved.model, prompt: saved.prompt, baseUrl: normalizeAiEndpoint(saved.baseUrl), rememberApiKey: saved.rememberApiKey === true };
      if (config.rememberApiKey && typeof saved.apiKey === 'string') apiKey = saved.apiKey;
    } catch { /* Storage may be unavailable; memory-only requests still work. */ }
  }
  return {
    async getConfig(): Promise<AiConfig> {
      initialize();
      return { ...config, apiKeyConfigured: Boolean(apiKey) };
    },
    async configure(update: AiConfigUpdate) {
      initialize();
      const next = update.reset ? { ...createDefaultAiConfig(), prompt: config.prompt } : { ...config };
      if (update.model !== undefined) next.model = update.model.trim();
      if (update.baseUrl !== undefined) next.baseUrl = normalizeAiEndpoint(update.baseUrl);
      if (update.prompt !== undefined) next.prompt = update.prompt.trim() ? update.prompt : DEFAULT_AI_PROMPT;
      if (update.rememberApiKey !== undefined) next.rememberApiKey = update.rememberApiKey;
      // Never reuse an existing credential after changing its destination, including its path.
      let nextKey = update.reset || next.baseUrl !== config.baseUrl ? '' : apiKey;
      if (update.apiKey !== undefined) nextKey = update.apiKey.trim();
      if (update.reset || next.model !== config.model) { next.totalTokens = 0; generation++; }
      config = next;
      apiKey = nextKey;
      try {
        // Remove the previous credential before saving non-secret settings or a replacement.
        storage().removeItem(AI_STORAGE_KEY);
        storage().setItem(AI_STORAGE_KEY, JSON.stringify({
          model: next.model, baseUrl: next.baseUrl, prompt: next.prompt,
          rememberApiKey: next.rememberApiKey,
          ...(next.rememberApiKey && nextKey ? { apiKey: nextKey } : {}),
        }));
      } catch {
        throw new Error('Settings are active in memory, but browser storage could not be updated. Clear site data to remove any previously saved key.');
      }
    },
    async request(request: AiRequest, signal?: AbortSignal, onText?: (text: string) => void) {
      initialize();
      if (!apiKey || !config.model) throw new Error('Configure the model, Base URL, and API key in Developer > LLM.');
      if (!request.text.trim()) throw new Error('Enter a message first.');
      const snapshot = { ...config };
      const usageGeneration = generation;
      const translating = request.task === 'translate';
      const history = translating ? [] : request.history ?? [];
      const messages = [
        { role: 'system', content: translating
          ? 'Translate according to the provided instructions. Output only the translation.'
          : "Answer in as few words as possible, clearly and elegantly. Give only the essential explanation; omit introductions, repetition, and summaries. Use plain text, no Markdown. Follow the user's instructions and use conversation context for follow-up questions." },
        ...history,
        { role: 'user', content: translating ? buildLlmPrompt(snapshot.prompt, request.text) : request.text },
      ];
      const recordUsage = (tokens: number) => {
        if (generation === usageGeneration && Number.isSafeInteger(tokens) && tokens > 0) config.totalTokens += tokens;
      };
      let response: Response;
      try {
        response = await send(`${normalizeAiEndpoint(snapshot.baseUrl)}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          // Explicitly disable reasoning through the OpenAI-compatible request body.
          // Do not retry without this setting if the provider rejects it.
          body: JSON.stringify({ model: snapshot.model, messages, reasoning_effort: 'none', stream: Boolean(onText), ...(onText ? { stream_options: { include_usage: true } } : {}) }),
          signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
        });
      } catch {
        if (signal?.aborted) throw new DOMException('Request aborted.', 'AbortError');
        throw new Error('Could not reach the LLM provider. Check the endpoint and browser CORS or local-network permissions. Redirects are blocked.');
      }
      // Do not display provider bodies: they may echo credentials or request content.
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`The LLM provider rejected the request (${response.status}). Check the model, endpoint, and key.`);
      }
      if (response.headers.get('Content-Type')?.includes('text/event-stream')) {
        if (!response.body) throw new Error('The LLM provider returned an empty stream.');
        return readAiStream(response.body, onText, recordUsage);
      }
      let result;
      try { result = await response.json(); } catch { throw new Error('The LLM provider returned an invalid response.'); }
      const text = result?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw new Error('The LLM provider returned an empty response.');
      recordUsage(result?.usage?.total_tokens);
      onText?.(text);
      return text;
    },
  };
}

export const browserAiCapabilities = createBrowserAi(() => localStorage);
