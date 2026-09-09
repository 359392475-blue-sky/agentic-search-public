/**
 * API-based data sources: HN, OpenAlex, CrossRef, Wikipedia.
 * These are standalone fetch functions, no browser needed.
 */

function log(msg: string) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

// ────────────────────────────────────────────
// HN Algolia
// ────────────────────────────────────────────
export async function fetchHN(query: string): Promise<any[]> {
  try {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&hitsPerPage=6`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'AgenticSearch/1.0' }, signal: AbortSignal.timeout(8_000) });
    if (!resp.ok) return [];
    const data = await resp.json() as any;
    return (data.hits ?? []).filter((h: any) => h.url && h.points > 3).map((h: any, i: number) => ({
      filePath: h.url, lines: [0],
      snippet: `${h.title ?? ''}\n${h.points} 赞 · ${h.num_comments ?? 0} 评论`,
      score: 0.7 - i * 0.05, source: 'HN', metadata: { title: h.title, points: h.points },
    }));
  } catch { return []; }
}

// ────────────────────────────────────────────
// OpenAlex API (free, no key, 250M+ papers)
// ────────────────────────────────────────────
export async function fetchOpenAlex(query: string): Promise<any[]> {
  try {
    const yearMatch = query.match(/\b(20[12]\d)\b/);
    const cleanQuery = query.replace(/\b20[12]\d\b/g, '').trim();
    let filter = 'type:article';
    if (yearMatch) filter += `,publication_year:${yearMatch[1]}`;
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(cleanQuery)}&per_page=10&select=id,title,doi,cited_by_count,publication_year,authorships,primary_location,abstract_inverted_index,relevance_score&filter=${filter}&sort=relevance_score:desc&mailto=agentic-search@example.com`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'AgenticSearch/1.0 (mailto:agentic-search@example.com)' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!resp.ok) return [];
    const data = await resp.json() as any;
    const topScore = data.results?.[0]?.relevance_score ?? 1;
    const works = (data.results ?? []).filter((w: any) =>
      (w.relevance_score ?? 0) >= topScore * 0.3
    ).slice(0, 8);
    return works.map((w: any, i: number) => {
      const title = w.title || '';
      const authors = (w.authorships ?? []).slice(0, 3).map((a: any) => a.author?.display_name).filter(Boolean).join(', ');
      const year = w.publication_year || '';
      const venue = w.primary_location?.source?.display_name || '';
      const doi = w.doi || '';
      const cites = w.cited_by_count || 0;
      let abstract = '';
      if (w.abstract_inverted_index) {
        const pairs: [string, number][] = [];
        for (const [word, positions] of Object.entries(w.abstract_inverted_index as Record<string, number[]>)) {
          for (const pos of positions) pairs.push([word, pos]);
        }
        pairs.sort((a, b) => a[1] - b[1]);
        abstract = pairs.map(p => p[0]).join(' ').slice(0, 500);
      }
      const pageUrl = doi ? `https://doi.org/${doi.replace('https://doi.org/','')}` : w.id || '';
      return {
        filePath: pageUrl, lines: [0],
        snippet: `${title}\n${authors} (${year}) | ${venue} | 被引 ${cites}\n${abstract}`,
        score: Math.min(1.2, cites / 500 + 0.5) - i * 0.03,
        source: 'OpenAlex',
        metadata: { title, authors, year, venue, doi, citations: cites, isAcademic: true },
      };
    });
  } catch (e: any) {
    log(`  [OpenAlex] 失败: ${e.message}`);
    return [];
  }
}

// ────────────────────────────────────────────
// CrossRef API (free, no auth, 150M+ works)
// ────────────────────────────────────────────
export async function fetchCrossRef(query: string): Promise<any[]> {
  try {
    const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=6&sort=relevance&order=desc&select=DOI,title,author,is-referenced-by-count,published,container-title,abstract`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'AgenticSearch/1.0 (mailto:agentic-search@example.com)' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!resp.ok) return [];
    const data = await resp.json() as any;
    const items = data.message?.items ?? [];
    return items.map((item: any, i: number) => {
      const title = (item.title ?? [])[0] || '';
      const authors = (item.author ?? []).slice(0, 3).map((a: any) => `${a.given || ''} ${a.family || ''}`).join(', ');
      const year = item.published?.['date-parts']?.[0]?.[0] || '';
      const journal = (item['container-title'] ?? [])[0] || '';
      const cites = item['is-referenced-by-count'] || 0;
      const doi = item.DOI || '';
      const abstract = (item.abstract || '').replace(/<[^>]+>/g, '').slice(0, 400);
      return {
        filePath: `https://doi.org/${doi}`, lines: [0],
        snippet: `${title}\n${authors} (${year}) | ${journal} | 被引 ${cites}\n${abstract}`,
        score: Math.min(1.1, cites / 500 + 0.4) - i * 0.03,
        source: 'CrossRef',
        metadata: { title, authors, year, journal, doi, citations: cites, isAcademic: true },
      };
    });
  } catch (e: any) {
    log(`  [CrossRef] 失败: ${e.message}`);
    return [];
  }
}

// ────────────────────────────────────────────
// Wikipedia API (free, no key, fast)
// ────────────────────────────────────────────
export async function fetchWikipedia(query: string, lang: string): Promise<any[]> {
  try {
    const apiUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&srprop=snippet|titlesnippet&format=json&origin=*`;
    const resp = await fetch(apiUrl, {
      headers: { 'User-Agent': 'AgenticSearch/1.0' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return [];
    const data = await resp.json() as any;
    const results = (data.query?.search ?? []).map((item: any, i: number) => {
      const title = item.title || '';
      const snippet = (item.snippet || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      const pageUrl = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
      return {
        filePath: pageUrl, lines: [0],
        snippet: `${title}\n${snippet}`,
        score: 0.95 - i * 0.05, source: 'Wikipedia',
        metadata: { title, url: pageUrl, isWikipedia: true },
      };
    });
    if (results.length > 0) log(`  Wikipedia(${lang}): ${results.length} 条`);
    return results;
  } catch { return []; }
}
