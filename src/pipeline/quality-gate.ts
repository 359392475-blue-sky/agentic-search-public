/**
 * Multi-dimensional Quality Gate — Anti-premature Answer Gating.
 *
 * Five-dimensional quality check before accepting an answer:
 *  1. Constraint completeness — are all hard constraints satisfied?
 *  2. Entity disambiguation — are entities correctly identified?
 *  3. Boundary check — does the answer stay within scope?
 *  4. Source independence — do multiple independent sources confirm?
 *  5. Contradiction detection — are there conflicting claims?
 *
 * Outputs a confidence score (0-100) and a decision on whether to continue.
 */

import type { LLMAdapter } from '../llm/adapter.js';
import type { AnswerContract } from './query-analyzer.js';

// ── Types ──────────────────────────────────────────

export interface QualityGateResult {
  constraintCompleteness: number;   // 0-100: % of hard constraints met
  entityDisambiguation: boolean;    // entities correctly identified?
  boundaryCheck: boolean;           // answer within query scope?
  sourceIndependence: number;       // how many independent sources confirm
  contradictionFree: boolean;       // no conflicting claims?
  overallConfidence: number;        // 0-100 overall confidence
  shouldContinue: boolean;          // should we do another round?
  reason: string;                   // human-readable reason
  missingInfo: string[];            // what info is still missing
  newQueries: string[];             // suggested queries for next round
  clues: string[];                  // clues extracted from current content
}

export interface StopCondition {
  targetConfidence: number;   // stop when confidence >= this (default 85)
  maxRounds: number;          // absolute max rounds
  minConfidenceGain: number;  // stop if gain < this between rounds
  maxTimeMs: number;          // absolute time budget
}

export const DEFAULT_STOP_CONDITION: StopCondition = {
  targetConfidence: 85,
  maxRounds: 4,
  minConfidenceGain: 5,
  maxTimeMs: 180_000,
};

// ── LLM-powered Quality Evaluation ────────────────

function log(msg: string) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

export async function evaluateQuality(
  query: string,
  answer: string,
  answerContract: AnswerContract,
  contentSnippets: string[],
  sourceCount: number,
  llm: LLMAdapter,
): Promise<QualityGateResult> {
  const constraintList = answerContract.hardConstraints.length > 0
    ? answerContract.hardConstraints.map((c, i) => `${i + 1}. ${c}`).join('\n')
    : '(无特定硬约束)';

  const clueContext = contentSnippets
    .slice(0, 4)
    .map((c, i) => c.length > 50 ? `[${i + 1}] ${c.slice(0, 200)}` : '')
    .filter(Boolean)
    .join('\n');

  try {
    const result = await llm.completeJSON<{
      constraint_completeness: number;
      entity_disambiguation: boolean;
      boundary_check: boolean;
      source_independence: number;
      contradiction_free: boolean;
      overall_confidence: number;
      should_continue: boolean;
      reason: string;
      missing_info: string[];
      new_queries: string[];
      clues: string[];
    }>(`你是搜索质量评估专家。对以下搜索回答进行多维度质量评估。

用户问题: "${query}"
当前回答: "${answer.slice(0, 800)}"
来源数量: ${sourceCount}

## 硬约束清单
${constraintList}

## 已获取内容片段
${clueContext.slice(0, 1500)}

## 评估维度（每个维度独立评估）

1. **constraint_completeness** (0-100): 硬约束满足比例。检查回答是否满足了上述每个硬约束。无约束时默认80。
2. **entity_disambiguation** (boolean): 实体是否被正确识别和区分？是否有混淆不同实体的情况？
3. **boundary_check** (boolean): 回答是否在查询范围内？是否跑题或包含无关内容？
4. **source_independence** (数字): 有多少个独立信息来源支持核心结论？
5. **contradiction_free** (boolean): 回答中是否存在自相矛盾的说法？来源之间是否有冲突？
6. **overall_confidence** (0-100): 综合置信度。考虑所有维度给出整体评分。
7. **should_continue** (boolean): 是否需要继续搜索？如果置信度低于85或关键约束未满足，建议继续。
8. **reason** (string): 简述评估结论（1-2句）。
9. **missing_info** (string[]): 仍然缺失的关键信息（用于指导下一轮搜索）。
10. **new_queries** (string[]): 如果需要继续，建议2-3个精准补充搜索词。从已有内容中提取线索，生成更精准的搜索词。
11. **clues** (string[]): 从已有内容中提取的有用线索（人名、数据、关键词）。

返回JSON:
{
  "constraint_completeness": 0,
  "entity_disambiguation": true,
  "boundary_check": true,
  "source_independence": 0,
  "contradiction_free": true,
  "overall_confidence": 0,
  "should_continue": false,
  "reason": "",
  "missing_info": [],
  "new_queries": [],
  "clues": []
}`);

    const gate: QualityGateResult = {
      constraintCompleteness: result.constraint_completeness ?? 80,
      entityDisambiguation: result.entity_disambiguation !== false,
      boundaryCheck: result.boundary_check !== false,
      sourceIndependence: result.source_independence ?? sourceCount,
      contradictionFree: result.contradiction_free !== false,
      overallConfidence: result.overall_confidence ?? 50,
      shouldContinue: result.should_continue === true,
      reason: result.reason || '',
      missingInfo: result.missing_info ?? [],
      newQueries: result.new_queries ?? [],
      clues: result.clues ?? [],
    };

    log(`  质量门控: 置信度=${gate.overallConfidence} 约束满足=${gate.constraintCompleteness}% 来源=${gate.sourceIndependence}个 矛盾=${!gate.contradictionFree ? '有' : '无'} → ${gate.shouldContinue ? '继续搜索' : '结束'}`);
    if (gate.reason) log(`  原因: ${gate.reason}`);
    if (gate.missingInfo.length > 0) log(`  缺失: ${gate.missingInfo.join(', ')}`);

    return gate;
  } catch (e: any) {
    log(`  质量评估失败: ${e.message}`);
    return {
      constraintCompleteness: 50,
      entityDisambiguation: true,
      boundaryCheck: true,
      sourceIndependence: sourceCount,
      contradictionFree: true,
      overallConfidence: 50,
      shouldContinue: false,
      reason: '评估失败，默认接受当前答案',
      missingInfo: [],
      newQueries: [],
      clues: [],
    };
  }
}

/**
 * Check if the search should stop based on stop conditions.
 */
export function shouldStop(
  currentRound: number,
  elapsedMs: number,
  currentConfidence: number,
  previousConfidence: number,
  stopCondition: StopCondition,
): { stop: boolean; reason: string } {
  if (currentConfidence >= stopCondition.targetConfidence) {
    return { stop: true, reason: `置信度已达${currentConfidence}%，满足目标${stopCondition.targetConfidence}%` };
  }

  if (currentRound >= stopCondition.maxRounds) {
    return { stop: true, reason: `已达最大轮次${stopCondition.maxRounds}` };
  }

  if (elapsedMs >= stopCondition.maxTimeMs) {
    return { stop: true, reason: `已超时${Math.round(elapsedMs / 1000)}s，预算${stopCondition.maxTimeMs / 1000}s` };
  }

  const confidenceGain = currentConfidence - previousConfidence;
  if (currentRound >= 2 && confidenceGain < stopCondition.minConfidenceGain) {
    return { stop: true, reason: `置信度增益仅${confidenceGain}%，低于阈值${stopCondition.minConfidenceGain}%（边际收益递减）` };
  }

  return { stop: false, reason: '' };
}
