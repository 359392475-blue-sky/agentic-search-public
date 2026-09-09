import { BaseMethod } from './base.js';
import type { SearchResult, MethodConfig } from '../types/index.js';
import { withPage } from '../browser/pool.js';

export class GoogleSearchMethod extends BaseMethod {
  readonly name = 'google';
  readonly config: MethodConfig = {
    name: 'google',
    description: 'Google web search via Playwright browser automation',
    supportedParams: ['query', 'maxResults'],
  };

  async execute(params: Record<string, unknown>): Promise<SearchResult[]> {
    const query = (params.query as string) ?? '';
    const maxResults = (params.maxResults as number) ?? 10;
    if (!query) return [];

    try {
      return await withPage(async (page) => {
        const hasChinese = /[\u4e00-\u9fff]/.test(query);
        const hl = hasChinese ? 'zh-CN' : 'en';
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${maxResults}&hl=${hl}`;

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8_000 });

        // Handle consent/cookie dialog if present
        try {
          const consentBtn = page.locator('button:has-text("Accept all"), button:has-text("全部接受"), button:has-text("I agree")');
          if (await consentBtn.isVisible({ timeout: 2000 })) {
            await consentBtn.click();
            await page.waitForTimeout(500);
          }
        } catch {}

        // Wait for results
        await page.waitForSelector('#search, #rso, .g', { timeout: 8_000 }).catch(() => {});

        return await page.evaluate((max) => {
          const results: any[] = [];
          const blocks = document.querySelectorAll('.g, [data-sokoban-container]');

          for (const block of blocks) {
            if (results.length >= max) break;

            const linkEl = block.querySelector('a[href^="http"]') as HTMLAnchorElement;
            if (!linkEl) continue;
            const url = linkEl.href;
            if (!url || url.includes('google.com/search') || url.includes('accounts.google')) continue;

            const h3 = block.querySelector('h3');
            const title = h3?.textContent?.trim() || '';
            if (!title) continue;

            // Snippet: various selectors Google uses
            let snippet = '';
            for (const sel of ['.VwiC3b', '[data-sncf]', '.lEBKkf', '.s3v9rd']) {
              const el = block.querySelector(sel);
              if (el?.textContent && el.textContent.length > 20) {
                snippet = el.textContent.trim();
                break;
              }
            }

            results.push({
              filePath: url,
              lines: [0],
              snippet: snippet ? `${title}\n${snippet}` : title,
              score: 1.1 - results.length * 0.06,
              source: 'google',
              metadata: { title, url },
            });
          }
          return results;
        }, maxResults);
      });
    } catch (e: any) {
      console.log(`  [Google] 浏览器搜索失败: ${e.message}`);
      return [];
    }
  }
}
