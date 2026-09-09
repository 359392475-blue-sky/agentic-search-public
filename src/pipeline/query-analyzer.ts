/**
 * Enhanced Query Analyzer — Phase 0 of the search pipeline.
 *
 * Combines:
 *  - Adaptive query routing (simple / medium / complex)
 *  - Answer contract (hard & soft constraints)
 *  - Constraint parsing (entities, relations, boundaries, time, aliases)
 *  - Query decomposition (complex multi-hop → sub-queries)
 *  - Alias matrix generation
 */

import type { LLMAdapter } from '../llm/adapter.js';
import { detectQueryLang, LANG_NAMES, extractEnglishTerms, type QueryLang } from './lang.js';

// ── Types ──────────────────────────────────────────

export type QueryIntent =
  | 'news' | 'academic' | 'finance' | 'entertainment'
  | 'technical' | 'legal' | 'medical' | 'shopping' | 'general';

export type QueryComplexity = 'simple' | 'medium' | 'complex';

export interface AnswerContract {
  hardConstraints: string[];
  softConstraints: string[];
  excludePatterns: string[];
}

export interface EntityAlias {
  entity: string;
  aliases: string[];
}

export interface SubQuery {
  query: string;
  purpose: string;
}

export interface AdaptiveConfig {
  maxLanes: number;
  maxRounds: number;
  maxResults: number;
  timeoutMs: number;
}

export interface QueryAnalysisResult {
  searchQueries: string[];
  enQueries: string[];
  intent: QueryIntent;
  complexity: QueryComplexity;
  timeSensitive: boolean;
  needsInternational: boolean;
  needsPdf: boolean;
  coreEntities: string[];
  answerContract: AnswerContract;
  entityAliases: EntityAlias[];
  subQueries: SubQuery[];
  adaptiveConfig: AdaptiveConfig;
  queryLang: QueryLang;
  hasChinese: boolean;
  isNonChineseNonEnglish: boolean;
}

// ── Adaptive Config Presets ────────────────────────

const ADAPTIVE_CONFIGS: Record<QueryComplexity, AdaptiveConfig> = {
  simple:  { maxLanes: 4, maxRounds: 1, maxResults: 8,  timeoutMs: 45_000  },
  medium:  { maxLanes: 7, maxRounds: 2, maxResults: 15, timeoutMs: 120_000 },
  complex: { maxLanes: 9, maxRounds: 4, maxResults: 20, timeoutMs: 180_000 },
};

// ── LLM Prompt Builder ────────────────────────────

