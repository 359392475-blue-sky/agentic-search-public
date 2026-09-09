import { BaseMethod } from './base.js';
import type { SearchResult, MethodConfig } from '../types/index.js';
import type { DomainSource } from '../knowledge/domain-sources.js';

/**
 * DomainSearchMethod — 根据 DomainSource 注册表直接调用各领域 API。
 *
 * 不同于 grep/glob 搜本地文件, 这个方法直接 HTTP 调用远程 API。
 * 每个 DomainSource 的 URL 模板中 {q} 会被替换为搜索词。
 *
 * 针对不同 API 的响应格式, 内置了专用解析器:
 *   - arXiv: Atom XML
 *   - Semantic Scholar / OpenAlex / CrossRef: JSON
 *   - CVEDB / NVD: JSON
 *   - YTS: JSON
 *   - 通用 JSON: 自动猜测字段映射
 */
export class DomainSearchMethod extends BaseMethod {
  readonly name = 'domain-api';
  readonly config: MethodConfig = {
    name: 'domain-api',
    description: 'Search domain-specific APIs directly (arXiv, CVEDB, YTS, PubMed, etc.)',
    supportedParams: ['query', 'sources', 'maxResults'],
  };

  async execute(params: Record<string, unknown>): Promise<SearchResult[]> {
    const query = params.query as string;
    const sources = params.sources as DomainSource[];
    const maxResults = (params.maxResults as number) ?? 10;

    if (!sources?.length) return [];

    const results = await Promise.allSettled(
      sources
        .filter((s) => s.accessMethod === 'api')
        .map((source) => this.callSource(source, query, maxResults))
    );

    const allResults: SearchResult[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') allResults.push(...r.value);
    }

    return allResults.slice(0, maxResults);
  }

  private async callSource(source: DomainSource, query: string, maxResults: number): Promise<SearchResult[]> {
    const url = this.buildUrl(source, query, maxResults);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const resp = await fetch(url, {
        headers: { 'Accept': 'application/json, application/xml, text/xml, */*', 'User-Agent': 'AgenticSearch/1.0' },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!resp.ok && resp.status !== 429) return [];
      if (resp.status === 429) return []; // rate-limited, skip silently

      const contentType = resp.headers.get('content-type') ?? '';
      const body = await resp.text();
      if (!body || body.length === 0) return [];

      if (contentType.includes('xml') || body.trimStart().startsWith('<?xml') || body.trimStart().startsWith('<feed')) {
        return this.parseXml(body, source);
      }

      const json = JSON.parse(body);
      return this.parseJson(json, source, maxResults);
    } catch {
      clearTimeout(timeout);
      return [];
    }
  }

  private buildUrl(source: DomainSource, query: string, maxResults: number): string {
    const needsRawQuery = source.url.includes('crt.sh');
    let url = source.url.replace('{q}', needsRawQuery ? query : encodeURIComponent(query));
    url = url.replace('{indicator}', encodeURIComponent(query));
    url = url.replace('{doi}', encodeURIComponent(query));
    url = url.replace('{ip}', encodeURIComponent(query));
    url = url.replace('{lat}', '0').replace('{lon}', '0');

    if (url.includes('max_results=')) {
      url = url.replace(/max_results=\d+/, `max_results=${maxResults}`);
    }
    if (url.includes('limit=')) {
      url = url.replace(/limit=\d+/, `limit=${maxResults}`);
    }
    if (url.includes('rows=')) {
      url = url.replace(/rows=\d+/, `rows=${maxResults}`);
    }
    if (url.includes('per_page=')) {
      url = url.replace(/per_page=\d+/, `per_page=${maxResults}`);
    }
    if (url.includes('pageSize=')) {
      url = url.replace(/pageSize=\d+/, `pageSize=${maxResults}`);
    }
    if (url.includes('retmax=')) {
      url = url.replace(/retmax=\d+/, `retmax=${maxResults}`);
    }

    return url;
  }

  // ── XML parser (arXiv Atom) ──

