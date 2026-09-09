/** A single search result item */
export interface SearchResult {
  /** Absolute path to the file */
  filePath: string;
  /** Matched line numbers (1-based) */
  lines: number[];
  /** The matched content snippet */
  snippet: string;
  /** Relevance score (0-1) */
  score: number;
  /** Which method produced this result */
  source: string;
  /** Optional metadata (AST node kind, symbol type, etc.) */
  metadata?: Record<string, unknown>;
}

/** Describes a single atomic search action the planner can emit */
export interface SearchAction {
  /** The search method to invoke */
  method: string;
  /** Parameters passed to the method */
  params: Record<string, unknown>;
  /** Why the planner chose this action */
  rationale: string;
}

/** A search plan is an ordered list of actions with an overall goal */
export interface SearchPlan {
  goal: string;
  actions: SearchAction[];
}

/** Configuration for a search method */
export interface MethodConfig {
  name: string;
  description: string;
  supportedParams: string[];
}

/** Strategy determines *how* to compose methods into a plan */
export interface Strategy {
  name: string;
  description: string;
  plan(query: SearchQuery): Promise<SearchPlan>;
}

/** The top-level query a caller sends to the search agent */
export interface SearchQuery {
  /** Natural language or structured query */
  query: string;
  /** Optional scope — directories, globs, file types */
  scope?: SearchScope;
  /** Hint for which strategy to use; auto-selected if omitted */
  strategy?: string;
  /** Max results to return */
  maxResults?: number;
}

export interface SearchScope {
  directories?: string[];
  includeGlobs?: string[];
  excludeGlobs?: string[];
  fileTypes?: string[];
}

/** Aggregated search response */
export interface SearchResponse {
  query: SearchQuery;
  plan: SearchPlan;
  results: SearchResult[];
  /** Total time in ms */
  elapsed: number;
  /** Diagnostic / reasoning trace */
  trace: TraceEntry[];
}

export interface TraceEntry {
  timestamp: number;
  action: string;
  detail: string;
}

// ═══════════════════════════════════════════════════════════
// Streaming / Progressive Return Protocol
// ═══════════════════════════════════════════════════════════

/**
 * SearchEvent — 流式搜索事件。
 *
 * 渐进式返回的核心协议:
 * Runner 不再等所有结果出来才返回，而是每完成一步就 yield 一个 event。
 * 前端/CLI 监听事件流，实时渲染。
 *
 * 事件顺序 (一次完整搜索):
 *   status("正在分析查询...")
 *   entities([...])                  ← 展示拆出的搜索实体
 *   status("正在搜索 3 个方向...")
 *   lane_start("RLHF training")     ← 某路开始
 *   partial_results([...])           ← ★ 第一批结果! 用户可以先看
 *   interim_summary("初步发现...")     ← ★ 第一段文字输出
 *   lane_complete("RLHF training")
 *   clues([...])                     ← 发现新线索
 *   lane_start("DPO comparison")     ← 扩展搜索开始
 *   partial_results([...])           ← 第二批结果
 *   interim_summary("进一步发现...")   ← ★ 自然衔接的第二段
 *   evaluation({...})
 *   final_results([...])             ← 完整排序后的最终结果
 *   final_summary("综合以上...")      ← ★ 最终结论
 *   done({ elapsed, totalResults })
 */
export type SearchEvent =
  | { type: 'status'; message: string }
  | { type: 'entities'; entities: SearchEntityInfo[] }
  | { type: 'lane_start'; lane: string; entity: string }
  | { type: 'lane_complete'; lane: string; resultCount: number; elapsed: number }
  | { type: 'partial_results'; results: SearchResult[]; phase: string }
  | { type: 'interim_summary'; text: string; phase: string }
  | { type: 'clues'; clues: ClueInfo[] }
  | { type: 'evaluation'; score: number; verdict: string }
  | { type: 'final_results'; results: SearchResult[] }
  | { type: 'final_summary'; text: string }
  | { type: 'quality_gate'; pass: boolean; details: string[] }
  | { type: 'trace'; entry: TraceEntry }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'done'; elapsed: number; totalResults: number };

export interface SearchEntityInfo {
  term: string;
  type: string;
  lanes: string[];
}

export interface ClueInfo {
  term: string;
  reason: string;
  confidence: number;
}
