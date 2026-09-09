# Agentic Search API 文档

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 安装浏览器（首次）
npx playwright install chromium

# 3. 启动服务
DEEPSEEK_API_KEY=sk-xxx SERPER_API_KEY=xxx npm start
```

服务启动后监听 `http://localhost:3200`

---

## 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `DEEPSEEK_API_KEY` | **是** | DeepSeek API key，用于查询分析和回答生成 |
| `SERPER_API_KEY` | 推荐 | Serper.dev API key，提供快速 Google 搜索。无则 fallback 到 Playwright（慢 10x） |
| `PORT` | 否 | 服务端口，默认 3200 |

---

## API 接口

### 1. Agent JSON 接口（推荐）

**专为 ReAct / function-calling agent 设计，返回结构化 JSON。**

```
POST /api/agent/search
Content-Type: application/json
```

**请求体：**
```json
{
  "query": "2026年中国GDP增速",
  "maxResults": 10
}
```

**响应：**
```json
{
  "answer": "根据国家统计局数据，2026年第一季度中国GDP同比增长5.2%...",
  "sources": [
    {
      "url": "https://example.com/article",
      "title": "2026年一季度GDP数据发布",
      "snippet": "国家统计局今日发布..."
    }
  ],
  "meta": {
    "query": "2026年中国GDP增速",
    "intent": "finance",
    "lang": "zh",
    "total_results": 42,
    "rounds": 1,
    "elapsed_ms": 12500
  }
}
```

**字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `answer` | string | LLM 整理的结构化回答（2000-4000字），含引用标记 `[1]` `[2]` |
| `sources` | array | 信息来源列表，每项含 url/title/snippet |
| `meta.intent` | string | 查询意图分类：news/academic/finance/entertainment/technical/legal/medical/general |
| `meta.lang` | string | 检测到的查询语种 |
| `meta.total_results` | number | 搜索到的总结果数 |
| `meta.rounds` | number | 搜索轮数（1 或 2） |
| `meta.elapsed_ms` | number | 总耗时（毫秒） |

**超时：** 建议客户端设置 120s 超时。复杂查询可能需要 30-60s。

---

### 2. SSE 流式接口（前端用）

**返回 Server-Sent Events 流，适合前端实时展示搜索进度。**

```
POST /api/search
Content-Type: application/json
```

请求体同上。返回 `text/event-stream`，事件类型：

| 事件 | 数据 | 说明 |
|------|------|------|
| `status` | `{message}` | 搜索进度（"正在分析问题..."） |
| `entities` | `{queries, intent, lang}` | LLM 提取的搜索实体和意图 |
| `quick_answer` | `{text}` | 快速摘要回答（几秒内返回） |
| `answer` | `{text, round?}` | 完整回答（第1轮或第2轮） |
| `sources` | `{sources}` | 来源列表 |
| `done` | `{total, elapsed, rounds}` | 搜索完成统计 |
| `error` | `{message}` | 错误信息 |

---

## ReAct Agent 集成

### 工具定义（Function Calling）

```json
{
  "type": "function",
  "function": {
    "name": "web_search",
    "description": "搜索互联网获取最新信息。当遇到实时数据查询、事实核查、或训练数据截止后的事件时调用。",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "搜索关键词，尽量精确具体"
        }
      },
      "required": ["query"]
    }
  }
}
```

### 何时触发搜索（LLM 自动判断）

将上述工具定义传给 LLM，设 `tool_choice: "auto"`，模型会在需要时自动调用。

**典型触发场景：**
- 时效性问题："今天的新闻" "最新的..."
- 实时数据："黄金价格" "天气" "股价" "汇率"
- 不确定的事实："XXX 是谁" "XXX 有多少"
- 需要来源："帮我查一下..." "有没有相关研究"

**不应触发的场景：**
- 闲聊："你好" "谢谢"
- 数学计算："1+1等于多少"
- 代码生成："写一个排序算法"
- 模型知识内的常识

### 集成代码示例

- **Python**: `integration/react-agent-example.py`
- **TypeScript**: `integration/react-agent-example.ts`
- **工具定义 JSON**: `integration/tool-definition.json`

---

## 多语种支持

搜索系统自动检测查询语种（支持中/英/日/韩/法/德/西/葡/俄/阿/意/泰），优先搜该语种的网站，但始终用中文生成回答。

---

## 领域路由

系统自动识别 20+ 领域并路由到对应的优质源：

学术论文 | 编程开发 | AI/ML | 网络安全 | 影视娱乐 | 电子书 | 音乐 | 电子硬件 | 数据统计 | 天气 | 金融股票 | 油价能源 | 星座运势 | 命理风水 | 专利 | 法律 | 医学 | 产品说明书 | 图片 | 食谱 | 旅行 | 语言词典 | 3D打印/DIY | 汽车 | 钓鱼 | 花鸟鱼虫 | 大宗商品 | 通用知识 | OSINT