  private parseXml(xml: string, source: DomainSource): SearchResult[] {
    const results: SearchResult[] = [];

    const entries = xml.split(/<entry>/g).slice(1);
    for (const entry of entries) {
      const title = this.extractTag(entry, 'title')?.replace(/\s+/g, ' ').trim();
      const summary = this.extractTag(entry, 'summary')?.replace(/\s+/g, ' ').trim();
      const id = this.extractTag(entry, 'id');
      const published = this.extractTag(entry, 'published');

      if (!title) continue;

      results.push({
        filePath: id ?? '',
        lines: [],
        snippet: summary ? `${title}\n\n${summary.slice(0, 500)}` : title,
        score: 0.8,
        source: source.name,
        metadata: {
          title,
          url: id,
          date: published,
          domain: 'academic',
          apiSource: source.name,
        },
      });
    }

    return results;
  }

  private extractTag(xml: string, tag: string): string | undefined {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
    const match = xml.match(regex);
    return match?.[1]?.trim();
  }

  // ── JSON parsers (dispatch by source name) ──

  private parseJson(json: unknown, source: DomainSource, maxResults: number): SearchResult[] {
    const name = source.name.toLowerCase();

    if (name.includes('semantic scholar')) return this.parseSemanticScholar(json, source);
    if (name.includes('openalex')) return this.parseOpenAlex(json, source);
    if (name.includes('crossref')) return this.parseCrossRef(json, source);
    if (name.includes('core')) return this.parseCORE(json, source);
    if (name.includes('cvedb')) return this.parseCVEDB(json, source);
    if (name.includes('nvd')) return this.parseNVD(json, source);
    if (name.includes('osv')) return this.parseOSV(json, source);
    if (name.includes('yts') || name.includes('yify')) return this.parseYTS(json, source);
    if (name.includes('hacker news') || name.includes('algolia')) return this.parseHN(json, source);
    if (name.includes('npm')) return this.parseNPM(json, source);
    if (name.includes('hugging face')) return this.parseHuggingFace(json, source);
    if (name.includes('wikipedia')) return this.parseWikipedia(json, source);
    if (name.includes('duckduckgo')) return this.parseDDG(json, source);
    if (name.includes('coingecko')) return this.parseCoinGecko(json, source);
    if (name.includes('pubmed')) return this.parsePubMed(json, source);
    if (name.includes('clinicaltrials')) return this.parseClinicalTrials(json, source);
    if (name.includes('open library')) return this.parseOpenLibrary(json, source);
    if (name.includes('gutenberg')) return this.parseGutenberg(json, source);
    if (name.includes('world bank')) return this.parseWorldBank(json, source);
    if (name.includes('internetdb')) return this.parseInternetDB(json, source);
    if (name.includes('crt.sh')) return this.parseCrtSh(json, source);
    if (name.includes('stackexchange')) return this.parseStackExchange(json, source);
    if (name.includes('courtlistener')) return this.parseCourtListener(json, source);
    if (name.includes('sec') && name.includes('edgar')) return this.parseSEC(json, source);

    return this.parseGenericJson(json, source, maxResults);
  }

  // ── Semantic Scholar ──
  private parseSemanticScholar(json: any, source: DomainSource): SearchResult[] {
    const papers = json?.data ?? json?.papers ?? [];
    return papers.map((p: any) => ({
      filePath: p.url ?? `https://semanticscholar.org/paper/${p.paperId}`,
      lines: [],
      snippet: `${p.title ?? ''}\n\n${(p.abstract ?? p.tldr?.text ?? '').slice(0, 500)}`,
      score: Math.min(1, (p.citationCount ?? 0) / 1000 + 0.3),
      source: source.name,
      metadata: { title: p.title, citations: p.citationCount, year: p.year, apiSource: source.name },
    }));
  }

  // ── OpenAlex ──
  private parseOpenAlex(json: any, source: DomainSource): SearchResult[] {
    const works = json?.results ?? [];
    return works.map((w: any) => ({
      filePath: w.doi ?? w.id ?? '',
      lines: [],
      snippet: `${w.title ?? w.display_name ?? ''}\n\n${(w.abstract_inverted_index ? '(abstract available)' : '').slice(0, 500)}`,
      score: Math.min(1, (w.cited_by_count ?? 0) / 500 + 0.3),
      source: source.name,
      metadata: { title: w.display_name, citations: w.cited_by_count, year: w.publication_year, openAccess: w.open_access?.is_oa, apiSource: source.name },
    }));
  }

