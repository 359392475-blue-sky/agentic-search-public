/**
 * Citation Verification — URL alive detection and cross-validation.
 *
 * After answer generation, verifies that cited URLs are accessible
 * and marks dead links. Lightweight HEAD-request based approach.
 */

// ── Types ──────────────────────────────────────────

export interface CitationCheckResult {
  index: number;           // [N] citation index
  url: string;
  alive: boolean;
  statusCode: number | null;
  responseTimeMs: number;
}

export interface VerificationSummary {
  total: number;
  alive: number;
  dead: number;
  results: CitationCheckResult[];
}

// ── URL Extraction ─────────────────────────────────

/**
 * Extract citation indices from the answer text.
 * Looks for patterns like [1], [2], etc.
 */
export function extractCitationIndices(answer: string): number[] {
  const matches = answer.matchAll(/\[(\d+)\]/g);
  const indices = new Set<number>();
  for (const m of matches) {
    const idx = parseInt(m[1], 10);
    if (idx > 0 && idx <= 50) indices.add(idx);
  }
  return Array.from(indices).sort((a, b) => a - b);
}

// ── URL Alive Check ────────────────────────────────

async function checkUrl(url: string, timeoutMs: number = 3000): Promise<{ alive: boolean; statusCode: number | null; responseTimeMs: number }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AgenticSearch/1.0; +https://github.com/agentic-search)',
      },
    });

    clearTimeout(timer);
    const responseTimeMs = Date.now() - start;

    // Consider 2xx and 3xx as alive; some sites return 403 for HEAD but work for GET
    const alive = response.status < 400 || response.status === 403 || response.status === 405;
    return { alive, statusCode: response.status, responseTimeMs };
  } catch (e: any) {
    const responseTimeMs = Date.now() - start;

    // Abort means timeout — URL might still be alive but slow
    if (e.name === 'AbortError') {
      return { alive: false, statusCode: null, responseTimeMs };
    }

    return { alive: false, statusCode: null, responseTimeMs };
  }
}

// ── Main Verification Function ─────────────────────

function log(msg: string) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

/**
 * Verify citations in the answer against the source list.
 * Checks if cited URLs are accessible via HEAD requests.
 *
 * @param answer - The generated answer text containing [N] citations
 * @param sources - The source list with urls, indexed from 1
 * @param timeoutPerUrl - Timeout for each URL check in ms (default 3000)
 * @returns Verification summary with alive/dead status for each citation
 */
export async function verifyCitations(
  answer: string,
  sources: { index: number; url: string; title: string }[],
  timeoutPerUrl: number = 3000,
): Promise<VerificationSummary> {
  const citedIndices = extractCitationIndices(answer);

  if (citedIndices.length === 0) {
    return { total: 0, alive: 0, dead: 0, results: [] };
  }

  // Map citation indices to URLs
  const urlMap = new Map<number, string>();
  for (const src of sources) {
    urlMap.set(src.index, src.url);
  }

  // Check all cited URLs in parallel
  const checks = await Promise.allSettled(
    citedIndices.map(async (idx): Promise<CitationCheckResult> => {
      const url = urlMap.get(idx);
      if (!url) {
        return { index: idx, url: '', alive: false, statusCode: null, responseTimeMs: 0 };
      }

      // Skip checking certain domains that block HEAD requests
      if (/arxiv\.org|nature\.com|ieee\.org|sciencedirect\.com/.test(url)) {
        return { index: idx, url, alive: true, statusCode: 200, responseTimeMs: 0 };
      }

      const result = await checkUrl(url, timeoutPerUrl);
      return { index: idx, url, ...result };
    }),
  );

  const results: CitationCheckResult[] = checks
    .map(r => r.status === 'fulfilled' ? r.value : null)
    .filter((r): r is CitationCheckResult => r !== null);

  const alive = results.filter(r => r.alive).length;
  const dead = results.filter(r => !r.alive).length;

  if (dead > 0) {
    const deadCitations = results.filter(r => !r.alive).map(r => `[${r.index}]`).join(', ');
    log(`  引用验证: ${alive}/${results.length} 可访问, 失效: ${deadCitations}`);
  } else {
    log(`  引用验证: ${alive}/${results.length} 全部可访问`);
  }

  return { total: results.length, alive, dead, results };
}

/**
 * Annotate the answer text with dead citation markers.
 * Adds "(⚠️ 来源不可访问)" after dead citations.
 */
export function annotateDeadCitations(
  answer: string,
  verification: VerificationSummary,
): string {
  if (verification.dead === 0) return answer;

  let annotated = answer;
  const deadIndices = new Set(
    verification.results.filter(r => !r.alive).map(r => r.index),
  );

  for (const idx of deadIndices) {
    // Only annotate the first occurrence to avoid clutter
    annotated = annotated.replace(
      new RegExp(`\\[${idx}\\](?!.*⚠️)`),
      `[${idx}](⚠️ 来源不可访问)`,
    );
  }

  return annotated;
}
