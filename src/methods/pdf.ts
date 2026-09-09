import { readFile } from 'node:fs/promises';
import { BaseMethod } from './base.js';
import type { SearchResult, MethodConfig } from '../types/index.js';

/**
 * PDFParserMethod — 三层 PDF 文本提取。
 *
 * Layer 1: docutext (3-40ms, 24KB, 零依赖，专为 RAG 优化)
 * Layer 2: unpdf (PDF.js 内核，处理 docutext 解不了的边缘 case)
 * Layer 3: 外部 Reader (Jina Reader 等，处理扫描版 / 图片型 PDF)
 *
 * 核心设计：
 *   - URL → fetch 下载到 buffer → 本地解析
 *   - filePath → 直接读取
 *   - 按页拆分 → 每页一个 SearchResult（方便后续精确引用）
 *   - 文本过短 (<50 char/page) 自动 fallback 到下一层
 */
export class PDFParserMethod extends BaseMethod {
  readonly name = 'pdf-parser';
  readonly config: MethodConfig = {
    name: 'pdf-parser',
    description: 'Extract text from PDF files (local or URL) with multi-layer fallback',
    supportedParams: ['url', 'filePath', 'pages', 'ocrEnabled', 'maxPages'],
  };

  async execute(params: Record<string, unknown>): Promise<SearchResult[]> {
    const url = params.url as string | undefined;
    const filePath = params.filePath as string | undefined;
    const maxPages = (params.maxPages as number) ?? 50;
    const ocrEnabled = (params.ocrEnabled as boolean) ?? true;

    const source = url ?? filePath;
    if (!source) throw new Error('Either url or filePath is required');

    // Step 1: Get PDF bytes
    const buffer = url
      ? await this.fetchPDF(url)
      : await readFile(filePath!);

    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

    // Step 2: Try docutext (fastest, purpose-built for RAG)
    const docutextResult = await this.tryDocutext(data, source, maxPages);
    if (docutextResult && this.isTextSufficient(docutextResult)) {
      return docutextResult;
    }

    // Step 3: Fallback to unpdf (PDF.js engine, handles more edge cases)
    const unpdfResult = await this.tryUnpdf(data, source, maxPages);
    if (unpdfResult && this.isTextSufficient(unpdfResult)) {
      return unpdfResult;
    }

    // Step 4: If URL and text is still insufficient, try external reader (OCR path)
    if (url && ocrEnabled) {
      const readerResult = await this.tryExternalReader(url, source);
      if (readerResult && readerResult.length > 0) {
        return readerResult;
      }
    }

    // Return whatever we got (even if sparse)
    return docutextResult ?? unpdfResult ?? [];
  }

  // ── Layer 1: docutext ──

  private async tryDocutext(
    data: Uint8Array,
    source: string,
    maxPages: number,
  ): Promise<SearchResult[] | null> {
    try {
      const { DocuText } = await import('docutext');
      const doc = DocuText.fromBuffer(data);

      const results: SearchResult[] = [];
      const pageCount = Math.min(doc.pageCount, maxPages);

      for (let i = 0; i < pageCount; i++) {
        const page = doc.pages[i];
        const text = page.text.trim();
        if (!text) continue;

        results.push({
          filePath: source,
          lines: [],
          snippet: text,
          score: 0.8,
          source: 'pdf-parser/docutext',
          metadata: {
            page: i + 1,
            totalPages: doc.pageCount,
            title: doc.metadata.title,
            author: doc.metadata.author,
            engine: 'docutext',
          },
        });
      }

      doc.dispose();
      return results.length > 0 ? results : null;
    } catch {
      return null;
    }
  }

  // ── Layer 2: unpdf (PDF.js) ──

  private async tryUnpdf(
    data: Uint8Array,
    source: string,
    maxPages: number,
  ): Promise<SearchResult[] | null> {
    try {
      const { getDocumentProxy, extractText, getMeta } = await import('unpdf');
      const pdf = await getDocumentProxy(data);

      let meta: { info: Record<string, any> } | null = null;
      try {
        meta = await getMeta(pdf);
      } catch { /* metadata extraction is optional */ }

      const { totalPages, text: pages } = await extractText(pdf, { mergePages: false });
      const results: SearchResult[] = [];
      const limit = Math.min(totalPages, maxPages);

      for (let i = 0; i < limit; i++) {
        const text = (pages as string[])[i]?.trim();
        if (!text) continue;

        results.push({
          filePath: source,
          lines: [],
          snippet: text,
          score: 0.75,
          source: 'pdf-parser/unpdf',
          metadata: {
            page: i + 1,
            totalPages,
            title: meta?.info?.Title,
            author: meta?.info?.Author,
            engine: 'unpdf',
          },
        });
      }

      return results.length > 0 ? results : null;
    } catch {
      return null;
    }
  }

  // ── Layer 3: External reader (Jina Reader for OCR) ──

  private async tryExternalReader(
    url: string,
    source: string,
  ): Promise<SearchResult[] | null> {
    try {
      const readerUrl = `https://r.jina.ai/${url}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      const resp = await fetch(readerUrl, {
        headers: {
          Accept: 'text/plain',
          'User-Agent': 'AgenticSearch/1.0',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!resp.ok) return null;
      const text = await resp.text();
      if (!text || text.length < 50) return null;

      return [{
        filePath: source,
        lines: [],
        snippet: text.slice(0, 20_000),
        score: 0.7,
        source: 'pdf-parser/jina-reader',
        metadata: {
          engine: 'jina-reader-ocr',
          textLength: text.length,
        },
      }];
    } catch {
      return null;
    }
  }

  // ── Helpers ──

  private async fetchPDF(url: string): Promise<Uint8Array> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    const resp = await fetch(url, {
      headers: {
        Accept: 'application/pdf',
        'User-Agent': 'Mozilla/5.0 (compatible; AgenticSearch/1.0)',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`PDF fetch failed: ${resp.status} ${resp.statusText}`);

    const buffer = await resp.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /**
   * Heuristic: if average characters per page < 50, the text extraction
   * likely missed content (scanned PDF, image-only, etc.)
   */
  private isTextSufficient(results: SearchResult[]): boolean {
    if (results.length === 0) return false;
    const totalChars = results.reduce((sum, r) => sum + (r.snippet?.length ?? 0), 0);
    const avgPerPage = totalChars / results.length;
    return avgPerPage >= 50;
  }
}
