# Agentic Search

多源并发、LLM 驱动的智能搜索系统。支持 20+ 领域路由、多轮迭代、流式输出，提供 Agent JSON 接口和 SSE 流式接口。

## 快速开始

```bash
# 安装依赖
npm install

# 安装 Playwright 浏览器（Serper 不可用时的 fallback）
npx playwright install chromium

# 启动搜索服务
DEEPSEEK_API_KEY=sk-xxx SERPER_API_KEY=xxx npm start

# 访问 http://localhost:3200
```

## 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `DEEPSEEK_API_KEY` | **是** | DeepSeek API key，用于查询分析、相关性评分、回答生成 |
| `SERPER_API_KEY` | 推荐 | Serper.dev API key，快速 Google 搜索。无则 fallback 到 Playwright |
| `JINA_API_KEY` | 否 | Jina Reader API key，改善正文提取质量 |
| `PORT` | 否 | 服务端口，默认 3200 |

## 架构概览

```
用户 Query
  │
  ▼
Phase 0: LLM 查询分析 ──→ 意图识别 + 语种检测 + 搜索词生成（多语种）
  │
  ▼
Phase 1: 多通道并发搜索（Lane 1-9，45s 硬超时）
  │
  ├─ Lane 1: Web 搜索 ──→ Serper API（优先）/ Bing+百度+搜狗（Playwright fallback）
  ├─ Lane 2: 学术搜索 ──→ OpenAlex + CrossRef + arXiv
  ├─ Lane 3: 领域 API ──→ 领域知识库匹配 → 调用对应 API
  ├─ Lane 4: 垂直站搜索 ──→ site:xxx.com（领域优先源）
  ├─ Lane 5: 金融 API ──→ 新浪/腾讯实时行情 + 巨潮公告
  ├─ Lane 6: PDF 搜索 ──→ filetype:pdf（多层解析）
  ├─ Lane 7: 社区 Wiki ──→ Fandom/TVTropes/PCGamingWiki/ArchWiki 等
  ├─ Lane 8: 新闻补充 ──→ 中英文新闻源
  └─ Lane 9: Wikipedia ──→ 多语种 Wikipedia API
  │
  ▼
去重 + LLM 相关性评分 + 来源加权
  │
  ▼
Phase 2: 内容抓取（Top 8 结果）
  │
  ├─ Jina Reader API（优先）
  ├─ HTML fetch + 正则提取
  ├─ arXiv → ar5iv.org HTML 镜像
  └─ PDF → docutext / unpdf / Jina 三层回退
  │
  ▼
Phase 3: LLM 回答生成
  │
  ├─ Quick Answer（摘要速答，5s 内返回）
  └─ Full Answer（深度回答，2000-4000字，带引用）
  │
  ▼
Phase 4: 质量评估 → 若不充分 → Round 2 迭代搜索
```

## 代码地图

```
src/
├── server.ts              ★ 核心入口：HTTP 服务器 + SSE/JSON API + 多通道调度 + LLM 编排
│
├── browser/
│   └── pool.ts            Playwright 浏览器池（并发控制、防检测）
│
├── methods/               搜索方法实现
│   ├── base.ts            搜索方法基类
│   ├── serper.ts          ★ Serper API（快速 Google 搜索，主力引擎）
│   ├── bing.ts            Bing 搜索（Playwright fallback）
│   ├── baidu.ts           百度搜索（fetch + Playwright 回退）
│   ├── google.ts          Google 搜索（Playwright）
│   ├── sogou.ts           搜狗搜索（Playwright）
│   ├── finance.ts         金融行情 API（新浪/腾讯）
│   ├── cninfo.ts          巨潮资讯网（公告/财报 PDF）
│   ├── pdf.ts             ★ PDF 解析（docutext → unpdf → Jina 三层回退）
│   ├── domain-api.ts      领域 API 通用调用器
│   └── index.ts           方法导出
│
├── knowledge/             领域知识库
│   ├── domain-sources.ts  ★ 领域-优先源注册表（20+ 领域，100+ 数据源）
│   └── domain-router.ts   领域检测路由（关键词 + LLM 双层检测）
│
├── llm/                   LLM 适配层
│   ├── adapter.ts         LLM 通用接口
│   └── openai.ts          ★ OpenAI 兼容 API（DeepSeek 通过此接入）
│
└── types/
    └── index.ts           核心类型定义

web/
└── index.html             ★ Web UI（搜索前端，SSE 流式展示）

integration/               ★ Agent 集成
├── API.md                 完整 API 文档
├── tool-definition.json   工具定义（OpenAI/DeepSeek function calling 格式）
├── react-agent-example.py  Python ReAct agent 示例
└── react-agent-example.ts  TypeScript ReAct agent 示例
```

## Agent 集成

本搜索服务提供 **Agent JSON 接口**，专为 ReAct / function-calling agent 设计：

```
POST /api/agent/search
Content-Type: application/json

{"query": "2026年中国GDP增速", "maxResults": 10}
```

返回结构化 JSON：

```json
{
  "answer": "...",
  "sources": [{"url": "...", "title": "...", "snippet": "..."}],
  "meta": {"intent": "finance", "lang": "zh", "elapsed_ms": 12500}
}
```

### ReAct Agent 集成步骤

1. **定义工具**：将 `integration/tool-definition.json` 中的工具定义注册到你的 agent
2. **调用搜索**：agent 决定搜索时，调用 `POST /api/agent/search`
3. **注入观察**：将返回的 `answer` + `sources` 作为 Observation 注入 agent 上下文
4. **生成回答**：agent 基于观察结果生成最终回答

完整示例见 `integration/` 目录：
- **Python**: `integration/react-agent-example.py`
- **TypeScript**: `integration/react-agent-example.ts`

详细 API 文档见 `integration/API.md`

## 多语种支持

系统自动检测查询语种（中/英/日/韩/法/德/西/葡/俄/阿/意/泰），优先搜该语种网站，最终始终用中文生成回答。

## 领域路由

自动识别 20+ 领域，路由到对应优质源：

学术论文 · 编程开发 · AI/ML · 网络安全 · 影视娱乐 · 电子书 · 音乐 · 电子硬件 · 数据统计 · 天气 · 金融股票 · 油价能源 · 星座运势 · 命理风水 · 专利 · 法律 · 医学 · 产品说明书 · 图片 · 食谱 · 旅行 · 语言词典 · 3D打印/DIY · 汽车 · 钓鱼 · 花鸟鱼虫 · 大宗商品 · 通用知识 · OSINT

## 技术栈

- **TypeScript** + Node.js (ESM)
- **Serper API** — 快速 Google 搜索（JSON，1-2s）
- **Jina Reader API** — 高质量正文提取
- **Playwright** — 浏览器自动化（fallback）
- **DeepSeek** — LLM（查询分析、评分、回答生成）
- **unpdf / docutext** — PDF 文本提取
- **SSE** — Server-Sent Events 流式返回
