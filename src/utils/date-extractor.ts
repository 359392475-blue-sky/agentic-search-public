/**
 * Date extraction from search result snippets, titles, and URLs.
 * Returns a Date object or null if no date found.
 */

const MONTH_MAP: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
  nov: 10, november: 10, dec: 11, december: 11,
};

const CN_RELATIVE: [RegExp, (m: RegExpMatchArray) => Date][] = [
  [/(\d+)\s*分钟前/, (m) => new Date(Date.now() - parseInt(m[1]) * 60_000)],
  [/(\d+)\s*小时前/, (m) => new Date(Date.now() - parseInt(m[1]) * 3600_000)],
  [/(\d+)\s*天前/, (m) => new Date(Date.now() - parseInt(m[1]) * 86400_000)],
  [/(\d+)\s*周前/, (m) => new Date(Date.now() - parseInt(m[1]) * 7 * 86400_000)],
  [/(\d+)\s*[个]?月前/, (m) => { const d = new Date(); d.setMonth(d.getMonth() - parseInt(m[1])); return d; }],
  [/(\d+)\s*年前/, (m) => { const d = new Date(); d.setFullYear(d.getFullYear() - parseInt(m[1])); return d; }],
  [/昨天|昨日/, () => new Date(Date.now() - 86400_000)],
  [/前天/, () => new Date(Date.now() - 2 * 86400_000)],
  [/今天|今日/, () => new Date()],
];

const EN_RELATIVE: [RegExp, (m: RegExpMatchArray) => Date][] = [
  [/(\d+)\s*minutes?\s*ago/i, (m) => new Date(Date.now() - parseInt(m[1]) * 60_000)],
  [/(\d+)\s*hours?\s*ago/i, (m) => new Date(Date.now() - parseInt(m[1]) * 3600_000)],
  [/(\d+)\s*days?\s*ago/i, (m) => new Date(Date.now() - parseInt(m[1]) * 86400_000)],
  [/(\d+)\s*weeks?\s*ago/i, (m) => new Date(Date.now() - parseInt(m[1]) * 7 * 86400_000)],
  [/(\d+)\s*months?\s*ago/i, (m) => { const d = new Date(); d.setMonth(d.getMonth() - parseInt(m[1])); return d; }],
  [/(\d+)\s*years?\s*ago/i, (m) => { const d = new Date(); d.setFullYear(d.getFullYear() - parseInt(m[1])); return d; }],
  [/\byesterday\b/i, () => new Date(Date.now() - 86400_000)],
  [/\btoday\b/i, () => new Date()],
];

const ABSOLUTE_PATTERNS: [RegExp, (m: RegExpMatchArray) => Date | null][] = [
  // "2026年5月22日" or "2026年5月"
  [/(\d{4})年(\d{1,2})月(\d{1,2})日/, (m) => new Date(+m[1], +m[2] - 1, +m[3])],
  [/(\d{4})年(\d{1,2})月/, (m) => new Date(+m[1], +m[2] - 1, 1)],
  // ISO: "2026-05-22" or "2026/05/22"
  [/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/, (m) => {
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getFullYear() >= 2000 && d.getFullYear() <= 2030 ? d : null;
  }],
  // "May 22, 2026" or "22 May 2026"
  [/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/, (m) => {
    const mon = MONTH_MAP[m[1].toLowerCase()];
    return mon !== undefined ? new Date(+m[3], mon, +m[2]) : null;
  }],
  [/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/, (m) => {
    const mon = MONTH_MAP[m[2].toLowerCase()];
    return mon !== undefined ? new Date(+m[3], mon, +m[1]) : null;
  }],
  // "Mar 2026" or "March 2026"
  [/([A-Za-z]+)\s+(\d{4})/, (m) => {
    const mon = MONTH_MAP[m[1].toLowerCase()];
    return mon !== undefined && +m[2] >= 2000 ? new Date(+m[2], mon, 1) : null;
  }],
];

// URL date patterns: /2026/05/22/ or /20260522/
const URL_DATE_PATTERNS: [RegExp, (m: RegExpMatchArray) => Date | null][] = [
  [/\/(\d{4})\/(\d{2})\/(\d{2})\//, (m) => {
    const y = +m[1]; const mon = +m[2]; const day = +m[3];
    return y >= 2000 && y <= 2030 && mon >= 1 && mon <= 12 ? new Date(y, mon - 1, day) : null;
  }],
  [/\/(\d{4})(\d{2})(\d{2})[/.]/, (m) => {
    const y = +m[1]; const mon = +m[2]; const day = +m[3];
    return y >= 2000 && y <= 2030 && mon >= 1 && mon <= 12 && day >= 1 && day <= 31 ? new Date(y, mon - 1, day) : null;
  }],
];

/**
 * Extract the most likely publication date from a search result.
 * Checks snippet, title, and URL in order.
 * Returns null if no date can be confidently extracted.
 */
export function extractDate(snippet: string, title: string, url: string): Date | null {
  const textSources = [snippet, title];

  // 1. Check relative dates first (most specific)
  for (const text of textSources) {
    if (!text) continue;
    for (const [pat, fn] of CN_RELATIVE) {
      const m = text.match(pat);
      if (m) return fn(m);
    }
    for (const [pat, fn] of EN_RELATIVE) {
      const m = text.match(pat);
      if (m) return fn(m);
    }
  }

  // 2. Check absolute dates in text
  for (const text of textSources) {
    if (!text) continue;
    for (const [pat, fn] of ABSOLUTE_PATTERNS) {
      const m = text.match(pat);
      if (m) {
        const d = fn(m);
        if (d && !isNaN(d.getTime()) && d.getFullYear() >= 2000) return d;
      }
    }
  }

  // 3. Check URL for embedded dates
  if (url) {
    for (const [pat, fn] of URL_DATE_PATTERNS) {
      const m = url.match(pat);
      if (m) {
        const d = fn(m);
        if (d && !isNaN(d.getTime())) return d;
      }
    }
  }

  return null;
}

/**
 * Calculate time-decay score modifier.
 * Returns a value from -0.2 to +0.3 based on how recent the content is.
 * For time-sensitive queries, the boost/penalty is doubled.
 */
export function timeDecayScore(date: Date | null, timeSensitive: boolean): number {
  if (!date) return 0;

  const now = Date.now();
  const ageMs = now - date.getTime();
  if (ageMs < 0) return 0; // future dates are suspicious, ignore

  const ageDays = ageMs / 86400_000;
  const multiplier = timeSensitive ? 2 : 1;

  if (ageDays <= 3) return 0.3 * multiplier;
  if (ageDays <= 7) return 0.25 * multiplier;
  if (ageDays <= 30) return 0.15 * multiplier;
  if (ageDays <= 90) return 0.08 * multiplier;
  if (ageDays <= 365) return 0;
  if (ageDays <= 365 * 3) return -0.08 * multiplier;
  return -0.15 * multiplier;
}
