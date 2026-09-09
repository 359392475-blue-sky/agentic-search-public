# Agentic Search — 架构文档 & 代码地图

> 本文档是给 AI 和新开发者快速理解项目结构的入口。

## 1. 系统总览

Agentic Search 是一个自主搜索引擎，通过 Playwright 浏览器自动化 + LLM 智能调度，实现了：
- **多源并发搜索**（7 条并行通道）
- **LLM 实体提取 + 回答生成**（DeepSeek）
- **多轮迭代搜索**（质量不充分时自动 Round 2）
- **SSE 流式返回**（渐进式输出，先给速答再给深度答案）

---

## 2. 数据流（从用户 Query 到最终回答）

```
User Query (via Web UI POST /api/search)
       │
       ▼
  ┌─────────────────────────────────────┐
  │  Phase 0: LLM 实体提取              │  src/server.ts:96-140
  │  - 生成 3 个中文 + 1 个英文搜索词     │
  │  - 判断是否学术 (academic flag)      │
  └──────────────┬──────────────────────┘
                 │
       ▼
  ┌─────────────────────────────────────┐
  │  Phase 1: 7 通道并发搜索             │  src/server.ts:142-387
  │                                     │
  │  Lane 1: Web 搜索                   │  Bing(主) + 百度 + 搜狗 + Google
  │  Lane 2: 学术搜索                   │  Bing site:arxiv/scholar + API
  │  Lane 3: 领域 API                   │  DomainRouter → DomainSearchMethod
  │  Lane 4: 垂直站搜索                  │  site:xxx.com (领域优先源)
  │  Lane 5: 金融 API                   │  新浪/腾讯行情 + 巨潮公告
  │  Lane 6: PDF 搜索                   │  filetype:pdf (英文优先)
  │  Lane 7: Fandom Wiki               │  site:fandom.com (游戏/影视)
  │                                     │
  │  45s 硬超时 → Promise.race          │
  └──────────────┬──────────────────────┘
                 │
       ▼
  ┌─────────────────────────────────────┐
  │  去重 + 噪声过滤 + 相关性排序         │  src/server.ts:389-412
  │  - URL 去重 (seen Set)              │
  │  - noisePatterns 过滤               │
  │  - 关键词匹配加权                    │
  │  - PDF/arXiv/Fandom 额外加分         │
  └──────────────┬──────────────────────┘
                 │
       ▼
  ┌─────────────────────────────────────┐
  │  Phase 2a: Quick Answer (摘要速答)   │  src/server.ts:430-453
  │  - 用 Top 6 snippet 即时生成        │
  │  - 和内容抓取并行                    │
  │                                     │
  │  Phase 2b: 内容抓取 fetchContents    │  src/server.ts:623-715
  │  - arXiv → ar5iv.org HTML 镜像      │
  │  - PDF → docutext/unpdf/Jina 三层   │
  │  - JS 重站 → Playwright 渲染        │
  │  - 普通页面 → fetch + 正则提取正文    │
  │                                     │
  │  Phase 2c: Deep Answer (深度回答)    │  src/server.ts:765-809
  │  - LLM 结构化回答生成               │
  └──────────────┬──────────────────────┘
                 │
       ▼
  ┌─────────────────────────────────────┐
  │  Phase 3: 质量评估 + Round 2         │  src/server.ts:459-559
  │  - LLM 判断回答是否充分              │
  │  - 若不充分：提取线索 → 新搜索词      │
  │  - Round 2: 再跑 Bing+百度+搜狗      │
  │  - 重建回答 → sendSSE answer(round2) │
  └──────────────┬──────────────────────┘
                 │
       ▼
  ┌─────────────────────────────────────┐
  │  Phase 4: 缓存 + SSE done           │  src/server.ts:564-584
  └─────────────────────────────────────┘
```

---

## 3. 目录结构 & 每个文件的职责

### 根目录

| 文件 | 说明 |
|------|------|
| `package.json` | 项目配置，三个依赖：playwright-core, docutext, unpdf |
| `tsconfig.json` | TypeScript 配置 (ESM, ES2022) |
| `docker-compose.searxng.yml` | SearXNG 可选部署（暂未启用） |

### `src/server.ts` — 核心搜索服务 (★ 最重要的文件)

**~920 行**，包含完整的搜索流程：
- **L1-17**: 导入和实例化搜索引擎
- **L21-28**: DeepSeek LLM 配置
- **L30-39**: 搜索方法实例化（Google/Bing/百度/搜狗/学术/金融）
- **L42-43**: 搜索缓存（内存 Map，10 min TTL）
- **L66-584**: `handleStreamSearch()` — 搜索主流程
  - L96-140: Phase 0 实体提取
  - L142-387: Phase 1 七通道并发
  - L389-412: 去重 + 排序
  - L425-457: Phase 2 Quick/Deep Answer
  - L459-559: Phase 3 质量评估 + Round 2
  - L564-584: Phase 4 缓存
