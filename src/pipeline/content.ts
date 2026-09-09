/**
 * Content fetching, HTML extraction, PDF parsing, and LLM answer generation.
 */

import type { LLMAdapter } from '../llm/adapter.js';
import { isPdfUrl, JS_RENDER_SITES } from './filters.js';

function log(msg: string) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

// ────────────────────────────────────────────
// HTML main content extraction
// ────────────────────────────────────────────
export function extractMainContent(html: string): string {
  let clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  for (const pat of [/<article[^>]*>([\s\S]+?)<\/article>/i, /<main[^>]*>([\s\S]+?)<\/main>/i]) {
    const m = clean.match(pat);
    if (m && m[1].length > 300) { clean = m[1]; break; }
  }

  let text = clean
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/li>/gi, '\n').replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&ldquo;/g, '\u201c').replace(/&rdquo;/g, '\u201d')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => { const c = parseInt(n); return c > 31 && c < 65536 ? String.fromCharCode(c) : ''; })
    .replace(/[ \t]+/g, ' ');

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length >= 4);
  const siteChrome = /网易支付|免费邮箱|VIP邮箱|客户端下载|免费注册|申请入驻|扫码二维码|分享至好友|首页\s*>/;
  const filtered = lines.filter(line => {
    if (siteChrome.test(line)) return false;
    const words = line.split(/\s+/);
    if (words.length > 5 && words.every(w => w.length <= 4)) return false;
    if (words.length > 8 && line.length < words.length * 5) return false;
    if (/^\s*[\w\u4e00-\u9fff]+(\s*[>›»/]\s*[\w\u4e00-\u9fff]+){2,}/.test(line)) return false;
    return true;
  });

  text = filtered.join('\n');
  const noise = [/TA获得超过[\d.]+万?个赞/g, /版权声明[\s\S]{0,200}?侵权/g, /©\s*\d{4}[^.\n]{0,50}/g, /阅读全文/g, /\d+人赞同了该回答/g];
  for (const p of noise) text = text.replace(p, '');

  return text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, 10000);
}

// ────────────────────────────────────────────
// PDF parsing (multi-layer fallback)
// ────────────────────────────────────────────
export async function parsePdfFromUrl(url: string, maxPages = 10): Promise<string> {
  try {
    const { PDFParserMethod } = await import('../methods/pdf.js');
    const parser = new PDFParserMethod();
    const results = await parser.execute({ url, maxPages });
    if (results.length === 0) return '';
    const combined = results.map(r => r.snippet || '').join('\n\n---PAGE---\n\n');
    return combined.slice(0, 8000);
  } catch (e: any) {
    log(`  [PDF] 解析失败 ${url.slice(0, 60)}: ${e.message}`);
    return '';
  }
}

