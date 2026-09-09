/**
 * Search Orchestrator — Five-layer architecture core.
 *
 * Encapsulates the entire search pipeline from query to answer:
 *  1. Model layer: LLM adapter (query analysis, scoring, answer generation)
 *  2. Memory layer: MemoryStore (cache, facts, preferences)
 *  3. Tool layer: Search methods, content fetchers, domain APIs
 *  4. Orchestration layer: Adaptive routing, iteration control, state management
 *  5. Synthesis layer: Answer generation, citation verification, output formatting
 *
 * Extracted from server.ts to enable:
 *  - Testable search pipeline independent of HTTP
 *  - Pluggable backends (swap LLM, memory, tools)
 *  - Speculative pre-execution
 *  - Counter-evidence search
 */

import type { LLMAdapter } from '../llm/adapter.js';
import type { MemoryStore, CachedSearch } from '../memory/store.js';
import { WIKI_LANG_MAP, extractEnglishTerms } from '../pipeline/lang.js';
import { buildEntitySet, shouldKeepResult } from '../pipeline/filters.js';
import { fetchHN, fetchOpenAlex, fetchCrossRef, fetchWikipedia } from '../pipeline/sources.js';
import { fetchContents, buildAnswerWithLLM } from '../pipeline/content.js';
import { analyzeQuery, getAliasQueries, type QueryAnalysisResult } from '../pipeline/query-analyzer.js';
import { applyCredibilityScore } from '../pipeline/source-credibility.js';
import { evaluateQuality, shouldStop, DEFAULT_STOP_CONDITION } from '../pipeline/quality-gate.js';
import { buildEvidenceMatrix, applyEvidenceScores, getConstraintSummary } from '../pipeline/evidence-matrix.js';
import { verifyCitations, annotateDeadCitations } from '../pipeline/citation-verify.js';
import { createSearchState, recordRound, updateFromQualityGate, getNewQueries, isStuck, type SearchState } from '../pipeline/search-state.js';
import { extractDate, timeDecayScore } from '../utils/date-extractor.js';
import { limitPerDomain, removeSimilarTitles } from '../utils/dedup.js';

// ── Types ──────────────────────────────────────────

export type SSECallback = (event: string, data: any) => void;

export interface SearchTools {
  google: { execute(opts: any): Promise<any[]> };
  bing: { execute(opts: any): Promise<any[]> };
  baidu: { execute(opts: any): Promise<any[]> };
  serper: { execute(opts: any): Promise<any[]>; isAvailable: boolean };
  sogou: { execute(opts: any): Promise<any[]> };
  semanticScholar: { execute(opts: any): Promise<any[]> };
  domainMethod: { execute(opts: any): Promise<any[]> };
  finance: { execute(opts: any): Promise<any[]> };
  cninfo: { execute(opts: any): Promise<any[]> };
  domainRouter: { detectByKeywords(q: string): any; detectWithLLM(q: string): Promise<any> };
}

export interface SearchResult {
  answer: string;
  sources: { index: number; title: string; url: string; source: string; tier: string }[];
  stats: any;
  evidenceSummary: any;
}

// ── Orchestrator ──────────────────────────────────

function log(msg: string) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

export class SearchOrchestrator {
  constructor(
    private llm: LLMAdapter,
    private memory: MemoryStore,
    private tools: SearchTools,
  ) {}

