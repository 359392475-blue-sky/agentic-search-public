/**
 * Evidence Matrix — Constraint satisfaction scoring for search results.
 *
 * Evaluates each candidate result against the answer contract's hard constraints,
 * producing a structured evidence matrix. Combined with multi-dimensional ranking
 * fusion to produce final scores.
 */

import type { LLMAdapter } from '../llm/adapter.js';
import type { AnswerContract, QueryIntent } from './query-analyzer.js';

// ── Types ──────────────────────────────────────────

export interface ConstraintScore {
  constraint: string;
  satisfied: boolean;
  confidence: number;   // 0-1
  evidence: string;     // supporting snippet
}

export interface ResultEvidence {
  resultIndex: number;
  url: string;
  constraintScores: ConstraintScore[];
  constraintSatisfaction: number; // 0-1 average
}

export interface EvidenceMatrixResult {
  entries: ResultEvidence[];
}

// ── Multi-dimensional Score Weights ───────────────

interface ScoreWeights {
  keyword: number;
  llmRelevance: number;
  timeDecay: number;
  constraintSatisfaction: number;
  sourceCredibility: number;
}

const INTENT_WEIGHTS: Record<QueryIntent, ScoreWeights> = {
  news:          { keyword: 0.15, llmRelevance: 0.25, timeDecay: 0.30, constraintSatisfaction: 0.15, sourceCredibility: 0.15 },
  academic:      { keyword: 0.10, llmRelevance: 0.25, timeDecay: 0.10, constraintSatisfaction: 0.20, sourceCredibility: 0.35 },
  finance:       { keyword: 0.15, llmRelevance: 0.20, timeDecay: 0.25, constraintSatisfaction: 0.15, sourceCredibility: 0.25 },
  entertainment: { keyword: 0.20, llmRelevance: 0.30, timeDecay: 0.10, constraintSatisfaction: 0.20, sourceCredibility: 0.20 },
  technical:     { keyword: 0.15, llmRelevance: 0.30, timeDecay: 0.10, constraintSatisfaction: 0.20, sourceCredibility: 0.25 },
  legal:         { keyword: 0.10, llmRelevance: 0.20, timeDecay: 0.15, constraintSatisfaction: 0.20, sourceCredibility: 0.35 },
  medical:       { keyword: 0.10, llmRelevance: 0.20, timeDecay: 0.15, constraintSatisfaction: 0.20, sourceCredibility: 0.35 },
  shopping:      { keyword: 0.20, llmRelevance: 0.30, timeDecay: 0.20, constraintSatisfaction: 0.15, sourceCredibility: 0.15 },
  general:       { keyword: 0.15, llmRelevance: 0.30, timeDecay: 0.15, constraintSatisfaction: 0.20, sourceCredibility: 0.20 },
};

// ── Evidence Matrix Builder ───────────────────────

function log(msg: string) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

/**
 * Build an evidence matrix by evaluating top results against constraints.
 * Uses LLM to assess constraint satisfaction for each result.
 * Only runs when there are actual hard constraints to check.
 */
