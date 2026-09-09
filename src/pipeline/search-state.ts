/**
 * Search State — Cross-round knowledge accumulation.
 *
 * Maintains state across iterative search rounds:
 *  - Known facts (confirmed information)
 *  - Missing info (gaps to fill)
 *  - Conflicts (contradictions to resolve)
 *  - Searched queries (avoid duplicates)
 *  - Round history (track progress)
 */

// ── Types ──────────────────────────────────────────

export interface RoundRecord {
  round: number;
  newResults: number;
  confidence: number;
  confidenceDelta: number;
  queries: string[];
  durationMs: number;
}

export interface SearchState {
  knownFacts: string[];
  missingInfo: string[];
  conflicts: string[];
  searchedQueries: Set<string>;
  constraintStatus: Record<string, boolean>;
  roundHistory: RoundRecord[];
  totalResults: number;
  currentConfidence: number;
}

// ── Factory ────────────────────────────────────────

export function createSearchState(hardConstraints: string[]): SearchState {
  const constraintStatus: Record<string, boolean> = {};
  for (const c of hardConstraints) {
    constraintStatus[c] = false;
  }

  return {
    knownFacts: [],
    missingInfo: [],
    conflicts: [],
    searchedQueries: new Set(),
    constraintStatus,
    roundHistory: [],
    totalResults: 0,
    currentConfidence: 0,
  };
}

// ── Updaters ───────────────────────────────────────

export function recordRound(
  state: SearchState,
  round: number,
  newResults: number,
  confidence: number,
  queries: string[],
  durationMs: number,
): void {
  const prevConfidence = state.currentConfidence;

  state.roundHistory.push({
    round,
    newResults,
    confidence,
    confidenceDelta: confidence - prevConfidence,
    queries,
    durationMs,
  });

  state.totalResults += newResults;
  state.currentConfidence = confidence;

  for (const q of queries) {
    state.searchedQueries.add(q);
  }
}

export function updateFromQualityGate(
  state: SearchState,
  knownFacts: string[],
  missingInfo: string[],
  conflicts: string[],
  clues: string[],
  constraintCompleteness: number,
): void {
  // Merge new facts (deduplicate)
  for (const fact of knownFacts) {
    if (!state.knownFacts.includes(fact)) {
      state.knownFacts.push(fact);
    }
  }

  // Replace missing info with latest assessment
  state.missingInfo = missingInfo;

  // Merge conflicts
  for (const conflict of conflicts) {
    if (!state.conflicts.includes(conflict)) {
      state.conflicts.push(conflict);
    }
  }

  // Merge clues into known facts
  for (const clue of clues) {
    if (!state.knownFacts.includes(clue)) {
      state.knownFacts.push(clue);
    }
  }

  // Update constraint status based on completeness
  const constraints = Object.keys(state.constraintStatus);
  if (constraints.length > 0) {
    const satisfiedCount = Math.round(constraints.length * constraintCompleteness / 100);
    constraints.forEach((c, i) => {
      state.constraintStatus[c] = i < satisfiedCount;
    });
  }
}

/**
 * Get queries that haven't been searched yet.
 * Filters out queries already in the searchedQueries set.
 */
export function getNewQueries(state: SearchState, candidates: string[]): string[] {
  return candidates.filter(q => !state.searchedQueries.has(q));
}

/**
 * Check if the search is "stuck" — consecutive rounds with no progress.
 * Used to trigger "blocked restructuring" (切换假设维度).
 */
export function isStuck(state: SearchState, minGain: number = 5): boolean {
  if (state.roundHistory.length < 2) return false;

  const lastTwo = state.roundHistory.slice(-2);
  return lastTwo.every(r => r.confidenceDelta < minGain);
}

/**
 * Generate a search context summary for the LLM.
 * Helps the LLM understand what we already know across rounds.
 */
export function buildStateContext(state: SearchState): string {
  const parts: string[] = [];

  if (state.knownFacts.length > 0) {
    parts.push(`已知事实: ${state.knownFacts.slice(0, 10).join('; ')}`);
  }

  if (state.missingInfo.length > 0) {
    parts.push(`仍需了解: ${state.missingInfo.join('; ')}`);
  }

  if (state.conflicts.length > 0) {
    parts.push(`待解决矛盾: ${state.conflicts.join('; ')}`);
  }

  const unsatisfied = Object.entries(state.constraintStatus)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (unsatisfied.length > 0) {
    parts.push(`未满足约束: ${unsatisfied.join('; ')}`);
  }

  if (state.roundHistory.length > 0) {
    const last = state.roundHistory[state.roundHistory.length - 1];
    parts.push(`当前轮次: ${last.round}, 置信度: ${last.confidence}%`);
  }

  return parts.join('\n');
}
