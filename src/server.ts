import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleSearchMethod } from './methods/google.js';
import { BingSearchMethod } from './methods/bing.js';
import { BaiduSearchMethod } from './methods/baidu.js';
import { DomainSearchMethod } from './methods/domain-api.js';
import { SemanticScholarMethod } from './methods/academic/semantic-scholar.js';
import { DomainRouter } from './knowledge/domain-router.js';
import { FinanceMethod } from './methods/finance.js';
import { CninfoMethod } from './methods/cninfo.js';
import { SogouSearchMethod } from './methods/sogou.js';
import { SerperSearchMethod } from './methods/serper.js';
import { OpenAIAdapter } from './llm/openai.js';
import type { LLMAdapter } from './llm/adapter.js';
import { closeBrowser } from './browser/pool.js';

// Orchestrator + Memory + Middleware
import { SearchOrchestrator, type SSECallback } from './orchestrator/index.js';
import { SQLiteMemoryStore } from './memory/sqlite-store.js';
import { checkAuth, getAuthConfig } from './middleware/auth.js';

const __dirname = join(fileURLToPath(import.meta.url), '..');

// ── Model Layer ────────────────────────────────────

const llm: LLMAdapter = new OpenAIAdapter({
  provider: 'custom',
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY || '',
  baseUrl: 'https://api.deepseek.com/v1',
  temperature: 0.3,
  maxTokens: 8192,
});

// ── Tool Layer ─────────────────────────────────────

const google = new GoogleSearchMethod();
const bing = new BingSearchMethod();
const baidu = new BaiduSearchMethod();
const domainMethod = new DomainSearchMethod();
const semanticScholar = new SemanticScholarMethod();
const domainRouter = new DomainRouter(llm);
const finance = new FinanceMethod();
const cninfo = new CninfoMethod();
const sogou = new SogouSearchMethod();
const serper = new SerperSearchMethod();

// ── Memory Layer ───────────────────────────────────

const memory = new SQLiteMemoryStore('./agentic-search.db');

// ── Orchestration Layer ────────────────────────────

const orchestrator = new SearchOrchestrator(llm, memory, {
  google, bing, baidu, serper, sogou,
  semanticScholar, domainMethod,
  finance, cninfo, domainRouter,
});

// ── Helpers ────────────────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

function sendSSE(res: ServerResponse, event: string, data: any) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

// ── HTTP Server ────────────────────────────────────

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Auth + Rate Limit
  const authResult = checkAuth(req, res);
  if (!authResult.ok) return;

  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  // SSE streaming search endpoint
  if (req.method === 'POST' && url.pathname === '/api/search') {
    const body = await readBody(req);
    try {
      const { query, maxResults = 15 } = JSON.parse(body);
      if (!query) { res.writeHead(400); res.end('{"error":"query required"}'); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });

      const onEvent: SSECallback = (event, data) => sendSSE(res, event, data);
      await orchestrator.search(query, maxResults, onEvent);
      res.end();
    } catch (err: any) {
      if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
      else { sendSSE(res, 'error', { message: err.message }); res.end(); }
    }
    return;
  }

  // Agent JSON endpoint
  if (req.method === 'POST' && url.pathname === '/api/agent/search') {
    const body = await readBody(req);
    try {
      const { query, maxResults = 15 } = JSON.parse(body);
      if (!query) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"query required"}'); return; }

      const events: { type: string; data: any }[] = [];
      const onEvent: SSECallback = (event, data) => events.push({ type: event, data });
      const result = await orchestrator.search(query, maxResults, onEvent);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        answer: result.answer,
        sources: result.sources.slice(0, maxResults),
        meta: {
          query,
          intent: events.find(e => e.type === 'entities')?.data?.intent || 'general',
          lang: events.find(e => e.type === 'entities')?.data?.lang || 'zh',
          total_results: result.stats.total || 0,
          rounds: result.stats.rounds || 1,
          elapsed_ms: result.stats.elapsed || 0,
          complexity: result.stats.complexity || 'medium',
          confidence: result.stats.confidence || 0,
        },
        evidenceSummary: result.evidenceSummary,
      }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Memory stats endpoint
  if (req.method === 'GET' && url.pathname === '/api/memory/stats') {
    try {
      const stats = await memory.getStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Static file serving
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  const fullPath = join(__dirname, '..', 'web', filePath);
  const ext = extname(fullPath);
  try {
    const content = await readFile(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(content);
  } catch {
    try {
      const indexContent = await readFile(join(__dirname, '..', 'web', 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indexContent);
    } catch { res.writeHead(404); res.end('Not Found'); }
  }
});

// ── Startup ────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3200', 10);

async function start() {
  await memory.init();
  server.listen(PORT, () => {
    console.log(`\n  🔍 Agentic Search v1.0: http://localhost:${PORT}`);
    console.log('  ────────────────────────────────────');
    if (!process.env.DEEPSEEK_API_KEY) {
      console.log('  ⚠️  DEEPSEEK_API_KEY 未设置');
    } else {
      console.log('  ✓ 模型层: DeepSeek LLM');
    }
    if (serper.isAvailable) {
      console.log('  ✓ 工具层: Serper API (Google JSON, 1-2s)');
    } else {
      console.log('  ⚠️  SERPER_API_KEY 未设置，使用 Playwright (较慢)');
    }
    console.log('  ✓ 工具层: Jina Reader (内容提取)');
    console.log('  ✓ 编排层: Orchestrator (自适应路由 + 多轮迭代)');
    console.log('  ✓ 记忆层: 已初始化');
    const auth = getAuthConfig();
    console.log(`  ${auth.authEnabled ? '✓' : '⚠️'} 认证: ${auth.authEnabled ? 'Bearer Token 已启用' : '未设置 API_TOKEN，API 开放访问'}`);
    console.log(`  ✓ 限流: ${auth.rateLimit} req/min`);
    console.log('  ────────────────────────────────────\n');
  });
}

start().catch(e => { console.error('启动失败:', e); process.exit(1); });

process.on('SIGINT', async () => { await memory.close(); await closeBrowser(); process.exit(0); });
process.on('SIGTERM', async () => { await memory.close(); await closeBrowser(); process.exit(0); });
