import { BaseMethod } from './base.js';
import type { SearchResult, MethodConfig } from '../types/index.js';
import { withPage } from '../browser/pool.js';

export class BingSearchMethod extends BaseMethod {
  readonly name = 'bing';
  readonly config: MethodConfig = {
    name: 'bing',
    description: 'Bing web search via Playwright browser — primary search engine',
    supportedParams: ['query', 'maxResults'],
  };

  async execute(params: Record<string, unknown>): Promise<SearchResult[]> {
    const query = (params.query as string) ?? '';
    const maxResults = (params.maxResults as number) ?? 10;
    if (!query) return [];

    // Retry once if Bing redirects or fails
    for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await withPage(async (page) => {
        const hasChinese = /[\u4e00-\u9fff]/.test(query);
        // Always use www.bing.com (cn.bing.com can redirect unpredictably)
        const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}${hasChinese ? '&setlang=zh-Hans&cc=CN' : ''}`;

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await page.waitForSelector('.b_algo, #b_results', { timeout: 8_000 }).catch(() => {});

        // Verify we're on a search results page
        const pageTitle = await page.title();
        const pageUrl = page.url();
        if (!pageUrl.includes('/search') && !pageUrl.includes('q=')) {
          console.log(`  [Bing] 页面可能重定向: ${pageUrl.slice(0, 100)}`);
        }

        return await page.evaluate((max) => {
          const results: any[] = [];

          // Extract Bing knowledge panel / answer box (high-value structured data)
          const knowledgeSelectors = [
            '.b_ans .b_focusTextLarge',   // Direct answer
            '.b_ans .b_focusTextMedium',  // Direct answer (medium)
            '.b_ans .b_primText',         // Primary text answer
            '#b_results > .b_ans',        // Answer block
          ];
          for (const sel of knowledgeSelectors) {
            const el = document.querySelector(sel);
            if (el?.textContent && el.textContent.trim().length > 10) {
              results.push({
                filePath: window.location.href,
                lines: [0],
                snippet: `Bing 知识面板\n${el.textContent.trim().slice(0, 500)}`,
                score: 1.2,
                source: 'bing-panel',
                metadata: { title: 'Bing Knowledge Panel', isPanel: true },
              });
              break;
            }
          }

          // Extract sidebar entity card (e.g. company info, person bio)
          const sidebar = document.querySelector('.b_entityTP, .b_ans .ent_info, .rscontainer');
          if (sidebar?.textContent && sidebar.textContent.trim().length > 30) {
            const title = sidebar.querySelector('.b_entityTitle, .entity-title, h2')?.textContent?.trim() || 'Bing Entity';
            results.push({
              filePath: window.location.href,
              lines: [0],
              snippet: `${title}\n${sidebar.textContent.trim().replace(/\s+/g, ' ').slice(0, 600)}`,
              score: 1.15,
              source: 'bing-entity',
              metadata: { title, isEntity: true },
            });
          }

          // Regular search results
          const items = document.querySelectorAll('.b_algo');
          for (const item of items) {
            if (results.length >= max) break;

            const h2 = item.querySelector('h2');
            const linkEl = h2?.querySelector('a') as HTMLAnchorElement;
            if (!linkEl) continue;

            const url = linkEl.href;
            const title = linkEl.textContent?.trim() || '';
            if (!title || !url?.startsWith('http')) continue;
            if (url.includes('bing.com/dict') || url.includes('bing.com/images') || url.includes('microsofttranslator')) continue;

            let snippet = '';
            // Try multiple snippet selectors (Bing varies its DOM)
            for (const sel of ['.b_caption p', '.b_paractl', '.b_dList', '.b_caption .b_mText', '.b_lineclamp2']) {
              const caption = item.querySelector(sel);
              if (caption?.textContent && caption.textContent.length > 10) {
                snippet = caption.textContent.trim();
                break;
              }
            }

            results.push({
              filePath: url,
              lines: [0],
              snippet: snippet ? `${title}\n${snippet}` : title,
              score: 1 - results.length * 0.08,
              source: 'bing',
              metadata: { title, url },
            });
          }
          return results;
        }, maxResults);
      });
    } catch (e: any) {
      console.log(`  [Bing] 浏览器搜索失败 (attempt ${attempt + 1}): ${e.message}`);
      if (attempt === 1) return [];
    }
    }
    return [];
  }
}
