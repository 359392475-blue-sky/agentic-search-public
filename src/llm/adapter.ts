/**
 * LLM adapter interface — abstracts the LLM provider.
 */
export interface LLMAdapter {
  /** Send a prompt, get a text completion */
  complete(prompt: string): Promise<string>;
  /** Structured output: send a prompt, get parsed JSON */
  completeJSON<T>(prompt: string): Promise<T>;
}

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'ollama' | 'custom';
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}