  // ── CrossRef ──
  private parseCrossRef(json: any, source: DomainSource): SearchResult[] {
    const items = json?.message?.items ?? [];
    return items.map((item: any) => ({
      filePath: item.DOI ? `https://doi.org/${item.DOI}` : '',
      lines: [],
      snippet: `${(item.title ?? []).join('')}\n\n${(item.abstract ?? '').replace(/<[^>]*>/g, '').slice(0, 500)}`,
      score: Math.min(1, (item['is-referenced-by-count'] ?? 0) / 500 + 0.2),
      source: source.name,
      metadata: { title: (item.title ?? [])[0], doi: item.DOI, citations: item['is-referenced-by-count'], apiSource: source.name },
    }));
  }

  // ── CORE ──
  private parseCORE(json: any, source: DomainSource): SearchResult[] {
    const results = json?.results ?? json?.data ?? [];
    return results.map((r: any) => ({
      filePath: r.downloadUrl ?? r.sourceFulltextUrls?.[0] ?? r.doi ?? '',
      lines: [],
      snippet: `${r.title ?? ''}\n\n${(r.abstract ?? '').slice(0, 500)}`,
      score: 0.6,
      source: source.name,
      metadata: { title: r.title, year: r.yearPublished, hasFullText: !!r.downloadUrl, apiSource: source.name },
    }));
  }

  // ── CVEDB (Shodan) ──
  private parseCVEDB(json: any, source: DomainSource): SearchResult[] {
    const cves = json?.cves ?? (json?.cve_id ? [json] : []);
    return cves.map((c: any) => ({
      filePath: `https://nvd.nist.gov/vuln/detail/${c.cve_id}`,
      lines: [],
      snippet: `${c.cve_id} [CVSS: ${c.cvss ?? 'N/A'}]\n${(c.summary ?? c.description ?? '').slice(0, 500)}`,
      score: Math.min(1, (c.cvss ?? 5) / 10),
      source: source.name,
      metadata: { cveId: c.cve_id, cvss: c.cvss, epss: c.epss, ransomware: c.ransomware_campaign, apiSource: source.name },
    }));
  }

  // ── NVD ──
  private parseNVD(json: any, source: DomainSource): SearchResult[] {
    const vulns = json?.vulnerabilities ?? [];
    return vulns.map((v: any) => {
      const cve = v.cve ?? {};
      const desc = cve.descriptions?.find((d: any) => d.lang === 'en')?.value ?? '';
      const cvss = cve.metrics?.cvssMetricV31?.[0]?.cvssData?.baseScore;
      return {
        filePath: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
        lines: [],
        snippet: `${cve.id} [CVSS: ${cvss ?? 'N/A'}]\n${desc.slice(0, 500)}`,
        score: Math.min(1, (cvss ?? 5) / 10),
        source: source.name,
        metadata: { cveId: cve.id, cvss, apiSource: source.name },
      };
    });
  }

  // ── OSV.dev ──
  private parseOSV(json: any, source: DomainSource): SearchResult[] {
    const vulns = json?.vulns ?? [];
    return vulns.map((v: any) => ({
      filePath: `https://osv.dev/vulnerability/${v.id}`,
      lines: [],
      snippet: `${v.id}\n${(v.summary ?? v.details ?? '').slice(0, 500)}`,
      score: 0.7,
      source: source.name,
      metadata: { vulnId: v.id, aliases: v.aliases, apiSource: source.name },
    }));
  }

  // ── YTS/YIFY ──
  private parseYTS(json: any, source: DomainSource): SearchResult[] {
    const movies = json?.data?.movies ?? [];
    return movies.map((m: any) => ({
      filePath: m.url ?? `https://yts.mx/movies/${m.slug}`,
      lines: [],
      snippet: `${m.title_long ?? m.title} (${m.year})\nRating: ${m.rating}/10 | ${m.runtime}min | ${(m.genres ?? []).join(', ')}\n${(m.synopsis ?? m.summary ?? '').slice(0, 400)}`,
      score: Math.min(1, (m.rating ?? 5) / 10),
      source: source.name,
      metadata: {
        title: m.title, year: m.year, rating: m.rating,
        torrents: m.torrents?.map((t: any) => ({ quality: t.quality, size: t.size, hash: t.hash, url: t.url })),
        poster: m.medium_cover_image, apiSource: source.name,
      },
    }));
  }