- **L590-606**: PDF URL 识别
- **L608-621**: PDF 解析入口
- **L623-715**: `fetchContents()` — 内容抓取
- **L717-759**: `extractMainContent()` — HTML 正文提取
- **L765-809**: `buildAnswerWithLLM()` — LLM 回答生成
- **L815-827**: HN Algolia API
- **L832-849**: 中英翻译辅助词典
- **L854-919**: HTTP 服务器 + 静态文件

### `src/browser/pool.ts` — Playwright 浏览器池

- 单例 Browser + Context，最多 8 个并发 Page
- 带队列的并发控制（超过 MAX_CONCURRENT_PAGES 排队等待）
- Stealth 配置（绕过 navigator.webdriver 检测）
- 60s 空闲自动关闭
- 对外暴露：`withPage(fn, timeout?)` / `closeBrowser()`

### `src/methods/` — 搜索方法

每个搜索方法继承 `SearchMethodBase`，实现 `execute(params)` → `SearchResult[]`。

| 文件 | 搜索源 | 实现方式 |
|------|--------|----------|
| `bing.ts` | Bing.com | Playwright 浏览器自动化，解析 DOM 结果 |
| `baidu.ts` | 百度 | fetch(移动端) + Playwright(桌面端) 三层回退 |
| `google.ts` | Google.com | Playwright（受 GFW 限制） |
| `sogou.ts` | 搜狗 | Playwright，微信公众号优势 |
| `finance.ts` | 新浪/腾讯财经 | HTTP API（实时行情） |
| `cninfo.ts` | 巨潮资讯网 | HTTP API（上市公司公告 PDF） |
| `pdf.ts` | PDF 解析器 | docutext → unpdf → Jina Reader 三层回退 |
| `domain-api.ts` | 领域 API 通用调用 | 根据 DomainSource.url 模板调用 |
| `duckduckgo.ts` | DuckDuckGo | 即时回答 API |
| `web.ts` | 通用网页 | HTTP fetch |
| `web-reader.ts` | 网页阅读器 | 抓取 + 提取正文 |
| `searxng.ts` | SearXNG | 私有部署的元搜索 |
| `grep.ts` / `glob.ts` / `ast.ts` / `semantic.ts` | 本地代码搜索 | CLI 模式下使用 |

### `src/methods/academic/` — 学术搜索

| 文件 | 说明 |
|------|------|
| `semantic-scholar.ts` | Semantic Scholar API（引用图谱、TLDR、嵌入）|
| `arxiv.ts` | arXiv API（CS/物理/数学预印本） |
| `crossref.ts` | CrossRef DOI 元数据 |
| `citation-crawler.ts` | 引用链爬取（从种子论文扩展） |
| `oa-finder.ts` | 开放获取 PDF 查找（Unpaywall 等） |

### `src/knowledge/` — 领域知识库

| 文件 | 说明 |
|------|------|
| `domain-sources.ts` | **领域-优先源注册表**：12 大领域（tech/finance/academic/media/knowledge 等），60+ 数据源，每个源标注 accessMethod/why/example |
| `domain-router.ts` | **领域路由器**：关键词匹配 + LLM 双层检测。输入 query → 输出匹配的领域 + 优先源 + site:xxx 搜索词 |
| `domain-evolver.ts` | **自进化设计**：从真实 query 中学习新领域 + 新数据源 |

### `src/llm/` — LLM 适配层

| 文件 | 说明 |
|------|------|
| `adapter.ts` | `LLMAdapter` 接口定义（`complete()` / `completeJSON()`） |
| `openai.ts` | OpenAI 兼容适配器（**实际连接 DeepSeek**）|
| `anthropic.ts` | Anthropic Claude 适配 |
| `ollama.ts` | 本地 Ollama 适配 |

### `src/core/` — 核心引擎组件

> 注意：实际的搜索调度已内联到 `server.ts`。这些文件是原始架构设计的模块化拆分，可用于未来重构。

| 文件 | 说明 |
|------|------|
| `streaming-runner.ts` | 流式搜索运行器（N 轮迭代 + SSE 事件流） |
| `engine.ts` | 搜索引擎编排（方法注册 + 策略选择） |
| `decomposer.ts` | 查询分解（拆分复合问题） |
| `entity-extractor.ts` | 实体提取（人名/组织/术语） |
| `planner.ts` | 搜索计划生成 |
| `executor.ts` | 计划执行器 |
| `evaluator.ts` | 结果评估器 |
| `quality-gate.ts` | 质量门控（是否需要继续搜索） |
| `fusion.ts` | 多源结果融合 |
| `clue-analyzer.ts` | 线索分析（从第一轮结果提取扩展方向） |
| `context-compactor.ts` | 上下文压缩（控制 LLM 上下文长度） |
| `cache.ts` | 搜索缓存 |
| `memory.ts` | 搜索记忆 |
| `runner.ts` | 基础运行器 |