function buildAnalysisPrompt(query: string, queryLang: QueryLang): string {
  const hasChinese = queryLang.lang === 'zh';
  const userLangName = LANG_NAMES[queryLang.lang] || queryLang.lang;

  const queriesRule = hasChinese
    ? `- queries: 2-3个中文搜索词。第一个接近原意保留核心实体名；第二个用同义词/换角度扩大覆盖面；第三个可选，精确匹配核心实体`
    : queryLang.lang === 'en'
      ? `- queries: 2-3个英文搜索词。第一个接近原意保留核心实体名；第二个用同义词/换角度扩大覆盖面`
      : `- queries: 2-3个${userLangName}搜索词（保持用户原始语种）。第一个接近原意保留核心实体名；第二个用同义词/换角度扩大覆盖面。另外再加1个中文搜索词（翻译核心含义）`;

  const enRule = hasChinese || queryLang.lang === 'en'
    ? `- queries_en: 1个英文搜索词（用正确英文术语/缩写，如CBDC/CRISPR/GAN优先；简洁3-6词）`
    : `- queries_en: 1个英文搜索词（如果用户语种不是英文，则翻译为英文；用正确术语/缩写）`;

  return `你是高级搜索引擎查询分析器。分析用户问题，完成以下所有任务：

用户输入语种: ${userLangName}
今天日期: ${new Date().toISOString().slice(0, 10)}

## 任务一：查询词生成
${queriesRule}
${enRule}
- 人名/角色名/专有名词保持完整不拆开
- 禁止编造版本号/日期/数字
- "最新"→加当前年份

## 任务二：意图分类（intent）
选择一个最匹配的：
- "news": 时事新闻、政治事件、外交动态、突发事件、政策发布
- "academic": 论文、研究、综述、算法、科研成果、实验
- "finance": 股价、财报、市值、基金、理财、汇率、经济数据
- "entertainment": 影视、游戏、动漫、音乐、明星、角色设定、剧情
- "technical": 编程、技术文档、框架用法、API、工程实践
- "legal": 法律法规、案例、判决、条文解读
- "medical": 疾病、药物、治疗方案、临床指南
- "shopping": 产品对比、购买推荐、价格、评测
- "general": 以上都不明确时

## 任务三：复杂度分级（complexity）
判断查询的复杂程度：
- "simple": 单一事实性问题、直接查询（"北京天气"、"Python 版本"、"某某是谁"）
- "medium": 需要对比/分析/解释原因的问题（"React vs Vue 对比"、"为什么 GPU 涨价"）
- "complex": 多跳推理、综合分析、需要整合多源信息（"分析中美贸易战对半导体产业链的影响"、"对比 Transformer 和 Mamba 在长序列建模中的优劣"）

## 任务四：搜索策略
- time_sensitive: 查询是否关注最新/实时信息
- needs_international: 是否需要英文/国际视角
- needs_pdf: 是否可能需要PDF文档（论文、财报、白皮书）
- core_entities: 提取查询中的核心实体（人名、组织名、专有名词、作品名）

## 任务五：答案契约（answer_contract）
定义答案必须满足的条件：
- hard_constraints: 答案必须满足的硬条件（如"必须给出具体数字"、"必须包含时间"）
- soft_constraints: 最好满足的软条件（如"最好有对比数据"、"最好包含专家观点"）
- exclude_patterns: 答案不应包含的内容（如"不要包含广告推销"）

## 任务六：实体别名（entity_aliases）
为每个核心实体生成搜索别名（翻译、缩写、其他名称），扩大搜索覆盖面：
- 格式: [{"entity": "原名", "aliases": ["别名1", "别名2"]}]
- 至少包含英文翻译（如适用）

## 任务七：子问题分解（sub_queries）—— 仅当 complexity 为 "complex" 时
将复杂问题拆解为2-3个可独立搜索的子问题：
- 格式: [{"query": "子问题查询词", "purpose": "这个子问题解决什么"}]
- 如果 complexity 不是 "complex"，返回空数组 []

用户问题: "${query}"

返回JSON:
{
  "queries": [],
  "queries_en": [],
  "intent": "",
  "complexity": "medium",
  "time_sensitive": false,
  "needs_international": false,
  "needs_pdf": false,
  "core_entities": [],
  "answer_contract": {
    "hard_constraints": [],
    "soft_constraints": [],
    "exclude_patterns": []
  },
  "entity_aliases": [],
  "sub_queries": []
}`;
}

// ── Raw LLM Response Type ─────────────────────────

interface RawAnalysis {
  queries: string[];
  queries_en: string[];
  intent: QueryIntent;
  complexity: QueryComplexity;
  time_sensitive: boolean;
  needs_international: boolean;
  needs_pdf: boolean;
  core_entities: string[];
  answer_contract: {
    hard_constraints: string[];
    soft_constraints: string[];
    exclude_patterns: string[];
  };
  entity_aliases: { entity: string; aliases: string[] }[];
  sub_queries: { query: string; purpose: string }[];
}

// ── Main Analysis Function ────────────────────────

function log(msg: string) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

