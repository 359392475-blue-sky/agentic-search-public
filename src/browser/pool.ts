import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

/**
 * BrowserPool — 共享浏览器实例，提供页面给各搜索方法使用。
 *
 * 设计：
 *   - 单例 Browser，多个 page 并发
 *   - 自动管理生命周期：首次使用时 launch，idle 后自动关闭
 *   - page 用完归还，避免泄漏
 *   - stealth 配置：绕过常见反爬检测
 */

let _browser: Browser | null = null;
let _context: BrowserContext | null = null;
let _activePages = 0;
let _idleTimer: ReturnType<typeof setTimeout> | null = null;
const MAX_CONCURRENT_PAGES = 8;
let _waitQueue: (() => void)[] = [];

const IDLE_TIMEOUT = 60_000;

async function ensureBrowser(): Promise<BrowserContext> {
  if (_context && _browser?.isConnected()) {
    try {
      // Smoke-test: verify context is alive
      await _context.pages();
      return _context;
    } catch {
      console.log('[BrowserPool] Context broken, rebuilding...');
      await closeBrowser();
    }
  }

  if (_browser && !_browser.isConnected()) {
    console.log('[BrowserPool] Browser disconnected, rebuilding...');
    _context = null;
    _browser = null;
  }

  if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }

  _browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--mute-audio',
      '--no-first-run',
    ],
  });

  _context = await _browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: {
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  });

  await _context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // @ts-ignore
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
  });

  return _context;
}

export async function acquirePage(): Promise<Page> {
  if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }

  // Throttle: wait if too many pages are open (with 15s queue timeout)
  if (_activePages >= MAX_CONCURRENT_PAGES) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = _waitQueue.indexOf(resolve);
        if (idx >= 0) _waitQueue.splice(idx, 1);
        reject(new Error('acquirePage queue timeout 15s'));
      }, 15_000);
      _waitQueue.push(() => { clearTimeout(timer); resolve(); });
    });
  }

  const ctx = await ensureBrowser();
  _activePages++;
  const page = await ctx.newPage();
  return page;
}

export async function releasePage(page: Page): Promise<void> {
  try { await page.close(); } catch {}
  _activePages--;

  // Wake up a waiting acquirePage caller
  if (_waitQueue.length > 0) {
    const next = _waitQueue.shift()!;
    next();
  }

  if (_activePages <= 0) {
    _activePages = 0;
    _idleTimer = setTimeout(closeBrowser, IDLE_TIMEOUT);
  }
}

export async function closeBrowser(): Promise<void> {
  if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
  try { await _context?.close(); } catch {}
  try { await _browser?.close(); } catch {}
  _context = null;
  _browser = null;
}

/**
 * Run a function with a managed page, auto-release on completion.
 */
export async function withPage<T>(fn: (page: Page) => Promise<T>, timeoutMs = 20_000): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const page = await acquirePage();
    try {
      return await Promise.race([
        fn(page),
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`withPage timeout ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
    } catch (e: any) {
      const isCrash = e.message?.includes('Target closed') || e.message?.includes('Browser closed')
        || e.message?.includes('disposed') || e.message?.includes('Connection closed');
      if (isCrash && attempt === 0) {
        console.log('[BrowserPool] Browser crashed, restarting...');
        try { await releasePage(page); } catch {}
        await closeBrowser();
        continue;
      }
      throw e;
    } finally {
      try { await releasePage(page); } catch {}
    }
  }
  throw new Error('withPage failed after retry');
}
