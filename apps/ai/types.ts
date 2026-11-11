export type AiConfig = { model: string; baseUrl: string; apiKeyConfigured: boolean; rememberApiKey: boolean; prompt: string; totalTokens: number };
export type AiConfigUpdate = Partial<Omit<AiConfig, 'apiKeyConfigured' | 'totalTokens'>> & { apiKey?: string; reset?: boolean };

export type AiMessage = { role: 'user' | 'assistant'; content: string };

export type AiRequest = {
  history?: AiMessage[];
  text: string;
  task?: 'translate';
};

/** Complete AI capability; credential storage and transport remain internal. */
export interface AiService {
  request(request: AiRequest, signal?: AbortSignal, onText?: (text: string) => void): Promise<string>;
  getConfig(): Promise<AiConfig>;
  configure(update: AiConfigUpdate): Promise<void>;
}
