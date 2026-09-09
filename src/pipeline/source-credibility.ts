/**
 * Source Credibility Rating System — S/A/B tiered source weighting.
 *
 * Replaces the hard-coded boost rules in filters.ts with a structured,
 * domain-relative credibility system inspired by Kimi's approach.
 *
 * Tiers:
 *  S — Authoritative primary sources (official, academic, gov)
 *  A — High-quality secondary sources (major media, tech communities)
 *  B — General reference (blogs, forums, social media)
 *  unrated — Unknown domains
 */

import type { QueryIntent } from './query-analyzer.js';

// ── Types ──────────────────────────────────────────

export type SourceTier = 'S' | 'A' | 'B' | 'unrated';

export interface SourceCredibility {
  tier: SourceTier;
  baseWeight: number;
  domainRelevance: number;
  finalWeight: number;
}

// ── Tier Definitions ──────────────────────────────

interface TierEntry {
  pattern: RegExp;
  tier: SourceTier;
  /** Intent types where this source gets extra relevance boost */
  strongFor?: QueryIntent[];
}

const SOURCE_REGISTRY: TierEntry[] = [
  // ── S-tier: Authoritative Primary Sources ──

  // Academic
  { pattern: /arxiv\.org/i, tier: 'S', strongFor: ['academic', 'technical'] },
  { pattern: /nature\.com/i, tier: 'S', strongFor: ['academic', 'medical'] },
  { pattern: /science\.org|sciencemag\.org/i, tier: 'S', strongFor: ['academic'] },
  { pattern: /ieee\.org/i, tier: 'S', strongFor: ['academic', 'technical'] },
  { pattern: /acm\.org/i, tier: 'S', strongFor: ['academic', 'technical'] },
  { pattern: /springer\.com|link\.springer/i, tier: 'S', strongFor: ['academic'] },
  { pattern: /wiley\.com/i, tier: 'S', strongFor: ['academic'] },
  { pattern: /semanticscholar\.org/i, tier: 'S', strongFor: ['academic'] },
  { pattern: /openreview\.net/i, tier: 'S', strongFor: ['academic'] },
  { pattern: /papers\.nips\.cc|neurips\.cc/i, tier: 'S', strongFor: ['academic'] },
  { pattern: /pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov/i, tier: 'S', strongFor: ['academic', 'medical'] },
  { pattern: /scholar\.google/i, tier: 'S', strongFor: ['academic'] },
  { pattern: /pnas\.org/i, tier: 'S', strongFor: ['academic'] },
  { pattern: /cell\.com/i, tier: 'S', strongFor: ['academic', 'medical'] },
  { pattern: /thelancet\.com/i, tier: 'S', strongFor: ['academic', 'medical'] },

  // Government & International Organizations
  { pattern: /\.gov\.cn/i, tier: 'S', strongFor: ['news', 'legal', 'finance'] },
  { pattern: /\.gov(\.[a-z]{2})?$/i, tier: 'S', strongFor: ['news', 'legal'] },
  { pattern: /who\.int/i, tier: 'S', strongFor: ['medical'] },
  { pattern: /un\.org/i, tier: 'S', strongFor: ['news'] },
  { pattern: /worldbank\.org/i, tier: 'S', strongFor: ['finance'] },
  { pattern: /imf\.org/i, tier: 'S', strongFor: ['finance'] },

  // Top-tier news agencies
  { pattern: /xinhuanet\.com|xinhua/i, tier: 'S', strongFor: ['news'] },
  { pattern: /reuters\.com/i, tier: 'S', strongFor: ['news', 'finance'] },
  { pattern: /apnews\.com/i, tier: 'S', strongFor: ['news'] },

  // Finance data (international)
  { pattern: /bloomberg\.com/i, tier: 'S', strongFor: ['finance', 'news'] },
  { pattern: /wsj\.com/i, tier: 'S', strongFor: ['finance', 'news'] },
  { pattern: /ft\.com/i, tier: 'S', strongFor: ['finance', 'news'] },
  { pattern: /sec\.gov/i, tier: 'S', strongFor: ['finance', 'legal'] },

  // Finance data (Chinese)
  { pattern: /cninfo\.com\.cn/i, tier: 'S', strongFor: ['finance'] },
  { pattern: /sse\.com\.cn/i, tier: 'S', strongFor: ['finance'] },
  { pattern: /szse\.cn/i, tier: 'S', strongFor: ['finance'] },
  { pattern: /csrc\.gov\.cn/i, tier: 'S', strongFor: ['finance', 'legal'] },

  // Legal (Chinese authorities)
  { pattern: /court\.gov\.cn/i, tier: 'S', strongFor: ['legal'] },
  { pattern: /flk\.npc\.gov\.cn/i, tier: 'S', strongFor: ['legal'] },
  { pattern: /customs\.gov\.cn/i, tier: 'S', strongFor: ['legal', 'finance'] },
  { pattern: /mofcom\.gov\.cn/i, tier: 'S', strongFor: ['legal', 'finance'] },
  { pattern: /moj\.gov\.cn/i, tier: 'S', strongFor: ['legal'] },

  // Legal (international)
  { pattern: /courtlistener\.com/i, tier: 'S', strongFor: ['legal'] },
  { pattern: /eur-lex\.europa\.eu/i, tier: 'S', strongFor: ['legal'] },
  { pattern: /wto\.org/i, tier: 'S', strongFor: ['legal', 'finance'] },

  // ── A-tier: High-quality Secondary Sources ──

  // Legal (professional)
  { pattern: /pkulaw\.com/i, tier: 'A', strongFor: ['legal'] },
  { pattern: /lawinfochina\.com/i, tier: 'A', strongFor: ['legal'] },
  { pattern: /zhonglun\.com|中伦/i, tier: 'A', strongFor: ['legal'] },
  { pattern: /junhe\.com|君合/i, tier: 'A', strongFor: ['legal'] },
  { pattern: /lexology\.com/i, tier: 'A', strongFor: ['legal'] },
  { pattern: /law\.cornell\.edu/i, tier: 'A', strongFor: ['legal'] },

  // Finance (professional / Chinese)
  { pattern: /eastmoney\.com/i, tier: 'A', strongFor: ['finance'] },
  { pattern: /xueqiu\.com/i, tier: 'A', strongFor: ['finance'] },
  { pattern: /finance\.sina\.com/i, tier: 'A', strongFor: ['finance'] },
  { pattern: /21jingji\.com/i, tier: 'A', strongFor: ['finance'] },
  { pattern: /eeo\.com\.cn/i, tier: 'A', strongFor: ['finance'] },
  { pattern: /caijing\.com\.cn/i, tier: 'A', strongFor: ['finance'] },
  { pattern: /hq\.sinajs\.cn|qt\.gtimg\.cn/i, tier: 'A', strongFor: ['finance'] },

  // Major media (Chinese)
  { pattern: /people\.com\.cn|people\.cn/i, tier: 'A', strongFor: ['news'] },
  { pattern: /cctv\.com/i, tier: 'A', strongFor: ['news'] },
  { pattern: /chinanews\.com/i, tier: 'A', strongFor: ['news'] },
  { pattern: /thepaper\.cn/i, tier: 'A', strongFor: ['news'] },
  { pattern: /caixin\.com/i, tier: 'A', strongFor: ['news', 'finance'] },
  { pattern: /yicai\.com/i, tier: 'A', strongFor: ['finance'] },
  { pattern: /huanqiu\.com/i, tier: 'A', strongFor: ['news'] },
  { pattern: /guancha\.cn/i, tier: 'A', strongFor: ['news'] },
  { pattern: /jiemian\.com/i, tier: 'A', strongFor: ['news'] },

  // Major media (International)
  { pattern: /bbc\.com|bbc\.co\.uk/i, tier: 'A', strongFor: ['news'] },
  { pattern: /cnn\.com/i, tier: 'A', strongFor: ['news'] },
  { pattern: /nytimes\.com/i, tier: 'A', strongFor: ['news'] },
  { pattern: /washingtonpost\.com/i, tier: 'A', strongFor: ['news'] },
  { pattern: /theguardian\.com/i, tier: 'A', strongFor: ['news'] },
  { pattern: /economist\.com/i, tier: 'A', strongFor: ['news', 'finance'] },
  { pattern: /npr\.org/i, tier: 'A', strongFor: ['news'] },
  { pattern: /aljazeera\.com/i, tier: 'A', strongFor: ['news'] },

  // Tech communities
  { pattern: /stackoverflow\.com/i, tier: 'A', strongFor: ['technical'] },
  { pattern: /github\.com/i, tier: 'A', strongFor: ['technical'] },
  { pattern: /developer\.mozilla\.org|mdn/i, tier: 'A', strongFor: ['technical'] },
  { pattern: /docs\.python\.org/i, tier: 'A', strongFor: ['technical'] },
  { pattern: /docs\.microsoft\.com|learn\.microsoft\.com/i, tier: 'A', strongFor: ['technical'] },
  { pattern: /cloud\.google\.com\/docs/i, tier: 'A', strongFor: ['technical'] },
  { pattern: /docs\.aws\.amazon\.com/i, tier: 'A', strongFor: ['technical'] },

  // Encyclopedia
  { pattern: /wikipedia\.org/i, tier: 'A' },
  { pattern: /britannica\.com/i, tier: 'A' },

  // Community wikis
  { pattern: /fandom\.com/i, tier: 'A', strongFor: ['entertainment'] },
  { pattern: /myanimelist\.net/i, tier: 'A', strongFor: ['entertainment'] },
  { pattern: /wiki\.archlinux\.org/i, tier: 'A', strongFor: ['technical'] },
  { pattern: /devdocs\.io/i, tier: 'A', strongFor: ['technical'] },
  { pattern: /ifixit\.com/i, tier: 'A', strongFor: ['shopping'] },

  // ── B-tier: General Reference ──

  // Blog platforms
  { pattern: /medium\.com/i, tier: 'B' },
  { pattern: /zhihu\.com/i, tier: 'B' },
  { pattern: /csdn\.net/i, tier: 'B', strongFor: ['technical'] },
  { pattern: /juejin\.cn/i, tier: 'B', strongFor: ['technical'] },
  { pattern: /cnblogs\.com/i, tier: 'B', strongFor: ['technical'] },
  { pattern: /segmentfault\.com/i, tier: 'B', strongFor: ['technical'] },
  { pattern: /jianshu\.com/i, tier: 'B' },
  { pattern: /dev\.to/i, tier: 'B', strongFor: ['technical'] },
  { pattern: /hashnode\.dev/i, tier: 'B', strongFor: ['technical'] },
  { pattern: /substack\.com/i, tier: 'B' },

  // Social media
  { pattern: /twitter\.com|x\.com/i, tier: 'B', strongFor: ['news'] },
  { pattern: /weibo\.com/i, tier: 'B', strongFor: ['news', 'entertainment'] },
  { pattern: /reddit\.com/i, tier: 'B' },

  // Q&A / Forums
  { pattern: /quora\.com/i, tier: 'B' },
  { pattern: /baidu\.com\/link/i, tier: 'B' },
  { pattern: /douban\.com/i, tier: 'B', strongFor: ['entertainment'] },
  { pattern: /bilibili\.com/i, tier: 'B', strongFor: ['entertainment', 'technical'] },
  { pattern: /youtube\.com/i, tier: 'B', strongFor: ['entertainment'] },

  // E-commerce
  { pattern: /amazon\.com|amazon\.cn/i, tier: 'B', strongFor: ['shopping'] },
  { pattern: /jd\.com/i, tier: 'B', strongFor: ['shopping'] },
  { pattern: /taobao\.com|tmall\.com/i, tier: 'B', strongFor: ['shopping'] },
];