  /**
   * Execute a full search — the main entry point.
   * Streams events via the onEvent callback.
   */
  async search(
    query: string,
    maxResults: number,
    onEvent: SSECallback,
  ): Promise<SearchResult> {
    const start = Date.now();

    // ── Check memory cache ──
    const cached = await this.memory.getSearch(query);
    if (cached) {
      log(`搜索: "${query}" [缓存命中]`);
      onEvent('status', { message: '命中缓存，直接返回' });
      onEvent('answer', { text: cached.answer });
      onEvent('sources', { sources: cached.sources });
      onEvent('done', { ...cached.stats, elapsed: Date.now() - start, fromCache: true });
      return { answer: cached.answer, sources: cached.sources, stats: cached.stats, evidenceSummary: {} };
    }

    log(`搜索: "${query}"`);

    // ══════════════════════════════════════════
    // Phase 0: Enhanced Query Analysis
    // ══════════════════════════════════════════
    onEvent('status', { message: '正在分析问题，提取搜索约束...' });

    const analysis = await analyzeQuery(query, this.llm);
    const {
      searchQueries, enQueries, intent: queryIntent, complexity, timeSensitive,
      needsInternational, needsPdf, coreEntities: llmCoreEntities,
      answerContract, entityAliases, subQueries, adaptiveConfig,
      queryLang, hasChinese, isNonChineseNonEnglish,
    } = analysis;
    const isAcademic = queryIntent === 'academic';

    onEvent('entities', {
      queries: searchQueries, academic: isAcademic, intent: queryIntent,
      lang: queryLang.lang, complexity,
      constraints: answerContract.hardConstraints,
    });

    // Initialize search state
    const searchState = createSearchState(answerContract.hardConstraints);

    // Enrich with known facts from memory
    for (const entity of llmCoreEntities.slice(0, 3)) {
      const knownFacts = await this.memory.getFacts(entity);
      for (const f of knownFacts.slice(0, 3)) {
        searchState.knownFacts.push(`[已知] ${f.fact}`);
      }
    }

    // ══════════════════════════════════════════
    // Phase 1: Multi-lane Parallel Search + Speculative Pre-execution
    // ══════════════════════════════════════════
    onEvent('status', { message: `正在并发搜索 ${searchQueries.length} 个方向...` });

    const allResults: any[] = [];
    const srcCounts: Record<string, number> = {};
    const seen = new Set<string>();
    const queryEntitySet = buildEntitySet(query, llmCoreEntities);
    const useSerper = this.tools.serper.isAvailable;

    const addResults = (label: string, items: any[]) => {
      const newItems = items.filter(r => {
        const key = (r.filePath || '').replace(/\/$/, '').replace(/^https?:\/\/www\./, 'https://');
        if (!key || seen.has(key)) return false;
        const itemTitle = r.metadata?.title || r.snippet?.split('\n')[0] || '';
        if (!shouldKeepResult(key, itemTitle, queryEntitySet)) return false;
        seen.add(key);
        r.source = label;
        applyCredibilityScore(r, key, queryIntent);
        return true;
      });
      allResults.push(...newItems);
      srcCounts[label] = (srcCounts[label] ?? 0) + newItems.length;
    };

    // Execute all lanes in parallel
    const searchPromises = this.buildSearchLanes(analysis, addResults);

    const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T | void> =>
      Promise.race([p, new Promise<void>(r => setTimeout(() => { log(`  [超时] ${label} 超过${ms / 1000}s`); r(); }, ms))]);

    const webTimeoutMs = useSerper ? 10_000 : 25_000;
    await Promise.race([
      Promise.allSettled(
        searchPromises.map(({ promise, timeout, label }) =>
          withTimeout(promise, timeout ?? webTimeoutMs, label),
        ),
      ),
      new Promise(r => setTimeout(r, 35_000)),
    ]);

    for (const [label, count] of Object.entries(srcCounts)) log(`  ${label}: ${count} 条`);

    // ══════════════════════════════════════════
    // Phase 2: Relevance Scoring + Evidence Matrix
    // ══════════════════════════════════════════
    this.scoreResults(allResults, query, llmCoreEntities, timeSensitive, answerContract, queryIntent);
    await this.llmScoring(allResults, query, maxResults);

    // Evidence matrix
    let evidenceMatrix = { entries: [] as any[] };
    if (answerContract.hardConstraints.length > 0) {
      onEvent('status', { message: '正在评估约束满足情况...' });
      evidenceMatrix = await buildEvidenceMatrix(query, allResults.slice(0, 25), answerContract.hardConstraints, this.llm);
      applyEvidenceScores(allResults.slice(0, 25), evidenceMatrix, queryIntent);
    }

    // Time-decay scoring
    for (const r of allResults) {
      const title = r.metadata?.title || '';
      const snippet = r.snippet || '';
      const url = r.filePath || '';
      const pubDate = extractDate(snippet, title, url);
      if (pubDate) r.metadata = { ...r.metadata, pubDate: pubDate.toISOString() };
      r.score = (r.score ?? 0) + timeDecayScore(pubDate, timeSensitive);
    }

    // Sort + dedup
    allResults.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    let filtered = allResults.filter(r => (r.score ?? 0) > -0.2 && (r.llmRelevance === undefined || r.llmRelevance >= 2));
    filtered = limitPerDomain(filtered, 3) as typeof filtered;
    filtered = removeSimilarTitles(filtered, 0.65) as typeof filtered;
    const ranked = filtered.slice(0, maxResults);

    onEvent('status', { message: `找到 ${allResults.length} 条结果，正在分析内容...` });
    onEvent('sources', {
      sources: ranked.map((r, i) => ({
        index: i + 1,
        title: r.metadata?.title || (r.snippet ?? '').split('\n')[0]?.slice(0, 100) || '',
        url: r.filePath || '',
        source: r.source || '',
        tier: r.metadata?.sourceTier || 'unrated',
      })),
    });

    // ══════════════════════════════════════════
    // Phase 3: Answer Generation
    // ══════════════════════════════════════════
    const snippetTexts = ranked.slice(0, 6).map((r, i) =>
      `[${i + 1}] ${r.metadata?.title || ''}\n${(r.snippet || '').slice(0, 300)}`
    ).join('\n\n');
    const quickAnswerPromise = this.llm.complete(
      `根据以下搜索摘要快速回答用户问题。简洁直接，给出关键事实。始终用中文回答。如果摘要不足以回答，就说"正在深入搜索..."。\n用户问题: "${query}"\n\n摘要:\n${snippetTexts.slice(0, 3000)}`
    ).catch(() => '');

    onEvent('status', { message: '正在抓取页面内容并生成回答...' });
    const pdfResults = ranked.filter(r => r.metadata?.isPdf);
    const nonPdfResults = ranked.filter(r => !r.metadata?.isPdf);
    const topN = [...pdfResults.slice(0, 3), ...nonPdfResults].slice(0, 10);

    const [quickAnswer, contents] = await Promise.all([quickAnswerPromise, fetchContents(topN)]);
    if (quickAnswer && quickAnswer.length > 10 && !quickAnswer.includes('正在深入搜索')) {
      onEvent('quick_answer', { text: quickAnswer });
    }

    let currentAnswer = await Promise.race([
      buildAnswerWithLLM(query, topN, contents, this.llm),
      new Promise<string>(r => setTimeout(() => r(quickAnswer || '生成回答超时，请重试。'), 120_000)),
    ]);
    onEvent('answer', { text: currentAnswer });

    recordRound(searchState, 1, allResults.length, 50, searchQueries, Date.now() - start);

    // ══════════════════════════════════════════
    // Phase 4: Multi-round Iteration + Counter-evidence
    // ══════════════════════════════════════════
    let finalAnswer = currentAnswer;
    let totalRounds = 1;

    const stopCondition = {
      ...DEFAULT_STOP_CONDITION,
      maxRounds: adaptiveConfig.maxRounds,
      maxTimeMs: adaptiveConfig.timeoutMs,
    };

    for (let round = 2; round <= stopCondition.maxRounds; round++) {
      const roundStart = Date.now();
      const elapsed = roundStart - start;

      const preCheck = shouldStop(round - 1, elapsed, searchState.currentConfidence, 0, stopCondition);
      if (preCheck.stop && round > 2) {
        log(`  停止迭代: ${preCheck.reason}`);
        break;
      }

      try {
        const gate = await evaluateQuality(query, currentAnswer, answerContract, contents, allResults.length, this.llm);
        updateFromQualityGate(searchState, gate.clues, gate.missingInfo, [], gate.clues, gate.constraintCompleteness);

        const stopCheck = shouldStop(round - 1, Date.now() - start, gate.overallConfidence, searchState.currentConfidence, stopCondition);
        if (!gate.shouldContinue || stopCheck.stop) {
          recordRound(searchState, round, 0, gate.overallConfidence, [], Date.now() - roundStart);
          break;
        }

        const candidateQueries = gate.newQueries || [];
        const nextQueries = getNewQueries(searchState, candidateQueries).slice(0, 3);

        // Counter-evidence search (P2): inject refutation queries if confidence is moderate
        if (gate.overallConfidence < 75 && llmCoreEntities.length > 0) {
          const counterQueries = this.generateCounterEvidenceQueries(query, llmCoreEntities, currentAnswer);
          const newCounter = getNewQueries(searchState, counterQueries);
          nextQueries.push(...newCounter.slice(0, 2));
          if (newCounter.length > 0) log(`  反证搜索: ${newCounter.slice(0, 2).join(' | ')}`);
        }

        if (nextQueries.length === 0) {
          recordRound(searchState, round, 0, gate.overallConfidence, [], Date.now() - roundStart);
          break;
        }

        totalRounds = round;
        log(`  第${round}轮搜索词: ${nextQueries.join(' | ')}`);
        onEvent('status', { message: `第${round}轮深入搜索: ${gate.reason}` });

        const rNResults = await this.executeSupplementarySearch(nextQueries, analysis, seen, addResults);

        if (rNResults.length > 0) {
          for (const r of rNResults) {
            const pubDate = extractDate(r.snippet || '', r.metadata?.title || '', r.filePath || '');
            if (pubDate) r.metadata = { ...r.metadata, pubDate: pubDate.toISOString() };
            r.score = (r.score ?? 0) + timeDecayScore(pubDate, timeSensitive);
          }
          allResults.push(...rNResults);
          srcCounts[`补充搜索R${round}`] = rNResults.length;

          allResults.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
          let expandedPool = limitPerDomain(allResults, 3) as typeof allResults;
          expandedPool = removeSimilarTitles(expandedPool, 0.65) as typeof expandedPool;
          const expanded = expandedPool.slice(0, 8);

          const expandedContents = await Promise.race([
            fetchContents(expanded),
            new Promise<string[]>(r => setTimeout(() => r(expanded.map(() => '')), 20_000)),
          ]);
          currentAnswer = await Promise.race([
            buildAnswerWithLLM(query, expanded, expandedContents, this.llm),
            new Promise<string>(r => setTimeout(() => r(currentAnswer), 120_000)),
          ]);
          finalAnswer = currentAnswer;
          onEvent('answer', { text: finalAnswer, round });
        }

        recordRound(searchState, round, rNResults.length, gate.overallConfidence, nextQueries, Date.now() - roundStart);

        if (isStuck(searchState)) {
          log(`  连续2轮无进展，停止迭代`);
          break;
        }
      } catch (e: any) {
        log(`  第${round}轮质量评估跳过: ${e.message}`);
        break;
      }
    }

    // ══════════════════════════════════════════
    // Phase 5: Citation Verify + Finalize
    // ══════════════════════════════════════════
    const elapsed = Date.now() - start;
    const finalSources = allResults.slice(0, maxResults).map((r, i) => ({
      index: i + 1,
      title: r.metadata?.title || (r.snippet ?? '').split('\n')[0]?.slice(0, 100) || '',
      url: r.filePath || '',
      source: r.source || '',
      tier: r.metadata?.sourceTier || 'unrated',
    }));

    let verifiedAnswer = finalAnswer;
    let citationStats = { total: 0, alive: 0, dead: 0 };
    if (finalSources.length > 0 && elapsed < adaptiveConfig.timeoutMs - 10_000) {
      try {
        const verification = await verifyCitations(finalAnswer, finalSources, 3000);
        citationStats = { total: verification.total, alive: verification.alive, dead: verification.dead };
        if (verification.dead > 0) {
          verifiedAnswer = annotateDeadCitations(finalAnswer, verification);
          onEvent('answer', { text: verifiedAnswer, round: totalRounds, citationVerified: true });
        }
      } catch {}
    }

    const constraintSummary = answerContract.hardConstraints.length > 0
      ? getConstraintSummary(evidenceMatrix, answerContract.hardConstraints)
      : [];

    const evSummary = {
      keyFacts: searchState.knownFacts.slice(0, 5),
      constraintsSatisfied: constraintSummary.filter(c => c.satisfied).map(c => c.constraint),
      constraintsUnsatisfied: constraintSummary.filter(c => !c.satisfied).map(c => c.constraint),
      conflictingClaims: searchState.conflicts.slice(0, 3),
    };

    const stats = {
      total: allResults.length, elapsed, sources: srcCounts,
      rounds: totalRounds, complexity,
      confidence: searchState.currentConfidence,
      citations: citationStats,
      evidenceSummary: evSummary,
    };

    // Persist to memory
    await this.memory.setSearch(query, { answer: verifiedAnswer, sources: finalSources, stats });

    // Persist discovered facts
    for (const entity of llmCoreEntities.slice(0, 3)) {
      for (const fact of searchState.knownFacts.slice(0, 5)) {
        await this.memory.addFact(entity, {
          key: fact.slice(0, 50),
          fact,
          source: query,
          confidence: searchState.currentConfidence / 100,
          createdAt: Date.now(),
        });
      }
    }

    onEvent('sources', { sources: finalSources });
    onEvent('done', stats);
    log(`  完成: ${allResults.length} 条, ${totalRounds}轮, ${complexity}复杂度, 置信度${searchState.currentConfidence}%, ${elapsed}ms`);

    return { answer: verifiedAnswer, sources: finalSources, stats, evidenceSummary: evSummary };
  }

