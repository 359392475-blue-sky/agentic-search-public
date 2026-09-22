import { BaseMethod } from './base.js';
import type { SearchResult, MethodConfig } from '../types/index.js';

/**
 * Google search via Serper.dev API — 1-2s response time, structured JSON results.
 * Free tier: 2500 queries (one-time). Paid: $1/1000 queries.
 * Replaces slow Playwright-based Google/Bing scraping (5-25s).
 */
export class SerperSearchMethod extends BaseMethod {
  readonly name = 'serper';
  readonly config: MethodConfig = {
    name: 'serper',
    description: 'Google search via Serper API — fast, structured JSON results',
    supportedParams: ['query', 'maxResults', 'gl', 'hl'],
  };

  private apiKey: string;

  constructor() {
    super();
    this.apiKey = (process.env.SERPER_API_KEY ?? '').trim();
  }

  get isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  async execute(params: Record<string, unknown>): Promise<SearchResult[]> {
    if (!this.apiKey) {
      throw new Error('Serper search requires the SERPER_API_KEY environment variable.');
    }

    const query = (params.query as string) ?? '';
    const maxResults = (params.maxResults as number) ?? 10;
    if (!query) return [];

    const gl = (params.gl as string) ?? (/[\u4e00-\u9fff]/.test(query) ? 'cn' : 'us');
    const hl = (params.hl as string) ?? (/[\u4e00-\u9fff]/.test(query) ? 'zh-cn' : 'en');

    try {
      const resp = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: query,
          num: Math.min(maxResults, 20),
          gl, hl,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!resp.ok) {
        console.error(`[Serper] HTTP ${resp.status}`);
        return [];
      }

      const data = await resp.json() as SerperResponse;
      const results: SearchResult[] = [];

      // Knowledge graph (highest quality — direct answer)
      if (data.knowledgeGraph) {
        const kg = data.knowledgeGraph;
        results.push({
          filePath: kg.website || kg.descriptionLink || '',
          lines: [0],
          snippet: `${kg.title || ''}\n${kg.description || ''}\n${Object.entries(kg.attributes || {}).map(([k, v]) => `${k}: ${v}`).join('\n')}`,
          score: 1.0,
          source: 'serper',
          metadata: { title: kg.title || '', source: 'knowledge-graph', type: kg.type || '' },
        });
      }

      // Organic results
      for (const item of (data.organic || []).slice(0, maxResults)) {
        results.push({
          filePath: item.link,
          lines: [0],
          snippet: item.snippet || '',
          score: 0.5 + (1 - item.position / 20) * 0.3,
          source: 'serper',
          metadata: {
            title: item.title || '',
            date: item.date,
            sitelinks: item.sitelinks,
          },
        });
      }

      // People Also Ask (supplementary)
      for (const paa of (data.peopleAlsoAsk || []).slice(0, 3)) {
        if (paa.link && paa.snippet) {
          results.push({
            filePath: paa.link,
            lines: [0],
            snippet: `${paa.question}\n${paa.snippet}`,
            score: 0.4,
            source: 'serper',
            metadata: { title: paa.title || paa.question || '' },
          });
        }
      }

      return results;
    } catch (e: any) {
      console.error(`[Serper] ${e.message}`);
      return [];
    }
  }
}

interface SerperResponse {
  organic?: Array<{
    title: string;
    link: string;
    snippet: string;
    position: number;
    date?: string;
    sitelinks?: Array<{ title: string; link: string }>;
  }>;
  knowledgeGraph?: {
    title?: string;
    type?: string;
    description?: string;
    descriptionLink?: string;
    website?: string;
    attributes?: Record<string, string>;
  };
  peopleAlsoAsk?: Array<{
    question: string;
    snippet: string;
    title?: string;
    link: string;
  }>;
}
