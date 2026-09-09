import { BaseMethod } from '../base.js';
import type { SearchResult, MethodConfig } from '../../types/index.js';

/**
 * arXiv API method — searches preprints via the official arXiv API.
 * Returns structured metadata + can fetch full text (PDF → text extraction).
 *
 * API docs: https://info.arxiv.org/help/api/index.html
 */
export class ArxivMethod extends BaseMethod {
  readonly name = 'arxiv';
  readonly config: MethodConfig = {
    name: 'arxiv',
    description: 'Search arXiv preprint database for academic papers',
    supportedParams: ['query', 'category', 'maxResults', 'sortBy', 'startDate', 'endDate'],
  };

  private baseUrl = 'http://export.arxiv.org/api/query';

  async execute(params: Record<string, unknown>): Promise<SearchResult[]> {
    const query = params.query as string;
    const category = params.category as string | undefined;
    const maxResults = (params.maxResults as number) ?? 10;
    const sortBy = (params.sortBy as string) ?? 'relevance';

    let searchQuery = `all:${query}`;
    if (category) searchQuery = `cat:${category} AND all:${query}`;

    const url = new URL(this.baseUrl);
    url.searchParams.set('search_query', searchQuery);
    url.searchParams.set('start', '0');
    url.searchParams.set('max_results', String(maxResults));
    url.searchParams.set('sortBy', sortBy);
    url.searchParams.set('sortOrder', 'descending');

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`arXiv API error: ${res.status}`);

    const xml = await res.text();
    return this.parseAtomFeed(xml);
  }

  private parseAtomFeed(xml: string): SearchResult[] {
    const results: SearchResult[] = [];
    const entries = xml.split('<entry>').slice(1);

    for (const entry of entries) {
      const title = this.extractTag(entry, 'title')?.replace(/\s+/g, ' ').trim();
      const summary = this.extractTag(entry, 'summary')?.replace(/\s+/g, ' ').trim();
      const id = this.extractTag(entry, 'id');
      const published = this.extractTag(entry, 'published');
      const authors = [...entry.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]);

      const pdfLink = entry.match(/href="([^"]+)" title="pdf"/)?.[1];

      if (title && summary) {
        results.push({
          filePath: id ?? '',
          lines: [0],
          snippet: `${title}\n\n${summary}`,
          score: 0.7,
          source: 'academic:arxiv',
          metadata: {
            title,
            authors,
            published,
            pdfUrl: pdfLink,
            arxivId: id?.split('/abs/')?.pop(),
          },
        });
      }
    }

    return results;
  }

  private extractTag(xml: string, tag: string): string | undefined {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
    return match?.[1];
  }
}
