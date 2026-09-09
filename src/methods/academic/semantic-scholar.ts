import { BaseMethod } from '../base.js';
import type { SearchResult, MethodConfig } from '../../types/index.js';

/**
 * Semantic Scholar API — the most powerful FREE academic API.
 *
 * 超越 Kimi 的关键：Kimi 只用 Google Scholar（无官方 API），
 * 而 Semantic Scholar 提供：
 *   - 免费、无需 API key（有 rate limit）
 *   - 引用图谱 (references + citations)
 *   - 论文嵌入向量 (SPECTER)
 *   - 作者消歧
 *   - TL;DR 自动摘要
 *
 * API docs: https://api.semanticscholar.org/api-docs/
 */
export class SemanticScholarMethod extends BaseMethod {
  readonly name = 'semantic-scholar';
  readonly config: MethodConfig = {
    name: 'semantic-scholar',
    description: 'Search Semantic Scholar for papers with citation graph, author info, and TLDR',
    supportedParams: ['query', 'fields', 'maxResults', 'year', 'openAccessOnly', 'fieldsOfStudy'],
  };

  private baseUrl = 'https://api.semanticscholar.org/graph/v1';
  private apiKey?: string;

  constructor(apiKey?: string) {
    super();
    this.apiKey = apiKey;
  }

  async execute(params: Record<string, unknown>): Promise<SearchResult[]> {
    const query = params.query as string;
    const maxResults = (params.maxResults as number) ?? 10;
    const year = params.year as string | undefined;
    const openAccessOnly = params.openAccessOnly as boolean | undefined;
    const fieldsOfStudy = params.fieldsOfStudy as string | undefined;

    const fields = 'paperId,title,abstract,authors,year,citationCount,referenceCount,isOpenAccess,openAccessPdf,tldr,externalIds';

    const url = new URL(`${this.baseUrl}/paper/search`);
    url.searchParams.set('query', query);
    url.searchParams.set('limit', String(maxResults));
    url.searchParams.set('fields', fields);
    if (year) url.searchParams.set('year', year);
    if (openAccessOnly) url.searchParams.set('openAccessPdf', '');
    if (fieldsOfStudy) url.searchParams.set('fieldsOfStudy', fieldsOfStudy);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['x-api-key'] = this.apiKey;

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) throw new Error(`Semantic Scholar API error: ${res.status} ${await res.text()}`);

    const data = (await res.json()) as SemanticScholarResponse;
    return this.mapResults(data);
  }

  /** Fetch citation graph for a specific paper */
  async getCitations(paperId: string, limit = 20): Promise<SearchResult[]> {
    const url = `${this.baseUrl}/paper/${paperId}/citations?fields=title,abstract,authors,year,citationCount&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = (await res.json()) as { data: { citingPaper: Paper }[] };
    return data.data.map((d) => this.paperToResult(d.citingPaper, 'academic:s2:citing'));
  }

  /** Fetch references for a specific paper */
  async getReferences(paperId: string, limit = 20): Promise<SearchResult[]> {
    const url = `${this.baseUrl}/paper/${paperId}/references?fields=title,abstract,authors,year,citationCount&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = (await res.json()) as { data: { citedPaper: Paper }[] };
    return data.data.map((d) => this.paperToResult(d.citedPaper, 'academic:s2:ref'));
  }

  private mapResults(data: SemanticScholarResponse): SearchResult[] {
    return (data.data ?? []).map((paper) => this.paperToResult(paper, 'academic:semantic-scholar'));
  }

  private paperToResult(paper: Paper, source: string): SearchResult {
    const tldr = paper.tldr?.text ?? '';
    const abstract = paper.abstract ?? '';
    const snippet = tldr || abstract;

    return {
      filePath: paper.openAccessPdf?.url ?? `https://www.semanticscholar.org/paper/${paper.paperId}`,
      lines: [0],
      snippet: `${paper.title ?? 'Untitled'}\n\n${snippet}`,
      score: this.computeScore(paper),
      source,
      metadata: {
        paperId: paper.paperId,
        title: paper.title,
        authors: paper.authors?.map((a: { name: string }) => a.name),
        year: paper.year,
        citationCount: paper.citationCount,
        referenceCount: paper.referenceCount,
        isOpenAccess: paper.isOpenAccess,
        pdfUrl: paper.openAccessPdf?.url,
        doi: paper.externalIds?.DOI,
        arxivId: paper.externalIds?.ArXiv,
        tldr: tldr,
      },
    };
  }

  private computeScore(paper: Paper): number {
    let score = 0.5;
    if (paper.citationCount && paper.citationCount > 100) score += 0.2;
    else if (paper.citationCount && paper.citationCount > 10) score += 0.1;
    if (paper.isOpenAccess) score += 0.1;
    if (paper.tldr) score += 0.05;
    if (paper.year && paper.year >= new Date().getFullYear() - 2) score += 0.1;
    return Math.min(score, 1);
  }
}

interface Paper {
  paperId: string;
  title?: string;
  abstract?: string;
  authors?: { name: string }[];
  year?: number;
  citationCount?: number;
  referenceCount?: number;
  isOpenAccess?: boolean;
  openAccessPdf?: { url: string };
  tldr?: { text: string };
  externalIds?: { DOI?: string; ArXiv?: string };
}

interface SemanticScholarResponse {
  total: number;
  data: Paper[];
}
