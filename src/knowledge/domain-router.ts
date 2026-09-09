import { DOMAIN_SOURCES, type DomainEntry, type DomainSource } from './domain-sources.js';
import type { LLMAdapter } from '../llm/adapter.js';

export interface DomainDetectionResult {
  /** Detected domains, sorted by confidence */
  domains: { domain: string; label: string; confidence: number }[];
  /** Priority sources to use, aggregated from all detected domains */
  prioritySources: DomainSource[];
  /** Site-search queries to add (e.g., "site:pubmed.ncbi.nlm.nih.gov") */
  siteSearchQueries: string[];
}

/**
 * DomainRouter — 领域检测 + 优先源路由。
 *
 * 在搜索动作发生之前，判断 query 属于哪个领域，
 * 然后从知识库中取出该领域的优先源，注入到搜索计划中。
 *
 * 两层检测:
 *   1. 关键词匹配 (快, 无 LLM 调用, <1ms)
 *   2. LLM 分类 (准, 需要 LLM, 可选)
 *
 * 搜索流程变化:
 *   原: query → EntityExtractor → generic search
 *   新: query → DomainRouter → EntityExtractor → domain-aware search
 *                   ↓
 *          "这是医学问题 → 先搜 PubMed + ClinicalTrials.gov"
 */
export class DomainRouter {
  private domains: DomainEntry[];

  constructor(private llm?: LLMAdapter) {
    this.domains = DOMAIN_SOURCES;
  }

  /**
   * Fast keyword-based domain detection. No LLM needed.
   * Returns domains sorted by match confidence.
   */
  detectByKeywords(query: string): DomainDetectionResult {
    const queryLower = query.toLowerCase();
    const queryWords = new Set(queryLower.split(/\s+/));

    const scored = this.domains.map((entry) => {
      let matchCount = 0;

      for (const kw of entry.keywords) {
        const kwLower = kw.toLowerCase();
        if (queryLower.includes(kwLower)) {
          matchCount++;
          if (queryWords.has(kwLower)) matchCount += 0.5;
        }
      }

      // Saturating confidence: 1 match ≈ 0.35, 2 ≈ 0.55, 3+ ≈ 0.7+
      // Avoids penalizing domains with many keywords (e.g. finance has 60+ keywords)
      const confidence = matchCount > 0 ? 1 - 1 / (1 + matchCount * 0.55) : 0;
      return { domain: entry.domain, label: entry.label, confidence, entry };
    });

    const detected = scored
      .filter((s) => s.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);

    const prioritySources: DomainSource[] = [];
    const siteSearchQueries: string[] = [];
    const seenUrls = new Set<string>();

    for (const d of detected) {
      for (const source of d.entry.sources) {
        if (!seenUrls.has(source.url)) {
          seenUrls.add(source.url);
          prioritySources.push(source);

          if (source.accessMethod === 'scrape') {
            try {
              const domain = new URL(source.url.replace('{q}', '')).hostname;
              siteSearchQueries.push(`site:${domain}`);
            } catch { /* template URL, skip */ }
          }
        }
      }
    }

    return {
      domains: detected.map((d) => ({ domain: d.domain, label: d.label, confidence: d.confidence })),
      prioritySources,
      siteSearchQueries,
    };
  }

  /**
   * LLM-enhanced domain detection. More accurate for ambiguous queries.
   */
  async detectWithLLM(query: string): Promise<DomainDetectionResult> {
    if (!this.llm) return this.detectByKeywords(query);

    const keywordResult = this.detectByKeywords(query);

    // If keyword detection is confident enough, skip LLM
    if (keywordResult.domains.length > 0 && keywordResult.domains[0].confidence > 0.3) {
      return keywordResult;
    }

    const domainList = this.domains
      .map((d) => `- ${d.domain}: ${d.label} (${d.keywords.slice(0, 5).join(', ')})`)
      .join('\n');

    const prompt = [
      'Classify this search query into one or more domains.',
      `Query: "${query}"`,
      '',
      'Available domains:',
      domainList,
      '',
      'Respond as JSON: { "domains": [{ "domain": "xxx", "confidence": 0.0-1.0 }] }',
      'Include only domains with confidence > 0.2. Max 3 domains.',
    ].join('\n');

    try {
      const result = await this.llm.completeJSON<{ domains: { domain: string; confidence: number }[] }>(prompt);

      const detected = result.domains
        .map((d) => {
          const entry = this.domains.find((e) => e.domain === d.domain);
          return entry ? { domain: d.domain, label: entry.label, confidence: d.confidence, entry } : null;
        })
        .filter((d): d is NonNullable<typeof d> => d !== null);

      const prioritySources: DomainSource[] = [];
      const siteSearchQueries: string[] = [];
      const seenUrls = new Set<string>();

      for (const d of detected) {
        for (const source of d.entry.sources) {
          if (!seenUrls.has(source.url)) {
            seenUrls.add(source.url);
            prioritySources.push(source);
            if (source.accessMethod === 'scrape') {
              try {
                siteSearchQueries.push(`site:${new URL(source.url.replace('{q}', '')).hostname}`);
              } catch { /* template URL, skip */ }
            }
          }
        }
      }

      return {
        domains: detected.map((d) => ({ domain: d.domain, label: d.label, confidence: d.confidence })),
        prioritySources,
        siteSearchQueries,
      };
    } catch {
      return keywordResult;
    }
  }

  /** Add custom domain sources at runtime */
  addDomain(entry: DomainEntry): void {
    const existing = this.domains.findIndex((d) => d.domain === entry.domain);
    if (existing >= 0) {
      this.domains[existing] = entry;
    } else {
      this.domains.push(entry);
    }
  }

  /** Add a source to an existing domain */
  addSourceToDomain(domain: string, source: DomainSource): void {
    const entry = this.domains.find((d) => d.domain === domain);
    if (entry) {
      entry.sources.push(source);
    }
  }

  listDomains(): { domain: string; label: string; sourceCount: number }[] {
    return this.domains.map((d) => ({
      domain: d.domain,
      label: d.label,
      sourceCount: d.sources.length,
    }));
  }
}