### `src/strategies/` — 搜索策略

| 文件 | 说明 |
|------|------|
| `keyword.ts` | 关键词搜索（grep + glob） |
| `exploratory.ts` | 探索式搜索（AST + semantic） |
| `academic-deep.ts` | 学术深度搜索（引用链 + 全文） |
| `structural.ts` | 结构化搜索 |

### `src/formatters/` — 输出格式化

| 文件 | 说明 |
|------|------|
| `progressive.ts` | SSE 渐进式输出 |
| `json.ts` | JSON 格式 |
| `pretty.ts` | 终端美化输出 |

### `src/types/index.ts` — 核心类型

- `SearchResult` — 搜索结果项（filePath, snippet, score, source, metadata）
- `SearchAction` / `SearchPlan` — 搜索计划
- `SearchQuery` / `SearchScope` — 查询输入
- `Strategy` / `MethodConfig` — 策略和方法配置
- `SearchEvent` — SSE 事件流类型

### `web/index.html` — Web 前端

单文件 SPA，内联 CSS + JS：
- 搜索框 + 实时状态
- SSE 监听，渐进式展示 quick_answer → answer → sources
- Markdown 渲染

---

## 4. 关键技术决策

### 4.1 为什么主搜索直接在 server.ts 而不用 StreamingRunner？

原始设计是 core/ 下的模块化架构（StreamingRunner → Engine → Planner → Executor），但实际开发中发现：
- 多通道调度的细粒度控制（如不同 Lane 不同超时、条件触发）在单个函数中更直观
- SSE 事件的发射时机需要和搜索流程紧耦合
- 性能敏感：减少抽象层级 = 减少延迟

**core/ 的模块作为架构备份保留**，未来如果需要支持多种搜索模式（CLI/API/Agent），可以将 server.ts 的逻辑回迁到 StreamingRunner。

### 4.2 Playwright 浏览器池设计

- 单例 Browser 复用（启动 chromium 很重），多 Page 并发
- MAX_CONCURRENT_PAGES = 8，超出排队
- Stealth 模式：禁用 webdriver 检测、randomize viewport/UA
- 60s 空闲自动关闭（释放内存）

### 4.3 GFW 适配

- Google.com / arxiv.org/pdf → 直接被墙
- 解决方案：
  - Google → 仅对英文 query 尝试，短超时
  - arXiv PDF → 走 ar5iv.org HTML 镜像
  - Semantic Scholar API → 限流 429 → 改为 Bing site:semanticscholar.org

### 4.4 PDF 三层解析

1. `docutext` — 最快，支持本地 PDF
2. `unpdf` (基于 pdf.js) — 通用性好
3. Jina Reader API — 云端解析（最后兜底）

---

## 5. 配置要点

| 配置项 | 位置 | 当前值 |
|--------|------|--------|
| DeepSeek API Key | 环境变量 `DEEPSEEK_API_KEY` | 必须设置 |
| LLM Model | `src/server.ts:23` | `deepseek-chat` |
| LLM maxTokens | `src/server.ts:27` | 8192 |
| 浏览器并发上限 | `src/browser/pool.ts:17` | 8 |
| 搜索缓存 TTL | `src/server.ts:43` | 10 分钟 |
| 全局超时 | `src/server.ts:78` | 150 秒 |
| 搜索并发超时 | `src/server.ts:386` | 45 秒 |
| 服务端口 | `src/server.ts:913` | 3200 |

---

## 6. SSE 事件协议

Web UI 通过 `POST /api/search` 接收 SSE 事件流：

| 事件名 | 数据 | 时机 |
|--------|------|------|
| `status` | `{ message }` | 搜索各阶段状态提示 |
| `entities` | `{ queries, academic }` | Phase 0 完成后 |
| `sources` | `{ sources: [{index, title, url, source}] }` | Phase 1 排序后 / Phase 4 最终 |
| `quick_answer` | `{ text }` | Phase 2a 速答 |
| `answer` | `{ text, round? }` | Phase 2c / Phase 3 深度回答 |
| `done` | `{ total, elapsed, sources, rounds }` | 搜索完成 |
| `error` | `{ message }` | 出错时 |

---

## 7. 依赖

| 包 | 用途 | 版本 |
|----|------|------|
| `playwright-core` | 浏览器自动化（Bing/百度/搜狗/Google） | ^1.60 |
| `docutext` | PDF 文本提取（第一层） | ^1.2 |
| `unpdf` | PDF 文本提取（第二层，基于 pdf.js） | ^1.6 |
| `tsx` | TypeScript 运行时（dev） | ^4.21 |
| `typescript` | 编译器（dev） | ^6.0 |

---

## 8. 常用命令

```bash
npm run serve    # 启动搜索服务（开发模式，tsx）
npm run build    # 编译 TypeScript
npm run start    # CLI 模式启动
node dist/server.js  # 生产模式启动
```
