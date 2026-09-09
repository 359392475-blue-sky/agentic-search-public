/**
 * Agentic Search — ReAct Agent 集成示例 (TypeScript/Node.js)
 *
 * ReAct 循环: Thought → Action → Observation → ... → Answer
 *
 * 依赖: npm install openai
 * 环境变量:
 *   DEEPSEEK_API_KEY  — Agent LLM 的 API key
 *   SEARCH_API_URL    — 搜索服务地址，默认 http://localhost:3200
 */

const SEARCH_API = process.env.SEARCH_API_URL || 'http://localhost:3200';

// ── 搜索工具定义 ──
const SEARCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description:
      '搜索互联网获取最新信息。在以下场景触发：' +
      '1) 实时数据（新闻/股价/天气/油价/汇率）；' +
      '2) 需要验证的事实；3) 训练数据截止后的事件；' +
      '4) 用户明确要求搜索。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词，尽量精确具体' },
      },
      required: ['query'],
    },
  },
};

// ── 搜索服务返回类型 ──
interface SearchResponse {
  answer: string;
  sources: { url: string; title: string; snippet: string }[];
  meta: {
    query: string;
    intent: string;
    lang: string;
    total_results: number;
    rounds: number;
    elapsed_ms: number;
  };
}

/** 调用 Agentic Search 的 agent JSON 接口 */
async function callSearch(query: string, maxResults = 10): Promise<SearchResponse> {
  const resp = await fetch(`${SEARCH_API}/api/agent/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, maxResults }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!resp.ok) throw new Error(`Search API error: ${resp.status}`);
  return resp.json();
}

/**
 * ReAct Agent 主循环
 * 最多 3 轮搜索，自动判断是否需要搜索
 */
async function reactAgent(userQuery: string): Promise<string> {
  const messages: any[] = [
    {
      role: 'system',
      content:
        '你是一个智能助手，可以调用 web_search 工具搜索互联网。' +
        '如果问题需要最新信息或你不确定答案，请主动搜索。' +
        '搜索返回的内容已整理好，你可以直接引用或补充修正。始终用中文回答。',
    },
    { role: 'user', content: userQuery },
  ];

  const MAX_ROUNDS = 3;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        tools: [SEARCH_TOOL],
        tool_choice: 'auto',
      }),
    });

    const data = await resp.json() as any;
    const msg = data.choices?.[0]?.message;
    if (!msg) break;

    // 没有 tool call → 最终回答
    if (!msg.tool_calls?.length) {
      return msg.content || '';
    }

    messages.push(msg);

    for (const tc of msg.tool_calls) {
      if (tc.function.name === 'web_search') {
        const args = JSON.parse(tc.function.arguments);
        console.log(`  🔍 [Round ${round + 1}] 搜索: ${args.query}`);

        const result = await callSearch(args.query);
        const observation = result.answer +
          (result.sources?.length
            ? '\n\n来源:\n' + result.sources.slice(0, 5)
                .map((s, i) => `  [${i + 1}] ${s.title} — ${s.url}`)
                .join('\n')
            : '');

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: observation,
        });
      }
    }
  }

  return '搜索超过最大轮数，请简化问题后重试。';
}

// ── 使用示例 ──
async function main() {
  const queries = [
    '今天黄金价格多少？',
    '2026年中国新能源汽车销量排名',
    '帮我解释一下量子纠缠',
  ];

  for (const q of queries) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`用户: ${q}`);
    console.log('='.repeat(60));
    const answer = await reactAgent(q);
    console.log(`\n助手: ${answer.slice(0, 500)}...`);
  }
}

main().catch(console.error);
