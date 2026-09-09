import { BaseMethod } from './base.js';
import type { SearchResult, MethodConfig } from '../types/index.js';
import { withPage } from '../browser/pool.js';

/**
 * SogouSearchMethod — 搜狗搜索 (Playwright)
 *
 * 搜狗是腾讯旗下搜索引擎，对微信公众号文章索引极好。
 * 尤其适合中文时事类、公众号文章、行业分析报告。
 */
export class SogouSearchMethod extends BaseMethod {
  readonly name = 'sogou';
  readonly config: MethodConfig = {
    name: 'sogou',
    description: 'Sogou web search via Playwright — strong on WeChat articles',
    supportedParams: ['query', 'maxResults'],
  };

  async execute(params: Record<string, unknown>): Promise<SearchResult[]> {
    const query = (params.query as string) ?? '';
    const maxResults = (params.maxResults as number) ?? 10;
    if (!query) return [];

    try {
      return await withPage(async (page) => {
        const url = `https://www.sogou.com/web?query=${encodeURIComponent(query)}&num=${maxResults}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12_000 });
        await page.waitForSelector('.vrwrap, .rb, .results', { timeout: 6_000 }).catch(() => {});

        return await page.evaluate((max) => {
          const results: any[] = [];
          const items = document.querySelectorAll('.vrwrap, .rb');

          for (const item of items) {
            if (results.length >= max) break;

            const linkEl = item.querySelector('h3 a, .vr-title a') as HTMLAnchorElement;
            if (!linkEl) continue;

            const title = linkEl.textContent?.trim() || '';
            if (!title || title.length < 4) continue;

            const href = linkEl.href || '';
            if (!href || href.includes('sogou.com/web?')) continue;

            const snippetEl = item.querySelector('.space-txt, .str-text, .str_info, p.str-text-info, .text-layout');
            const snippet = snippetEl?.textContent?.trim() || '';

            // Skip "related searches" noise
            if (/^(相关搜索|搜狗|为您推荐)/.test(title)) continue;

            results.push({
              filePath: href,
              lines: [0],
              snippet: snippet ? `${title}\n${snippet}` : title,
              score: 0.9 - results.length * 0.06,
              source: 'sogou',
              metadata: { title, url: href },
            });
          }
          return results;
        }, maxResults);
      }, 15_000);
    } catch (e: any) {
      console.log(`  [搜狗] 搜索失败: ${e.message?.slice(0, 60)}`);
      return [];
    }
  }
}
