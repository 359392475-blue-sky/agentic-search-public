/**
 * Noise filters, source boosting, and result scoring rules.
 */

// URL-level noise: hard-block irrelevant URLs
export const noisePatterns = [
  /image\.baidu\.com/,
  /baike\.baidu\.com\/item\/.{1,8}$/,
  /zdic\.net/,
  /dict\./,
  /\/login|\/signup|\/register/i,
  /kugou\.com|kuwo\.com/,
  /^https?:\/\/(www\.)?baidu\.com\/?$/,
  /fxg\.jinritemai\.com/,
  /pornhub|porenhub|xvideos|xnxx/i,
  /m\.baidu\.com\/from=/,
  /m\.baidu\.com\/s\?/,
  /cnki\.net/,
  /buff\.163\.com/,
  /uu\.163\.com|uubooster\.com/,
  /iciba\.com|cambridge\.org\/.*词典|dictionary\./i,
  /gwytb\.gov\.cn/,
  /sogou\.com\/m\//,
  /老黄历|黄道吉日|laohuangli|nongli|almanac\.com/i,
  /星座|horoscope|astrology/i,
  /起名|取名|qiming/i,
];

// Title-level noise: hard-block non-informational content
export const titleNoisePatterns = [
  /的解释[|｜].*的意思/,
  /汉典.*字的/,
  /老黄历|黄道吉日|万年历/,
  /星座运势|周公解梦|起名取名/,
  /笔顺|笔画数|部首查询/,
];

// Authoritative news source patterns for boosting
export const NEWS_SOURCE_BOOST = [
  /xinhuanet\.com|xinhua/i, /people\.com\.cn|people\.cn/i,
  /cctv\.com|央视/i, /chinanews\.com|中新网/i,
  /huanqiu\.com|环球/i, /thepaper\.cn|澎湃/i,
  /guancha\.cn|观察者/i, /jiemian\.com|界面/i,
  /caixin\.com|财新/i, /yicai\.com|第一财经/i,
  /reuters\.com/i, /apnews\.com/i, /bbc\.com|bbc\.co\.uk/i,
  /cnn\.com/i, /nytimes\.com/i, /washingtonpost\.com/i,
  /ft\.com/i, /bloomberg\.com/i, /wsj\.com/i,
  /cbsnews\.com/i, /nbcnews\.com/i, /foxnews\.com/i,
  /npr\.org/i, /aljazeera\.com/i,
  /mfa\.gov\.cn|外交部/i, /gov\.cn/i,
];

// Community wiki patterns for boosting
export const communityWikiPatterns = [
  'fandom.com', 'tvtropes.org', 'pcgamingwiki.com', 'myanimelist.net', 'anilist.co',
  'mobygames.com', 'musicbrainz.org', 'ifixit.com', 'wikichip.org', 'wiki.archlinux.org',
  'genius.com', 'wiki.gentoo.org', 'manualslib.com', 'manualzz.com', 'instructables.com',
  'wikihow.com', 'wikivoyage.org', 'printables.com', 'devdocs.io',
];

// PDF URL patterns
export const PDF_URL_PATTERNS = [
  /\.pdf(\?|$)/i,
  /papers\.ssrn\.com/,
  /dl\.acm\.org\/doi\/pdf/,
  /openreview\.net\/pdf/,
];

export function isPdfUrl(url: string): boolean {
  return PDF_URL_PATTERNS.some(p => p.test(url));
}

// JS-heavy sites that need Playwright rendering
export const JS_RENDER_SITES = [
  'eastmoney.com', 'xueqiu.com', 'finance.sina.com',
  'stockpage.10jqka.com', 'quote.eastmoney.com',
];

/**
 * Build entity set for noise filtering.
 * Prefers LLM-extracted entities, falls back to space-split words.
 */
export function buildEntitySet(query: string, llmCoreEntities: string[]): Set<string> {
  return new Set(
    llmCoreEntities.length > 0
      ? llmCoreEntities
      : query.replace(/[，。？！、\s]+/g, ' ').split(' ')
          .filter(w => w.length >= 2 && !/^\d{4}年?\d{0,2}月?$/.test(w) && !/^(最新|最近|近日|消息|新闻|资讯|进展|走向|分析|报道|成果|查询|搜索|结果|问题|方法)$/.test(w))
  );
}

/**
 * Check if a result should be filtered as noise.
 * Returns true if the result should be KEPT.
 */
export function shouldKeepResult(
  url: string,
  title: string,
  entitySet: Set<string>,
): boolean {
  if (noisePatterns.some(p => p.test(url))) return false;
  if (titleNoisePatterns.some(p => p.test(title))) return false;

  // Block encyclopedia/dictionary entries without entity overlap
  if (/百度百科|百科词条|汉典|字典|辞典/.test(title) && entitySet.size > 0) {
    let entityHit = false;
    for (const ent of entitySet) {
      if (title.includes(ent)) { entityHit = true; break; }
    }
    if (!entityHit) return false;
  }

  return true;
}

/**
 * Apply source-specific score boosts to a result.
 */
export function applySourceBoosts(
  r: any,
  url: string,
  isNewsQuery: boolean,
): void {
  if (isPdfUrl(url)) {
    r.metadata = { ...r.metadata, isPdf: true };
    r.score = (r.score ?? 0) + 0.3;
  }

  if (/arxiv\.org|semanticscholar\.org|acm\.org\/doi|ieee\.org|openreview\.net|papers\.nips\.cc/.test(url)) {
    r.score = (r.score ?? 0) + 0.35;
    r.metadata = { ...r.metadata, isAcademic: true };
  }

  if (communityWikiPatterns.some(p => url.includes(p))) {
    r.score = (r.score ?? 0) + 0.35;
    r.metadata = { ...r.metadata, isCommunityWiki: true };
  }

  if (url.includes('wikipedia.org')) {
    r.score = (r.score ?? 0) + 0.35;
    r.metadata = { ...r.metadata, isWikipedia: true };
  }

  if (isNewsQuery && NEWS_SOURCE_BOOST.some(p => p.test(url))) {
    r.score = (r.score ?? 0) + 0.4;
    r.metadata = { ...r.metadata, isAuthoritativeNews: true };
  }
}