  // ── Private: Build Search Lanes ──────────────────

  private buildSearchLanes(
    analysis: QueryAnalysisResult,
    addResults: (label: string, items: any[]) => void,
  ): { promise: Promise<void>; timeout: number; label: string }[] {
    const {
      searchQueries, enQueries, intent: queryIntent, timeSensitive,
      needsInternational, needsPdf, subQueries,
      queryLang, hasChinese, isNonChineseNonEnglish,
    } = analysis;
    const isAcademic = queryIntent === 'academic';
    const useSerper = this.tools.serper.isAvailable;
    const englishQuery = hasChinese ? extractEnglishTerms(searchQueries[0] || '') : null;
    const aliasQueries = getAliasQueries(analysis);

    const lanes: { promise: Promise<void>; timeout: number; label: string }[] = [];

    // Lane 1: Web search (per query)
    for (const sq of searchQueries) {
      const englishQ = hasChinese ? extractEnglishTerms(sq) : null;
      lanes.push({
        label: `Web-${sq.slice(0, 15)}`,
        timeout: useSerper ? 10_000 : 25_000,
        promise: (async () => {
          const jobs: Promise<any>[] = [];
          const labels: string[] = [];
          if (useSerper) {
            jobs.push(this.tools.serper.execute({ query: sq, maxResults: 12, gl: queryLang.gl, hl: queryLang.hl })); labels.push('Serper');
            if (hasChinese) { jobs.push(this.tools.baidu.execute({ query: sq, maxResults: 8 })); labels.push('百度'); }
            if (hasChinese && englishQ) { jobs.push(this.tools.serper.execute({ query: englishQ, maxResults: 6, gl: 'us', hl: 'en' })); labels.push('Serper(EN)'); }
            else if (isNonChineseNonEnglish) { jobs.push(this.tools.serper.execute({ query: enQueries?.[0] || sq, maxResults: 6, gl: 'us', hl: 'en' })); labels.push('Serper(EN)'); }
          } else {
            jobs.push(this.tools.bing.execute({ query: sq, maxResults: 12 })); labels.push('Bing');
            if (hasChinese) { jobs.push(this.tools.baidu.execute({ query: sq, maxResults: 10 })); labels.push('百度'); }
            else { jobs.push(this.tools.google.execute({ query: sq, maxResults: 8 })); labels.push('Google'); }
            if (hasChinese && englishQ) { jobs.push(this.tools.bing.execute({ query: englishQ, maxResults: 4 })); labels.push('Bing(EN)'); }
            if (hasChinese && sq === searchQueries[0]) { jobs.push(this.tools.sogou.execute({ query: sq, maxResults: 8 })); labels.push('搜狗'); }
          }
          const settled = await Promise.allSettled(jobs);
          for (let i = 0; i < settled.length; i++) {
            const r = settled[i];
            if (r.status === 'fulfilled' && Array.isArray(r.value) && r.value.length > 0) addResults(labels[i] ?? `Source${i}`, r.value);
          }
        })(),
      });
    }

    // Lane 2: Academic
    if (isAcademic) {
      lanes.push({
        label: 'Academic', timeout: 20_000,
        promise: (async () => {
          const enQ = enQueries?.[0] || (hasChinese ? extractEnglishTerms(searchQueries[0] || '') : searchQueries[0] || '');
          const settled = await Promise.allSettled([fetchOpenAlex(enQ).catch(() => []), fetchCrossRef(enQ).catch(() => [])]);
          ['OpenAlex', 'CrossRef'].forEach((lbl, i) => {
            const r = settled[i];
            if (r.status === 'fulfilled' && Array.isArray(r.value) && r.value.length > 0) addResults(lbl, r.value);
          });
        })(),
      });
    }

    // Lane 3: HN
    lanes.push({
      label: 'HN', timeout: 10_000,
      promise: (async () => { const r = await fetchHN(englishQuery || searchQueries[0] || ''); addResults('HN', r); })(),
    });

    // Lane 4: Wikipedia
    lanes.push({
      label: 'Wiki', timeout: 10_000,
      promise: (async () => {
        const wikiJobs: Promise<any[]>[] = [];
        const wikiLang = WIKI_LANG_MAP[queryLang.lang];
        if (wikiLang) wikiJobs.push(fetchWikipedia(searchQueries[0] || '', wikiLang));
        const enQ = enQueries?.[0] || englishQuery || extractEnglishTerms(searchQueries[0] || '');
        if (enQ && enQ !== searchQueries[0]) wikiJobs.push(fetchWikipedia(enQ, 'en'));
        const settled = await Promise.allSettled(wikiJobs);
        for (const r of settled) { if (r.status === 'fulfilled' && r.value.length > 0) addResults('Wikipedia', r.value); }
      })(),
    });

    // Lane 5: Alias expansion
    if (aliasQueries.length > 0) {
      const searchFn = useSerper ? this.tools.serper : this.tools.bing;
      lanes.push({
        label: 'Alias', timeout: 15_000,
        promise: (async () => {
          await Promise.allSettled(aliasQueries.map(async (aq) => {
            try {
              const r = await searchFn.execute({ query: aq, maxResults: 6, gl: queryLang.gl, hl: queryLang.hl });
              if (r.length > 0) addResults('别名扩展', r);
            } catch {}
          }));
        })(),
      });
    }

    // Lane 6: Sub-query decomposition
    if (subQueries.length > 0) {
      const searchFn = useSerper ? this.tools.serper : this.tools.bing;
      lanes.push({
        label: 'SubQuery', timeout: 20_000,
        promise: (async () => {
          await Promise.allSettled(subQueries.map(async (sq) => {
            try {
              const r = await searchFn.execute({ query: sq.query, maxResults: 8, gl: queryLang.gl, hl: queryLang.hl });
              if (r.length > 0) addResults(`子问题:${sq.purpose.slice(0, 10)}`, r);
            } catch {}
          }));
        })(),
      });
    }

    // Lane 7: International news
    if (needsInternational && queryLang.lang !== 'en') {
      lanes.push({
        label: 'IntlNews', timeout: 20_000,
        promise: (async () => {
          const enQ = enQueries?.[0] || englishQuery || extractEnglishTerms(searchQueries[0] || '');
          if (!enQ) return;
          try {
            if (useSerper) { const r = await this.tools.serper.execute({ query: `${enQ} latest news`, maxResults: 8, gl: 'us', hl: 'en' }); if (r.length > 0) addResults('国际新闻', r); }
            else { const r = await this.tools.google.execute({ query: `${enQ} latest news`, maxResults: 6 }); if (r.length > 0) addResults('国际新闻', r); }
          } catch {}
        })(),
      });
    }

    // Lane 8: PDF search
    if (needsPdf) {
      lanes.push({
        label: 'PDF', timeout: 20_000,
        promise: (async () => {
          const searchFn = useSerper ? this.tools.serper : this.tools.bing;
          const enQ = enQueries?.[0] || englishQuery || extractEnglishTerms(searchQueries[0] || '');
          const mainQ = searchQueries[0] || '';
          const jobs: Promise<any>[] = [];
          if (enQ) jobs.push(searchFn.execute({ query: `${enQ} filetype:pdf`, maxResults: 6 }).catch(() => []));
          jobs.push(searchFn.execute({ query: `${mainQ} filetype:pdf`, maxResults: 5 }).catch(() => []));
          const settled = await Promise.allSettled(jobs);
          for (const r of settled) {
            if (r.status === 'fulfilled' && Array.isArray(r.value) && r.value.length > 0) addResults('PDF搜索', r.value);
          }
        })(),
      });
    }

    // Lane 9: Domain-specific API (legal, finance, medical, etc.)
    try {
      const domainResult = this.tools.domainRouter.detectByKeywords(searchQueries[0] || '');
      if (domainResult.prioritySources.length > 0) {
        lanes.push({
          label: 'DomainAPI', timeout: 20_000,
          promise: (async () => {
            try {
              const r = await this.tools.domainMethod.execute({
                query: searchQueries[0] || '', sources: domainResult.prioritySources, maxResults: 10,
              });
              if (Array.isArray(r) && r.length > 0) addResults('领域API', r);
            } catch {}
          })(),
        });
        // Inject site-restricted queries into Web lane for vertical sites
        if (domainResult.siteSearchQueries.length > 0) {
          const searchFn = useSerper ? this.tools.serper : this.tools.bing;
          const mainQ = searchQueries[0] || '';
          lanes.push({
            label: 'SiteSearch', timeout: 15_000,
            promise: (async () => {
              await Promise.allSettled(domainResult.siteSearchQueries.slice(0, 3).map(async (siteQ: string) => {
                try {
                  const r = await searchFn.execute({ query: `${mainQ} ${siteQ}`, maxResults: 5 });
                  if (r.length > 0) addResults('垂直站搜索', r);
                } catch {}
              }));
            })(),
          });
        }
      }
    } catch {}

    // Lane 10: Finance — stock quotes + company filings
    const isFinance = queryIntent === 'finance' || /股票|股价|财报|行情|市值|营收|利润|销售额|市场份额|PE|市盈率/.test(searchQueries[0] || '');
    if (isFinance) {
      lanes.push({
        label: 'Finance', timeout: 15_000,
        promise: (async () => {
          const q = searchQueries[0] || '';
          const settled = await Promise.allSettled([
            this.tools.finance.execute({ query: q }).catch(() => []),
            this.tools.cninfo.execute({ query: q }).catch(() => []),
          ]);
          for (const r of settled) {
            if (r.status === 'fulfilled' && Array.isArray(r.value) && r.value.length > 0) {
              addResults('金融数据', r.value);
            }
          }
        })(),
      });
    }

    // Lane 11: Legal — targeted site searches for Chinese legal databases
    const isLegal = queryIntent === 'legal' || /法律|法规|判例|案例|合同|诉讼|法院|海关|关税|原产地|仲裁|条例|规章/.test(searchQueries[0] || '');
    if (isLegal && hasChinese) {
      const searchFn = useSerper ? this.tools.serper : this.tools.bing;
      const mainQ = searchQueries[0] || '';
      const legalSites = [
        'site:gov.cn',
        'site:court.gov.cn OR site:pkulaw.com',
        'site:customs.gov.cn OR site:mofcom.gov.cn',
      ];
      lanes.push({
        label: 'LegalCN', timeout: 20_000,
        promise: (async () => {
          await Promise.allSettled(legalSites.map(async (siteQ) => {
            try {
              const r = await searchFn.execute({ query: `${mainQ} ${siteQ}`, maxResults: 6 });
              if (r.length > 0) addResults('法律数据库', r);
            } catch {}
          }));
        })(),
      });
    }

    return lanes;
  }