export async function buildEvidenceMatrix(
  query: string,
  results: any[],
  constraints: string[],
  llm: LLMAdapter,
): Promise<EvidenceMatrixResult> {
  if (constraints.length === 0 || results.length === 0) {
    return { entries: [] };
  }

  // Only evaluate top results to stay within token limits
  const evalResults = results.slice(0, 10);
  const resultSummaries = evalResults.map((r, i) => {
    const title = r.metadata?.title || '';
    const snippet = (r.snippet || '').slice(0, 200);
    const url = r.filePath || '';
    return `[${i + 1}] ${title}\nURL: ${url}\n${snippet}`;
  }).join('\n\n');

  const constraintList = constraints.map((c, i) => `${i + 1}. ${c}`).join('\n');

  try {
    const raw = await llm.completeJSON<{
      results: {
        index: number;
        constraints: { id: number; satisfied: boolean; confidence: number; evidence: string }[];
      }[];
    }>(`你是证据评估专家。对以下搜索结果逐一评估其是否满足各个约束条件。

用户问题: "${query}"

## 约束条件
${constraintList}

## 候选搜索结果
${resultSummaries.slice(0, 4000)}

对每个搜索结果，评估它对每个约束的满足情况：
- satisfied: 该结果是否提供了满足该约束的信息
- confidence: 0-1 的置信度（0=完全没有相关信息, 1=明确满足）
- evidence: 支持判断的简短摘要（10-30字）

返回JSON:
{
  "results": [
    {
      "index": 1,
      "constraints": [
        {"id": 1, "satisfied": true, "confidence": 0.8, "evidence": "简短证据"}
      ]
    }
  ]
}`);

    const entries: ResultEvidence[] = (raw.results || []).map(r => {
      const idx = r.index - 1;
      if (idx < 0 || idx >= evalResults.length) return null;

      const cScores: ConstraintScore[] = (r.constraints || []).map(c => ({
        constraint: constraints[(c.id || 1) - 1] || '',
        satisfied: c.satisfied === true,
        confidence: Math.max(0, Math.min(1, c.confidence || 0)),
        evidence: c.evidence || '',
      }));

      const avgSatisfaction = cScores.length > 0
        ? cScores.reduce((sum, cs) => sum + (cs.satisfied ? cs.confidence : 0), 0) / cScores.length
        : 0;

      return {
        resultIndex: idx,
        url: evalResults[idx].filePath || '',
        constraintScores: cScores,
        constraintSatisfaction: avgSatisfaction,
      };
    }).filter((e): e is ResultEvidence => e !== null);

    log(`  证据矩阵: ${entries.length}条结果 × ${constraints.length}个约束`);
    const topSatisfied = entries.filter(e => e.constraintSatisfaction > 0.5).length;
    log(`  约束满足: ${topSatisfied}/${entries.length} 条结果满足>50%约束`);

    return { entries };
  } catch (e: any) {
    log(`  证据矩阵构建失败: ${e.message}`);
    return { entries: [] };
  }
}

/**
 * Apply evidence matrix scores to results and re-rank using
 * multi-dimensional score fusion.
 */
export function applyEvidenceScores(
  results: any[],
  matrix: EvidenceMatrixResult,
  intent: QueryIntent,
): void {
  const weights = INTENT_WEIGHTS[intent] || INTENT_WEIGHTS.general;

  // Build index lookup from matrix
  const evidenceMap = new Map<number, ResultEvidence>();
  for (const entry of matrix.entries) {
    evidenceMap.set(entry.resultIndex, entry);
  }

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const evidence = evidenceMap.get(i);

    // Decompose existing score into components (approximate)
    const existingScore = r.score ?? 0;
    const keywordScore = r._keywordScore ?? 0;
    const llmRelevanceScore = r._llmRelevanceScore ?? 0;
    const timeDecayScore = r._timeDecayScore ?? 0;
    const sourceCredScore = r.metadata?.sourceCredibility ?? 0;
    const constraintScore = evidence?.constraintSatisfaction ?? 0;

    // Multi-dimensional fusion
    const fusedScore = weights.keyword * keywordScore
      + weights.llmRelevance * llmRelevanceScore
      + weights.timeDecay * timeDecayScore
      + weights.constraintSatisfaction * constraintScore
      + weights.sourceCredibility * sourceCredScore;

    // Blend: keep most of existing score but add constraint-weighted component
    r.score = existingScore + constraintScore * 0.4;
    r._constraintScore = constraintScore;

    if (evidence) {
      r.metadata = {
        ...r.metadata,
        constraintSatisfaction: constraintScore,
        evidenceCount: evidence.constraintScores.filter(c => c.satisfied).length,
      };
    }
  }
}

/**
 * Get the overall constraint satisfaction summary for display.
 */
export function getConstraintSummary(
  matrix: EvidenceMatrixResult,
  constraints: string[],
): { constraint: string; satisfied: boolean; bestEvidence: string }[] {
  return constraints.map((constraint, i) => {
    let bestConfidence = 0;
    let bestEvidence = '';
    let satisfied = false;

    for (const entry of matrix.entries) {
      const cs = entry.constraintScores.find(c => c.constraint === constraint);
      if (cs && cs.confidence > bestConfidence) {
        bestConfidence = cs.confidence;
        bestEvidence = cs.evidence;
        satisfied = cs.satisfied;
      }
    }

    return { constraint, satisfied, bestEvidence };
  });
}
