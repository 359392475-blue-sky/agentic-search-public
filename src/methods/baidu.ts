import { BaseMethod } from './base.js';
import type { SearchResult, MethodConfig } from '../types/index.js';
import { withPage } from '../browser/pool.js';

/**
 * BaiduSearchMethod — 混合模式百度搜索
 *
 * 策略：
 *   1. 先用 fetch (快，2-3s) — 有概率被反爬拦截
 *   2. fetch 失败则用 Playwright 搜移动版 m.baidu.com (反爬弱)
 */
export class BaiduSearchMethod extends BaseMethod {
  readonly name = 'baidu';
  readonly config: MethodConfig = {
    name: 'baidu',
    description: 'Baidu web search — fetch with Playwright mobile fallback',
    supportedParams: ['query', 'maxResults'],
  };

  private cookie = '';
  private lastCookieRefresh = 0;

  async execute(params: Record<string, unknown>): Promise<SearchResult[]> {
    const query = (params.query as string) ?? '';
    const maxResults = (params.maxResults as number) ?? 10;
    if (!query) return [];

    // Try fetch first (fastest, ~2-3s)
    const fetchResults = await this.fetchSearch(query, maxResults);
    if (fetchResults.length > 0) return fetchResults;

    // Single Playwright fallback (desktop only, skip mobile to avoid serial blocking)
    return this.playwrightDesktopSearch(query, maxResults);
  }

  private async fetchSearch(query: string, maxResults: number): Promise<SearchResult[]> {
    try {
      // Refresh cookie if needed
      if (!this.cookie || Date.now() - this.lastCookieRefresh > 300_000) {
        try {
          const home = await fetch('https://www.baidu.com/', {
            headers: this.fetchHeaders(),
            redirect: 'manual',
            signal: AbortSignal.timeout(5_000),
          });
          const sc = home.headers.getSetCookie?.() ?? [];
          if (sc.length > 0) {
            this.cookie = sc.map(c => c.split(';')[0]).join('; ');
            this.lastCookieRefresh = Date.now();
          }
        } catch {}
      }

      const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${maxResults}&ie=utf-8`;
      const resp = await fetch(url, {
        headers: {
          ...this.fetchHeaders(),
          'Referer': 'https://www.baidu.com/',
          ...(this.cookie ? { 'Cookie': this.cookie } : {}),
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) return [];

      const html = await resp.text();
      if (html.length < 5000 || html.includes('百度安全验证')) {
        this.cookie = '';
        this.lastCookieRefresh = 0;
        return [];
      }

      return this.parseFetchResults(html, maxResults);
    } catch { return []; }
  }

  private parseFetchResults(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];
    const patterns = [
      /<h3[^>]*class="[^"]*(?:t|c-title)[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
      /<h3[^>]*>\s*<a[^>]+href="(https?:\/\/www\.baidu\.com\/link[^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
    ];
    for (const regex of patterns) {
      let match;
      while ((match = regex.exec(html)) !== null && results.length < maxResults) {
        const baiduUrl = match[1];
        const title = match[2].replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, '').trim();
        if (!title || !baiduUrl.startsWith('http')) continue;
        if (results.some(r => r.filePath === baiduUrl)) continue;

        const afterH3 = html.slice(match.index + match[0].length, match.index + match[0].length + 2000);
        let snippet = '';
        for (const pat of [/class="c-abstract[^"]*"[^>]*>([\s\S]*?)<\//, /<span class="content-right_[^"]*">([\s\S]*?)<\/span>/]) {
          const sm = afterH3.match(pat);
          if (sm) { snippet = sm[1].replace(/<[^>]+>/g, '').trim(); if (snippet.length > 15) break; }
        }

        results.push({
          filePath: baiduUrl, lines: [0],
          snippet: snippet ? `${title}\n${snippet}` : title,
          score: 1 - results.length * 0.07,
          source: 'baidu', metadata: { title, url: baiduUrl },
        });
      }
      if (results.length >= maxResults) break;
    }
    return results;
  }

  private async playwrightDesktopSearch(query: string, maxResults: number): Promise<SearchResult[]> {
    try {
      return await withPage(async (page) => {
        const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${maxResults}&ie=utf-8`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12_000 });
        await page.waitForSelector('#content_left, .c-container', { timeout: 6_000 }).catch(() => {});