  // ── Private: Keyword Pre-scoring ─────────────────

  private scoreResults(
    results: any[],
    query: string,
    coreEntities: string[],
    timeSensitive: boolean,
    answerContract: any,
    intent: string,
  ): void {
    const entityTerms = coreEntities.length > 0
      ? coreEntities
      : query.replace(/[，。？！、]/g, ' ').split(/\s+/).filter(w => w.length >= 2);

    for (const r of results) {
      const title = (r.metadata?.title || '');
      const titleLow = title.toLowerCase();
      const text = (titleLow + ' ' + (r.snippet || '')).toLowerCase();
      let entityHits = 0;
      for (const ent of entityTerms) { if (text.includes(ent.toLowerCase())) entityHits++; }
      r.score = (r.score ?? 0) + (entityTerms.length > 0 ? entityHits / entityTerms.length : 0) * 0.3;
      let titleHits = 0;
      for (const ent of entityTerms) { if (titleLow.includes(ent.toLowerCase())) titleHits++; }
      if (titleHits === 0 && entityTerms.length >= 2 && !r.metadata?.isWikipedia && !r.metadata?.isAcademic) {
        r.score = (r.score ?? 0) - 0.4;
      }
    }
  }

  // ── Private: LLM Batch Scoring ───────────────────

  private async llmScoring(results: any[], query: string, maxResults: number): Promise<void> {
    results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const candidates = results.slice(0, Math.min(25, results.length));

    try {
      const scoringInput = candidates.slice(0, 20).map((r, i) => {
        const title = r.metadata?.title || '';
        const snippet = (r.snippet || '').slice(0, 120);
        return `[${i}] ${title} | ${snippet}`;
      }).join('\n');

      const scores = await Promise.race([
        this.llm.completeJSON<{ scores: number[] }>(
          `对以下${candidates.slice(0, 20).length}条搜索结果，评估与用户问题的相关性。\n\n用户问题: "${query}"\n\n评分标准(0-10):\n- 10: 直接回答问题的核心内容\n- 7-9: 高度相关\n- 4-6: 部分相关\n- 1-3: 弱相关\n- 0: 完全无关\n\n搜索结果:\n${scoringInput}\n\n返回JSON: {"scores": [分数1, 分数2, ...]}`
        ),
        new Promise<{ scores: number[] }>(r => setTimeout(() => r({ scores: [] }), 15_000)),
      ]);

      if (scores.scores?.length > 0) {
        for (let i = 0; i < Math.min(scores.scores.length, candidates.length); i++) {
          const llmScore = (scores.scores[i] ?? 5) / 10;
          candidates[i].score = (candidates[i].score ?? 0) + llmScore * 0.7;
          candidates[i].llmRelevance = scores.scores[i];
        }
        log(`  LLM相关性: top5=[${scores.scores.slice(0, 5).join(',')}]`);
      }
    } catch (e: any) {
      log(`  LLM评分跳过: ${e.message}`);
    }
  }