  // ── Hacker News (Algolia) ──
  private parseHN(json: any, source: DomainSource): SearchResult[] {
    const hits = json?.hits ?? [];
    return hits.map((h: any) => ({
      filePath: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      lines: [],
      snippet: `${h.title ?? h.story_title ?? ''}\nPoints: ${h.points ?? 0} | Comments: ${h.num_comments ?? 0}`,
      score: Math.min(1, (h.points ?? 0) / 500 + 0.2),
      source: source.name,
      metadata: { title: h.title, points: h.points, comments: h.num_comments, apiSource: source.name },
    }));
  }

  // ── npm Registry ──
  private parseNPM(json: any, source: DomainSource): SearchResult[] {
    const objects = json?.objects ?? [];
    return objects.map((o: any) => {
      const pkg = o.package ?? {};
      return {
        filePath: pkg.links?.npm ?? `https://npmjs.com/package/${pkg.name}`,
        lines: [],
        snippet: `${pkg.name}@${pkg.version}\n${(pkg.description ?? '').slice(0, 300)}`,
        score: o.score?.final ?? 0.5,
        source: source.name,
        metadata: { name: pkg.name, version: pkg.version, downloads: o.score?.detail?.popularity, apiSource: source.name },
      };
    });
  }

  // ── Hugging Face ──
  private parseHuggingFace(json: any, source: DomainSource): SearchResult[] {
    const models = Array.isArray(json) ? json : [];
    return models.map((m: any) => ({
      filePath: `https://huggingface.co/${m.modelId ?? m.id}`,
      lines: [],
      snippet: `${m.modelId ?? m.id}\nPipeline: ${m.pipeline_tag ?? 'N/A'} | Downloads: ${m.downloads ?? 0} | Likes: ${m.likes ?? 0}`,
      score: Math.min(1, (m.downloads ?? 0) / 100000 + 0.2),
      source: source.name,
      metadata: { modelId: m.modelId ?? m.id, pipeline: m.pipeline_tag, downloads: m.downloads, likes: m.likes, apiSource: source.name },
    }));
  }

  // ── Wikipedia ──
  private parseWikipedia(json: any, source: DomainSource): SearchResult[] {
    const results = json?.query?.search ?? [];
    return results.map((r: any) => ({
      filePath: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
      lines: [],
      snippet: `${r.title}\n${(r.snippet ?? '').replace(/<[^>]*>/g, '').slice(0, 500)}`,
      score: 0.7,
      source: source.name,
      metadata: { title: r.title, wordcount: r.wordcount, apiSource: source.name },
    }));
  }

  // ── DuckDuckGo Instant Answer ──
  private parseDDG(json: any, source: DomainSource): SearchResult[] {
    const results: SearchResult[] = [];
    if (json?.AbstractText) {
      results.push({
        filePath: json.AbstractURL ?? '',
        lines: [],
        snippet: `${json.Heading ?? ''}\n\n${json.AbstractText}`,
        score: 0.9,
        source: source.name,
        metadata: { heading: json.Heading, source: json.AbstractSource, apiSource: source.name },
      });
    }
    for (const topic of json?.RelatedTopics ?? []) {
      if (topic.Text) {
        results.push({
          filePath: topic.FirstURL ?? '',
          lines: [],
          snippet: topic.Text.slice(0, 500),
          score: 0.5,
          source: source.name,
          metadata: { apiSource: source.name },
        });
      }
    }
    return results;
  }

  // ── CoinGecko ──
  private parseCoinGecko(json: any, source: DomainSource): SearchResult[] {
    const coins = json?.coins ?? [];
    return coins.map((c: any) => ({
      filePath: `https://www.coingecko.com/coins/${c.id}`,
      lines: [],
      snippet: `${c.name} (${c.symbol?.toUpperCase()}) — Market Cap Rank: #${c.market_cap_rank ?? 'N/A'}`,
      score: c.market_cap_rank ? Math.min(1, 1 / c.market_cap_rank + 0.3) : 0.5,
      source: source.name,
      metadata: { id: c.id, symbol: c.symbol, thumb: c.thumb, apiSource: source.name },
    }));
  }

