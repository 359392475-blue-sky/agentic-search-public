"""
Agentic Search — ReAct Agent 集成示例 (Python)

ReAct 循环: Thought → Action → Observation → ... → Answer

依赖:
  pip install openai requests

环境变量:
  DEEPSEEK_API_KEY  — DeepSeek API key (agent 自身的 LLM)
  SEARCH_API_URL    — 搜索服务地址，默认 http://localhost:3200
"""

import os
import json
import requests
from openai import OpenAI

SEARCH_API = os.getenv("SEARCH_API_URL", "http://localhost:3200")

# ── 搜索工具定义 ──
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": (
                "搜索互联网获取最新信息。在以下场景触发："
                "1) 实时数据（新闻/股价/天气/油价/汇率）；"
                "2) 需要验证的事实；"
                "3) 训练数据截止后的事件；"
                "4) 用户明确要求搜索。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词，尽量精确具体",
                    }
                },
                "required": ["query"],
            },
        },
    }
]


def call_search(query: str, max_results: int = 10) -> dict:
    """调用 Agentic Search 的 agent JSON 接口"""
    resp = requests.post(
        f"{SEARCH_API}/api/agent/search",
        json={"query": query, "maxResults": max_results},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def react_agent(user_query: str, model: str = "deepseek-chat") -> str:
    """
    ReAct agent 主循环

    Thought → Action(web_search) → Observation → ... → Final Answer
    最多 3 轮搜索，防止无限循环
    """
    client = OpenAI(
        api_key=os.getenv("DEEPSEEK_API_KEY"),
        base_url="https://api.deepseek.com/v1",
    )

    messages = [
        {
            "role": "system",
            "content": (
                "你是一个智能助手，可以调用 web_search 工具搜索互联网。"
                "如果问题需要最新信息或你不确定答案，请主动搜索。"
                "搜索返回的 answer 字段是已经整理好的回答，sources 是来源列表。"
                "你可以直接引用搜索结果，也可以结合自身知识进行补充和修正。"
                "始终用中文回答。"
            ),
        },
        {"role": "user", "content": user_query},
    ]

    max_rounds = 3
    for round_num in range(max_rounds):
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
        )

        msg = response.choices[0].message

        # 没有 tool call → 直接返回最终回答
        if not msg.tool_calls:
            return msg.content or ""

        # 处理 tool calls
        messages.append(msg)

        for tool_call in msg.tool_calls:
            if tool_call.function.name == "web_search":
                args = json.loads(tool_call.function.arguments)
                query = args.get("query", user_query)

                print(f"  🔍 [Round {round_num + 1}] 搜索: {query}")
                result = call_search(query)

                # 构造观察结果：answer + 来源摘要
                observation = result.get("answer", "未找到结果")
                sources = result.get("sources", [])
                if sources:
                    source_summary = "\n".join(
                        f"  [{i+1}] {s.get('title', '')} — {s.get('url', '')}"
                        for i, s in enumerate(sources[:5])
                    )
                    observation += f"\n\n来源:\n{source_summary}"

                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": observation,
                    }
                )

    # 超过最大轮数，让模型用已有信息回答
    messages.append({"role": "user", "content": "请根据已有的搜索结果给出最终回答。"})
    final = client.chat.completions.create(model=model, messages=messages)
    return final.choices[0].message.content or ""


# ── 使用示例 ──
if __name__ == "__main__":
    queries = [
        "今天黄金价格多少？",
        "2026年中国新能源汽车销量排名",
        "帮我解释一下量子纠缠",  # 这个不需要搜索，模型应该直接回答
    ]

    for q in queries:
        print(f"\n{'='*60}")
        print(f"用户: {q}")
        print(f"{'='*60}")
        answer = react_agent(q)
        print(f"\n助手: {answer[:500]}...")