  // ── Private: Supplementary Search ────────────────

  private async executeSupplementarySearch(
    queries: string[],
    analysis: QueryAnalysisResult,
    seen: Set<string>,
    addResults: (label: string, items: any[]) => void,
  ): Promise<any[]> {
    const { queryLang, hasChinese, intent: queryIntent } = analysis;
    const isAcademic = queryIntent === 'academic';
    const useSerper = this.tools.serper.isAvailable;
    const queryEntitySet = buildEntitySet(queries[0] || '', []);

    const rNResults: any[] = [];
    const rNSeen = new Set<string>();

    await Promise.race([
      Promise.allSettled(queries.map(async (sq) => {
        const jobs: Promise<any>[] = [
          useSerper
            ? this.tools.serper.execute({ query: sq, maxResults: 10, gl: queryLang.gl, hl: queryLang.hl })
            : this.tools.bing.execute({ query: sq, maxResults: 8 }),
        ];
        if (isAcademic) {
          const enQ = hasChinese ? extractEnglishTerms(sq) : sq;
          jobs.push(fetchOpenAlex(enQ || sq).catch(() => []));
        }
        if (hasChinese && !isAcademic) {
          jobs.push(this.tools.baidu.execute({ query: sq, maxResults: 6 }));
        }
        const settled = await Promise.allSettled(jobs);
        for (const r of settled) {
          if (r.status === 'fulfilled' && Array.isArray(r.value)) {
            for (const item of r.value) {
              const key = (item.filePath || '').replace(/\/$/, '').replace(/^https?:\/\/www\./, 'https://');
              if (!key || rNSeen.has(key) || seen.has(key)) continue;
              const rTitle = item.metadata?.title || item.snippet?.split('\n')[0] || '';
              if (!shouldKeepResult(key, rTitle, queryEntitySet)) continue;
              rNSeen.add(key);
              seen.add(key);
              applyCredibilityScore(item, key, queryIntent);
              rNResults.push(item);
            }
          }
        }
      })),
      new Promise(r => setTimeout(r, 25_000)),
    ]);

    log(`  补充搜索: ${rNResults.length} 条新结果`);
    return rNResults;
  }

  // ── Private: Counter-evidence Search (P2) ────────

  private generateCounterEvidenceQueries(
    query: string,
    entities: string[],
    currentAnswer: string,
  ): string[] {
    const counterQueries: string[] = [];
    const mainEntity = entities[0] || query.slice(0, 20);

    // Generate refutation queries
    counterQueries.push(`${mainEntity} 争议 批评`);
    counterQueries.push(`${mainEntity} criticism controversy`);

    // Check if answer contains definitive claims to challenge
    if (/最好|最优|唯一|确定|一定|必须/.test(currentAnswer)) {
      counterQueries.push(`${mainEntity} 缺点 不足 局限`);
    }
    if (/没有|不会|不可能/.test(currentAnswer)) {
      counterQueries.push(`${mainEntity} 例外 反例`);
    }

    return counterQueries.slice(0, 3);
  }
}
