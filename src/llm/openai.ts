import type { LLMAdapter, LLMConfig } from './adapter.js';

/**
 * OpenAI-compatible adapter — works with OpenAI, Azure OpenAI,
 * or any compatible API (vLLM, LiteLLM, etc.)
 */
export class OpenAIAdapter implements LLMAdapter {
  private baseUrl: string;
  private model: string;
  private apiKey: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: LLMConfig) {
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
    this.model = config.model;
    this.apiKey = config.apiKey ?? '';
    this.temperature = config.temperature ?? 0.2;
    this.maxTokens = config.maxTokens ?? 2048;
  }

  async complete(prompt: string): Promise<string> {
    if (!this.apiKey) throw new Error('LLM API key not configured');

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: this.temperature,
            max_tokens: this.maxTokens,
          }),
          signal: AbortSignal.timeout(60_000),
        });

        if (res.status === 429 || res.status >= 500) {
          if (attempt === 0) { await new Promise(r => setTimeout(r, 2000)); continue; }
        }
        if (!res.ok) throw new Error(`LLM error: ${res.status} ${(await res.text()).slice(0, 200)}`);

        const data = (await res.json()) as { choices: { message: { content: string } }[] };
        return data.choices?.[0]?.message?.content ?? '';
      } catch (e: any) {
        if (attempt === 1 || e.message?.includes('not configured')) throw e;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    throw new Error('LLM request failed after retries');
  }

  async completeJSON<T>(prompt: string): Promise<T> {
    const raw = await this.complete(prompt + '\n\nRespond with valid JSON only.');
    const match = raw.match(/```json\s*([\s\S]*?)```/)
      ?? raw.match(/```\s*([\s\S]*?)```/)
      ?? raw.match(/(\{[\s\S]*\})/);
    const jsonStr = match?.[1] ?? raw;
    try {
      return JSON.parse(jsonStr.trim()) as T;
    } catch {
      const cleaned = jsonStr.replace(/,\s*([}\]])/g, '$1').replace(/[\x00-\x1f]/g, '').trim();
      return JSON.parse(cleaned) as T;
    }
  }
}
