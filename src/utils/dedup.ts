/**
 * Advanced deduplication strategies for search results.
 * Goes beyond simple URL dedup with domain limiting and title similarity.
 */

/**
 * Extract the registrable domain from a URL.
 * e.g., "https://news.sina.com.cn/article/123" → "sina.com.cn"
 */
export function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    // Handle two-part TLDs: .com.cn, .co.uk, .co.jp, etc.
    const parts = hostname.split('.');
    if (parts.length >= 3) {
      const twoPartTLDs = ['com.cn', 'com.tw', 'com.hk', 'co.uk', 'co.jp', 'or.jp', 'com.au', 'com.br', 'org.cn', 'net.cn', 'gov.cn', 'ac.uk'];
      const lastTwo = parts.slice(-2).join('.');
      if (twoPartTLDs.includes(lastTwo)) {
        return parts.slice(-3).join('.');
      }
    }
    return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
  } catch {
    return url;
  }
}

// Domains exempt from per-domain limits (high-value, diverse content)
const EXEMPT_DOMAINS = new Set([
  'wikipedia.org', 'arxiv.org', 'doi.org', 'github.com',
  'semanticscholar.org', 'scholar.google.com',
]);

/**
 * Apply domain-level deduplication: limit results per domain.
 * Returns the filtered array in original order.
 */
export function limitPerDomain(
  results: { filePath?: string; metadata?: Record<string, unknown> }[],
  maxPerDomain: number = 3,
): typeof results {
  const domainCounts = new Map<string, number>();

  return results.filter(r => {
    const url = (r.filePath || '') as string;
    if (!url.startsWith('http')) return true;

    const domain = extractDomain(url);
    if (EXEMPT_DOMAINS.has(domain)) return true;
    if (r.metadata?.isAcademic || r.metadata?.isWikipedia) return true;

    const count = domainCounts.get(domain) || 0;
    if (count >= maxPerDomain) return false;
    domainCounts.set(domain, count + 1);
    return true;
  });
}

/**
 * Character bigram set for a string (for similarity comparison).
 */
function bigrams(s: string): Set<string> {
  const clean = s.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, '');
  const result = new Set<string>();
  for (let i = 0; i < clean.length - 1; i++) {
    result.add(clean.slice(i, i + 2));
  }
  return result;
}

/**
 * Jaccard similarity between two strings using character bigrams.
 * Returns 0-1 (1 = identical).
 */
export function titleSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const setA = bigrams(a);
  const setB = bigrams(b);
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const bg of setA) {
    if (setB.has(bg)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

/**
 * Remove near-duplicate results based on title similarity.
 * Keeps the first (higher-scored) result of each similar group.
 */
export function removeSimilarTitles(
  results: { metadata?: Record<string, unknown>; snippet?: string }[],
  threshold: number = 0.65,
): typeof results {
  const kept: typeof results = [];
  const keptTitles: string[] = [];

  for (const r of results) {
    const title = (r.metadata?.title as string) || (r.snippet || '').split('\n')[0]?.slice(0, 100) || '';
    if (!title) { kept.push(r); continue; }

    let isDuplicate = false;
    for (const existing of keptTitles) {
      if (titleSimilarity(title, existing) >= threshold) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      kept.push(r);
      keptTitles.push(title);
    }
  }

  return kept;
}