// ────────────────────────────────────────────
// Jina Reader API
// ────────────────────────────────────────────
export async function fetchViaJina(url: string): Promise<string> {
  const resp = await fetch(`https://r.jina.ai/${url}`, {
    headers: { Accept: 'text/plain' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`Jina ${resp.status}`);
  const text = await resp.text();
  return text.slice(0, 10000);
}

// ────────────────────────────────────────────
// Content fetching (multi-layer fallback chain)
// ────────────────────────────────────────────
export async function fetchContents(results: any[]): Promise<string[]> {
  return Promise.all(results.map(async (r): Promise<string> => {
    const url = r.filePath || '';
    if (!url.startsWith('http')) return r.snippet ?? '';

    // arXiv: use ar5iv.org HTML mirror
    const arxivIdMatch = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/);
    if (arxivIdMatch) {
      try {
        const ar5ivUrl = `https://ar5iv.org/abs/${arxivIdMatch[1]}`;
        const ar5ivResp = await fetch(ar5ivUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(12_000),
        });
        if (ar5ivResp.ok) {
          const html = await ar5ivResp.text();
          const content = extractMainContent(html);
          if (content.length > 200) return content.slice(0, 8000);
        }
      } catch {}
    }

    // PDF URLs
    if (isPdfUrl(url)) {
      const pdfText = await parsePdfFromUrl(url);
      if (pdfText.length > 50) return pdfText;
      return r.snippet ?? '';
    }

    // Primary: Jina Reader API
    try {
      const jinaText = await fetchViaJina(url);
      if (jinaText.length > 100) return jinaText;
    } catch {}

    // Fallback 1: JS-heavy sites → Playwright
    if (JS_RENDER_SITES.some(s => url.includes(s))) {
      try {
        const { withPage } = await import('../browser/pool.js');
        const html = await withPage(async (page) => {
          await page.goto(url, { timeout: 12_000, waitUntil: 'networkidle' });
          return page.content();
        }, 15_000);
        const content = extractMainContent(html);
        return content.length > 50 ? content : (r.snippet ?? '');
      } catch { return r.snippet ?? ''; }
    }

    // Fallback 2: Direct fetch + regex extraction
    try {
      const isBaiduLink = url.includes('baidu.com/link');
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html, application/pdf',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          ...(isBaiduLink ? { 'Referer': 'https://www.baidu.com/' } : {}),
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(6_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const ct = resp.headers.get('content-type') || '';

      if (ct.includes('application/pdf')) {
        try {
          const { extractText, getDocumentProxy } = await import('unpdf');
          const buf = new Uint8Array(await resp.arrayBuffer());
          const pdf = await getDocumentProxy(buf);
          const { text: pages } = await extractText(pdf, { mergePages: false });
          const combined = (pages as string[]).slice(0, 10).join('\n\n').trim();
          if (combined.length > 50) return combined.slice(0, 8000);
        } catch {}
        return r.snippet ?? '';
      }

      if (!ct.includes('text/html') && !ct.includes('text/plain')) return r.snippet ?? '';
      const html = await resp.text();
      const content = extractMainContent(html);
      if (content.length > 50) return content;
      throw new Error('content too short');
    } catch {
      // Fallback 3: Playwright
      try {
        const { withPage } = await import('../browser/pool.js');
        const html = await Promise.race([
          withPage(async (page) => {
            await page.goto(url, { timeout: 8_000, waitUntil: 'domcontentloaded' });
            return page.content();
          }),
          new Promise<string>((_, rej) => setTimeout(() => rej(new Error('pw timeout')), 10_000)),
        ]);
        const content = extractMainContent(html);
        return content.length > 50 ? content : (r.snippet ?? '');
      } catch { return r.snippet ?? ''; }
    }
  }));
}

// ────────────────────────────────────────────
// LLM-powered answer generation
// ────────────────────────────────────────────
export async function buildAnswerWithLLM(query: string, results: any[], contents: string[], llm: LLMAdapter): Promise<string> {
  if (results.length === 0) return '未找到相关信息。';

  const contextParts: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const title = results[i].metadata?.title || (results[i].snippet ?? '').split('\n')[0]?.slice(0, 80) || '';
    const url = results[i].filePath || '';
    const content = (contents[i] || '').trim();
    const snippet = (results[i].snippet ?? '').trim();
    let text = content.length > 100 ? content.slice(0, 8000) : snippet.slice(0, 1000);
    text = text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text.length > 30) {
      contextParts.push(`[${i + 1}] ${title}\n链接: ${url}\n内容: ${text}`);
    }
  }
  if (contextParts.length === 0) return '未找到相关信息。';

  try {
    return await llm.complete(
      `你是专业的搜索引擎回答生成器。根据搜索结果，生成高质量的结构化回答。

核心规则：
1. 直接回答，开头就给出核心答案（数字/结论/事实），禁止"根据搜索结果"等废话
2. 引用格式 [N]，N为搜索结果编号
3. 提取一切具体细节：数字、价格、日期、人名、列表、百分比
4. 结构化输出：用 **加粗** 标注关键数据，用列表/表格组织复杂信息
5. 始终用中文回答（无论搜索结果或用户输入是什么语种），自然流畅，专业严谨
6. 写长、写深、写全——每个要点都要展开2-3句解释，包含具体数据、方法细节和应用场景。目标字数2000-4000字
7. 不编造，不猜测
8. 如果没有直接答案，提供最接近的相关信息和背景知识
9. 涉及金融数据时：标注数据时间，区分实时/历史
10. 涉及学术论文时：给出作者、年份、期刊、核心方法和关键数据
11. 如果搜索结果中有多个不同时间的数据（如估值、价格、排名），以**日期最近的**为准，开头第一句话就给出最新的那个数据点
12. 今天是 ${new Date().toISOString().slice(0, 10)}，离今天越近的数据越可信越重要。如果出现矛盾（如来源A说3000亿、来源B说8520亿），以日期最新的为准
13. 时间线/历史数据按**从新到旧**排列
14. 综合所有搜索来源中的信息，不要遗漏重要数据点。每个来源中有用的信息都要提取出来并整合

用户问题: ${query}

搜索结果:
${contextParts.join('\n\n---\n\n')}`
    );
  } catch (e: any) {
    log(`  LLM回答失败: ${e.message}`);
    return contextParts.slice(0, 3).map(p => p.split('\n').pop()?.replace('内容: ', '') || '').filter(s => s.length > 30).join('\n\n') || '未找到相关信息。';
  }
}