  // ── PubMed ──
  private parsePubMed(json: any, source: DomainSource): SearchResult[] {
    const ids = json?.esearchresult?.idlist ?? [];
    return ids.map((id: string) => ({
      filePath: `https://pubmed.ncbi.nlm.nih.gov/${id}`,
      lines: [],
      snippet: `PubMed ID: ${id}`,
      score: 0.6,
      source: source.name,
      metadata: { pmid: id, apiSource: source.name },
    }));
  }

  // ── ClinicalTrials.gov ──
  private parseClinicalTrials(json: any, source: DomainSource): SearchResult[] {
    const studies = json?.studies ?? [];
    return studies.map((s: any) => {
      const proto = s.protocolSection ?? {};
      const id = proto.identificationModule?.nctId ?? '';
      const title = proto.identificationModule?.briefTitle ?? '';
      const status = proto.statusModule?.overallStatus ?? '';
      return {
        filePath: `https://clinicaltrials.gov/study/${id}`,
        lines: [],
        snippet: `${id}: ${title}\nStatus: ${status}`,
        score: 0.7,
        source: source.name,
        metadata: { nctId: id, title, status, apiSource: source.name },
      };
    });
  }

  // ── Open Library ──
  private parseOpenLibrary(json: any, source: DomainSource): SearchResult[] {
    const docs = json?.docs ?? [];
    return docs.map((d: any) => ({
      filePath: `https://openlibrary.org${d.key}`,
      lines: [],
      snippet: `${d.title} (${d.first_publish_year ?? 'N/A'})\nAuthor: ${(d.author_name ?? []).join(', ')}`,
      score: Math.min(1, (d.edition_count ?? 1) / 100 + 0.3),
      source: source.name,
      metadata: { title: d.title, authors: d.author_name, isbn: d.isbn?.[0], apiSource: source.name },
    }));
  }

  // ── Gutenberg ──
  private parseGutenberg(json: any, source: DomainSource): SearchResult[] {
    const books = json?.results ?? [];
    return books.map((b: any) => ({
      filePath: b.formats?.['text/html'] ?? b.formats?.['text/plain; charset=utf-8'] ?? `https://gutenberg.org/ebooks/${b.id}`,
      lines: [],
      snippet: `${b.title}\nAuthor: ${(b.authors ?? []).map((a: any) => a.name).join(', ')}\nDownloads: ${b.download_count ?? 0}`,
      score: Math.min(1, (b.download_count ?? 0) / 10000 + 0.3),
      source: source.name,
      metadata: { title: b.title, id: b.id, downloads: b.download_count, apiSource: source.name },
    }));
  }

  // ── World Bank ──
  private parseWorldBank(json: any, source: DomainSource): SearchResult[] {
    if (!Array.isArray(json) || json.length < 2) return [];
    const data = json[1] ?? [];
    return data.map((d: any) => ({
      filePath: `https://data.worldbank.org/indicator/${d.indicator?.id}`,
      lines: [],
      snippet: `${d.country?.value ?? ''}: ${d.indicator?.value ?? ''} = ${d.value ?? 'N/A'} (${d.date ?? ''})`,
      score: d.value != null ? 0.7 : 0.3,
      source: source.name,
      metadata: { country: d.country?.value, indicator: d.indicator?.id, value: d.value, year: d.date, apiSource: source.name },
    }));
  }

  // ── InternetDB (Shodan) ──
  private parseInternetDB(json: any, source: DomainSource): SearchResult[] {
    if (!json?.ip) return [];
    return [{
      filePath: `https://internetdb.shodan.io/${json.ip}`,
      lines: [],
      snippet: `IP: ${json.ip}\nPorts: ${(json.ports ?? []).join(', ')}\nHostnames: ${(json.hostnames ?? []).join(', ')}\nVulns: ${(json.vulns ?? []).join(', ')}`,
      score: 0.8,
      source: source.name,
      metadata: { ip: json.ip, ports: json.ports, vulns: json.vulns, cpes: json.cpes, apiSource: source.name },
    }];
  }