        // Check for CAPTCHA
        const pageContent = await page.content();
        if (pageContent.includes('百度安全验证') || pageContent.includes('verify')) {
          return [];
        }

        return await page.evaluate((max) => {
          const results: any[] = [];
          const containers = document.querySelectorAll('.c-container[id], .result.c-container');

          for (const c of containers) {
            if (results.length >= max) break;
            const linkEl = c.querySelector('h3 a') as HTMLAnchorElement;
            if (!linkEl) continue;

            const title = linkEl.textContent?.trim() || '';
            if (!title || title.length < 4) continue;

            const href = linkEl.href || '';
            if (!href.startsWith('http')) continue;

            // Extract snippet from abstract
            const absEl = c.querySelector('.c-abstract, .content-right_8Zs40, span.content-right_8Zs40');
            const snippet = absEl?.textContent?.trim() || '';

            // Try to get real URL from data-log or mu attribute
            let realUrl = href;
            try {
              const muAttr = c.getAttribute('mu');
              if (muAttr && muAttr.startsWith('http')) realUrl = muAttr;
            } catch {}

            results.push({
              filePath: realUrl,
              lines: [0],
              snippet: snippet ? `${title}\n${snippet}` : title,
              score: 1 - results.length * 0.06,
              source: '百度',
              metadata: { title, url: realUrl },
            });
          }
          return results;
        }, maxResults);
      }, 15_000);
    } catch (e: any) {
      console.log(`  [百度PC] Playwright搜索失败: ${e.message?.slice(0, 60)}`);
      return [];
    }
  }

  private async playwrightMobileSearch(query: string, maxResults: number): Promise<SearchResult[]> {
    try {
      return await withPage(async (page) => {
        // Use mobile Baidu — much less aggressive anti-bot
        const url = `https://m.baidu.com/s?word=${encodeURIComponent(query)}&sa=tb&ts=0&t_kt=0`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await page.waitForSelector('.c-result, .c-container, #results', { timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(500);

        return await page.evaluate((max) => {
          const results: any[] = [];
          const items = document.querySelectorAll('.c-result[data-log], .result[data-log]');
          const noiseTitle = /^(大家还在搜|相关搜索|为您推荐|换一换|百度|搜索)/;
          for (const item of items) {
            if (results.length >= max) break;
            const title = item.querySelector('.c-title, .c-title-text, h3')?.textContent?.trim();
            if (!title || title.length < 4 || noiseTitle.test(title)) continue;

            // Try to get real URL from data attributes first
            let url = '';
            try {
              const log = item.getAttribute('data-log');
              if (log) {
                const parsed = JSON.parse(log);
                if (parsed.mu) url = parsed.mu;
              }
            } catch {}
            if (!url) {
              const linkEl = item.querySelector('a[href]') as HTMLAnchorElement;
              url = linkEl?.href || '';
            }
            if (!url || url.includes('m.baidu.com/s?') || url.includes('m.baidu.com/from=')) continue;

            const snippet = item.querySelector('.c-abstract, .c-span-last, .c-line-clamp')?.textContent?.trim() || '';

            results.push({
              filePath: url, lines: [0],
              snippet: snippet ? `${title}\n${snippet}` : title,
              score: 1 - results.length * 0.07,
              source: 'baidu-m', metadata: { title, url },
            });
          }
          return results;
        }, maxResults);
      });
    } catch (e: any) {
      console.log(`  [百度M] 浏览器搜索失败: ${e.message}`);
      return [];
    }
  }

  private fetchHeaders(): Record<string, string> {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
    };
  }
}
