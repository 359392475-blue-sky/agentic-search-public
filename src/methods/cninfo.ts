import { BaseMethod } from './base.js';
import type { SearchResult, MethodConfig } from '../types/index.js';

/**
 * CninfoMethod — 巨潮资讯网 (cninfo.com.cn) 免费公告搜索
 *
 * 中国 A 股上市公司的官方信息披露平台，所有年报/季报/公告 PDF 均可免费下载。
 * API 无需 key，直接 POST JSON，返回公告列表 + PDF 下载链接。
 */
export class CninfoMethod extends BaseMethod {
  readonly name = 'cninfo';
  readonly config: MethodConfig = {
    name: 'cninfo',
    description: '巨潮资讯网 — 中国上市公司公告/财报 PDF 搜索',
    supportedParams: ['query', 'stockCode', 'maxResults'],
  };

  // Map company names to cninfo stock codes (6-digit)
  private static readonly CODE_MAP: Record<string, { code: string; orgId: string; market: string }> = {
    '金山办公': { code: '688111', orgId: '', market: 'szse' },
    '比亚迪': { code: '002594', orgId: '', market: 'szse' },
    '宁德时代': { code: '300750', orgId: '', market: 'szse' },
    '茅台': { code: '600519', orgId: '', market: 'sse' },
    '贵州茅台': { code: '600519', orgId: '', market: 'sse' },
    '中国平安': { code: '601318', orgId: '', market: 'sse' },
    '招商银行': { code: '600036', orgId: '', market: 'sse' },
    '格力电器': { code: '000651', orgId: '', market: 'szse' },
    '美的集团': { code: '000333', orgId: '', market: 'szse' },
    '隆基绿能': { code: '601012', orgId: '', market: 'sse' },
    '科大讯飞': { code: '002230', orgId: '', market: 'szse' },
    '寒武纪': { code: '688256', orgId: '', market: 'szse' },
    '中信证券': { code: '600030', orgId: '', market: 'sse' },
    '海康威视': { code: '002415', orgId: '', market: 'szse' },
    '五粮液': { code: '000858', orgId: '', market: 'szse' },
    '恒瑞医药': { code: '600276', orgId: '', market: 'sse' },
    '迈瑞医疗': { code: '300760', orgId: '', market: 'szse' },
    '万科': { code: '000002', orgId: '', market: 'szse' },
    '工商银行': { code: '601398', orgId: '', market: 'sse' },
  };

  async execute(params: Record<string, unknown>): Promise<SearchResult[]> {
    const query = (params.query as string) ?? '';
    const maxResults = (params.maxResults as number) ?? 5;

    // Extract stock code from query
    let stockCode = '';
    let stockName = '';
    const sortedNames = Object.keys(CninfoMethod.CODE_MAP).sort((a, b) => b.length - a.length);
    for (const name of sortedNames) {
      if (query.includes(name)) {
        stockCode = CninfoMethod.CODE_MAP[name].code;
        stockName = name;
        break;
      }
    }

    // Also try to extract 6-digit stock code directly from query
    if (!stockCode) {
      const codeMatch = query.match(/\b(\d{6})\b/);
      if (codeMatch) stockCode = codeMatch[1];
    }

    const results: SearchResult[] = [];

    // Strategy 1: Full-text search on cninfo
    try {
      const searchResults = await this.fullTextSearch(query, maxResults);
      results.push(...searchResults);
    } catch {}

    // Strategy 2: If we have a stock code, search for its annual/quarterly reports
    if (stockCode) {
      try {
        const filingResults = await this.searchFilings(stockCode, stockName, maxResults);
        results.push(...filingResults);
      } catch {}
    }

    return results;
  }

  private async fullTextSearch(query: string, maxResults: number): Promise<SearchResult[]> {
    const resp = await fetch('http://www.cninfo.com.cn/new/fulltextSearch/full?searchkey=' + encodeURIComponent(query) + '&sdate=&edate=&isfulltext=false&sortName=pubdate&sortType=desc&pageNum=1&pageSize=' + maxResults, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'http://www.cninfo.com.cn/new/fulltextSearch',
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!resp.ok) return [];
    const data = await resp.json() as any;
    const announcements = data?.announcements ?? [];

    return announcements.slice(0, maxResults).map((a: any, i: number) => {
      const pdfUrl = a.adjunctUrl ? `http://static.cninfo.com.cn/${a.adjunctUrl}` : '';
      const title = (a.announcementTitle || '').replace(/<[^>]+>/g, '');
      const orgName = a.secName || '';
      const pubDate = a.announcementTime ? new Date(a.announcementTime).toISOString().slice(0, 10) : '';

      return {
        filePath: pdfUrl,
        lines: [0],
        snippet: `${orgName} — ${title} (${pubDate})\n公告类型: ${a.announcementType || '未分类'}\n下载: ${pdfUrl}`,
        score: 1.5 - i * 0.1, // High priority for official filings
        source: 'cninfo',
        metadata: {
          title: `${orgName} ${title}`,
          url: pdfUrl,
          isPdf: true,
          pubDate,
          stockCode: a.secCode || '',
        },
      };
    });
  }

  private async searchFilings(stockCode: string, stockName: string, maxResults: number): Promise<SearchResult[]> {
    // Search for annual and quarterly reports specifically
    const categories = ['category_ndbg_szsh', 'category_bndbg_szsh', 'category_sjdbg_szsh']; // 年报、半年报、季报
    const allResults: SearchResult[] = [];

    for (const cat of categories) {
      try {
        const body = new URLSearchParams({
          stock: `${stockCode},gssz0${stockCode}`,
          tabName: 'fulltext',
          pageSize: '3',
          pageNum: '1',
          column: 'szse',
          category: cat,
          plate: '',
          seDate: '',
          searchkey: '',
          secid: '',
          sortName: '',
          sortType: '',
          isHLtitle: 'true',
        });

        const resp = await fetch('http://www.cninfo.com.cn/new/hisAnnouncement/query', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Referer': 'http://www.cninfo.com.cn/',
          },
          body: body.toString(),
          signal: AbortSignal.timeout(8_000),
        });

        if (!resp.ok) continue;
        const data = await resp.json() as any;
        const anns = data?.announcements ?? [];

        for (const a of anns.slice(0, 2)) {
          const pdfUrl = a.adjunctUrl ? `http://static.cninfo.com.cn/${a.adjunctUrl}` : '';
          if (!pdfUrl) continue;
          const title = (a.announcementTitle || '').replace(/<[^>]+>/g, '');
          const pubDate = a.announcementTime ? new Date(a.announcementTime).toISOString().slice(0, 10) : '';

          allResults.push({
            filePath: pdfUrl,
            lines: [0],
            snippet: `${stockName || stockCode} — ${title} (${pubDate})\n下载: ${pdfUrl}`,
            score: 1.8 - allResults.length * 0.1,
            source: 'cninfo',
            metadata: {
              title: `${stockName} ${title}`,
              url: pdfUrl,
              isPdf: true,
              pubDate,
              stockCode,
            },
          });
        }
      } catch {}
    }

    return allResults.slice(0, maxResults);
  }
}