  // ── crt.sh ──
  private parseCrtSh(json: any, source: DomainSource): SearchResult[] {
    const entries = Array.isArray(json) ? json.slice(0, 20) : [];
    return entries.map((e: any) => ({
      filePath: `https://crt.sh/?id=${e.id}`,
      lines: [],
      snippet: `${e.common_name ?? e.name_value ?? ''}\nIssuer: ${e.issuer_name ?? ''}\nNot Before: ${e.not_before ?? ''}`,
      score: 0.6,
      source: source.name,
      metadata: { commonName: e.common_name, issuer: e.issuer_name, notBefore: e.not_before, apiSource: source.name },
    }));
  }

  // ── StackExchange ──
  private parseStackExchange(json: any, source: DomainSource): SearchResult[] {
    const items = json?.items ?? [];
    return items.map((i: any) => ({
      filePath: i.link ?? '',
      lines: [],
      snippet: `${i.title ?? ''}\nScore: ${i.score ?? 0} | Answers: ${i.answer_count ?? 0} | Views: ${i.view_count ?? 0}`,
      score: Math.min(1, (i.score ?? 0) / 100 + 0.2),
      source: source.name,
      metadata: { title: i.title, score: i.score, answers: i.answer_count, accepted: i.is_answered, tags: i.tags, apiSource: source.name },
    }));
  }

  // ── CourtListener ──
  private parseCourtListener(json: any, source: DomainSource): SearchResult[] {
    const results = json?.results ?? [];
    return results.map((r: any) => ({
      filePath: r.absolute_url ? `https://www.courtlistener.com${r.absolute_url}` : '',
      lines: [],
      snippet: `${r.caseName ?? r.case_name ?? ''}\nCourt: ${r.court ?? ''} | Date: ${r.dateFiled ?? r.date_filed ?? ''}`,
      score: 0.6,
      source: source.name,
      metadata: { caseName: r.caseName ?? r.case_name, court: r.court, dateFiled: r.dateFiled ?? r.date_filed, apiSource: source.name },
    }));
  }

  // ── SEC EDGAR ──
  private parseSEC(json: any, source: DomainSource): SearchResult[] {
    const hits = json?.hits?.hits ?? [];
    return hits.map((h: any) => {
      const s = h._source ?? {};
      return {
        filePath: s.file_url ?? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${s.entity_name}`,
        lines: [],
        snippet: `${s.entity_name ?? ''} — ${s.file_description ?? s.form_type ?? ''}\nFiled: ${s.file_date ?? ''}`,
        score: 0.7,
        source: source.name,
        metadata: { entity: s.entity_name, form: s.form_type, date: s.file_date, apiSource: source.name },
      };
    });
  }

  // ── Generic fallback ──
  private parseGenericJson(json: any, source: DomainSource, maxResults: number): SearchResult[] {
    const items = this.findArray(json);
    if (!items) {
      if (typeof json === 'object' && json !== null) {
        return [{
          filePath: source.url,
          lines: [],
          snippet: JSON.stringify(json, null, 2).slice(0, 800),
          score: 0.5,
          source: source.name,
          metadata: { apiSource: source.name, raw: true },
        }];
      }
      return [];
    }

    return items.slice(0, maxResults).map((item: any) => {
      const rawTitle = item.title ?? item.name ?? item.display_name ?? item.id ?? '';
      const title = typeof rawTitle === 'object' ? (rawTitle.common ?? rawTitle.official ?? JSON.stringify(rawTitle)) : String(rawTitle);
      const rawDesc = item.description ?? item.summary ?? item.abstract ?? item.snippet ?? item.text ?? '';
      const desc = typeof rawDesc === 'object' ? JSON.stringify(rawDesc) : String(rawDesc);
      const url = item.url ?? item.link ?? item.html_url ?? item.web_url ?? '';

      return {
        filePath: url || source.url,
        lines: [],
        snippet: `${title}\n${String(desc).slice(0, 500)}`,
        score: 0.5,
        source: source.name,
        metadata: { title, apiSource: source.name },
      };
    });
  }

  /** Recursively find the first array in a JSON structure */
  private findArray(obj: any, depth = 0): any[] | null {
    if (depth > 3) return null;
    if (Array.isArray(obj)) return obj;
    if (typeof obj === 'object' && obj !== null) {
      for (const v of Object.values(obj)) {
        if (Array.isArray(v) && v.length > 0) return v;
      }
      for (const v of Object.values(obj)) {
        const found = this.findArray(v, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }
}