// ── Weight Constants ──────────────────────────────

const TIER_BASE_WEIGHTS: Record<SourceTier, number> = {
  S: 0.50,
  A: 0.30,
  B: 0.10,
  unrated: 0.0,
};

const DOMAIN_RELEVANCE_BOOST = 0.15;

// ── Main Functions ────────────────────────────────

function extractDomain(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.replace(/^www\./, '');
  } catch {
    const m = url.match(/https?:\/\/(?:www\.)?([^/?#]+)/);
    return m ? m[1] : url;
  }
}

/**
 * Rate the credibility of a source URL based on its domain,
 * adjusted for domain relevance to the query intent.
 */
export function rateSource(url: string, intent: QueryIntent): SourceCredibility {
  const entry = SOURCE_REGISTRY.find(e => e.pattern.test(url));

  if (!entry) {
    return {
      tier: 'unrated',
      baseWeight: TIER_BASE_WEIGHTS.unrated,
      domainRelevance: 0,
      finalWeight: TIER_BASE_WEIGHTS.unrated,
    };
  }

  const baseWeight = TIER_BASE_WEIGHTS[entry.tier];
  const domainRelevance = entry.strongFor?.includes(intent) ? DOMAIN_RELEVANCE_BOOST : 0;
  const finalWeight = baseWeight + domainRelevance;

  return {
    tier: entry.tier,
    baseWeight,
    domainRelevance,
    finalWeight,
  };
}

/**
 * Enhanced version of applySourceBoosts that uses the credibility system.
 * Applies credibility-based scoring and sets metadata flags.
 */
export function applyCredibilityScore(
  r: any,
  url: string,
  intent: QueryIntent,
): SourceCredibility {
  const cred = rateSource(url, intent);

  r.score = (r.score ?? 0) + cred.finalWeight;
  r.metadata = {
    ...r.metadata,
    sourceTier: cred.tier,
    sourceCredibility: cred.finalWeight,
  };

  // Preserve backward-compatible metadata flags
  if (/arxiv\.org|semanticscholar\.org|acm\.org\/doi|ieee\.org|openreview\.net|papers\.nips\.cc/.test(url)) {
    r.metadata.isAcademic = true;
  }
  if (url.includes('wikipedia.org')) {
    r.metadata.isWikipedia = true;
  }
  if (/\.pdf(\?|$)/i.test(url) || /papers\.ssrn\.com|dl\.acm\.org\/doi\/pdf|openreview\.net\/pdf/.test(url)) {
    r.metadata.isPdf = true;
  }

  return cred;
}