export async function analyzeQuery(
  query: string,
  llm: LLMAdapter,
): Promise<QueryAnalysisResult> {
  const queryLang = detectQueryLang(query);
  const hasChinese = queryLang.lang === 'zh';
  const isNonChineseNonEnglish = queryLang.lang !== 'zh' && queryLang.lang !== 'en';

  const defaults: QueryAnalysisResult = {
    searchQueries: [query],
    enQueries: [],
    intent: 'general',
    complexity: 'medium',
    timeSensitive: false,
    needsInternational: false,
    needsPdf: false,
    coreEntities: [],
    answerContract: { hardConstraints: [], softConstraints: [], excludePatterns: [] },
    entityAliases: [],
    subQueries: [],
    adaptiveConfig: ADAPTIVE_CONFIGS.medium,
    queryLang,
    hasChinese,
    isNonChineseNonEnglish,
  };

  try {
    const prompt = buildAnalysisPrompt(query, queryLang);
    const raw = await llm.completeJSON<RawAnalysis>(prompt);

    const searchQueries = raw.queries?.length > 0
      ? raw.queries.slice(0, 3)
      : [query];
    const enQueries = raw.queries_en?.slice(0, 1) ?? [];
    if (enQueries.length > 0 && !searchQueries.some(q => q === enQueries[0])) {
      searchQueries.push(...enQueries);
    }

    const intent: QueryIntent = raw.intent || 'general';
    const complexity: QueryComplexity = raw.complexity || 'medium';
    const timeSensitive = raw.time_sensitive === true;
    const needsInternational = raw.needs_international === true;
    const needsPdf = raw.needs_pdf === true;
    const coreEntities = raw.core_entities ?? [];

    const answerContract: AnswerContract = {
      hardConstraints: raw.answer_contract?.hard_constraints ?? [],
      softConstraints: raw.answer_contract?.soft_constraints ?? [],
      excludePatterns: raw.answer_contract?.exclude_patterns ?? [],
    };

    const entityAliases: EntityAlias[] = (raw.entity_aliases ?? []).map(ea => ({
      entity: ea.entity,
      aliases: ea.aliases ?? [],
    }));

    const subQueries: SubQuery[] = complexity === 'complex'
      ? (raw.sub_queries ?? []).slice(0, 3).map(sq => ({
          query: sq.query,
          purpose: sq.purpose,
        }))
      : [];

    const adaptiveConfig = ADAPTIVE_CONFIGS[complexity];

    const userLangName = LANG_NAMES[queryLang.lang] || queryLang.lang;
    const langLabel = isNonChineseNonEnglish ? ` 🌍${userLangName}` : '';
    log(`  LLM分析: ${searchQueries.join(' | ')} [${intent}/${complexity}]${timeSensitive ? ' ⏰时效' : ''}${needsInternational ? ' 🌐国际' : ''}${needsPdf ? ' 📄PDF' : ''}${langLabel}`);
    log(`  核心实体: ${coreEntities.join(', ')}`);
    if (answerContract.hardConstraints.length > 0) {
      log(`  硬约束: ${answerContract.hardConstraints.join(' | ')}`);
    }
    if (entityAliases.length > 0) {
      log(`  别名: ${entityAliases.map(ea => `${ea.entity}→[${ea.aliases.join(',')}]`).join('; ')}`);
    }
    if (subQueries.length > 0) {
      log(`  子问题: ${subQueries.map(sq => sq.query).join(' | ')}`);
    }
    log(`  搜索配置: 最多${adaptiveConfig.maxLanes}通道, ${adaptiveConfig.maxRounds}轮, ${adaptiveConfig.maxResults}条, ${adaptiveConfig.timeoutMs / 1000}s`);

    return {
      searchQueries,
      enQueries,
      intent,
      complexity,
      timeSensitive,
      needsInternational,
      needsPdf,
      coreEntities,
      answerContract,
      entityAliases,
      subQueries,
      adaptiveConfig,
      queryLang,
      hasChinese,
      isNonChineseNonEnglish,
    };
  } catch (e: any) {
    log(`  LLM分析失败: ${e.message}，使用默认配置`);
    return defaults;
  }
}

/**
 * Collect all alias-based search queries from entity aliases.
 * Returns extra queries to run alongside the main search queries.
 */
export function getAliasQueries(analysis: QueryAnalysisResult): string[] {
  const aliasQueries: string[] = [];
  for (const ea of analysis.entityAliases) {
    for (const alias of ea.aliases.slice(0, 2)) {
      if (alias && !analysis.searchQueries.includes(alias)) {
        aliasQueries.push(alias);
      }
    }
  }
  return aliasQueries.slice(0, 4);
}
