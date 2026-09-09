/**
 * MemoryStore — Persistent memory layer interface.
 *
 * Abstracts cache and knowledge storage so backends can be swapped
 * (in-memory LRU → SQLite → Redis).
 *
 * Three tiers:
 *  1. Search cache: short-term, query→answer mapping (10 min TTL)
 *  2. Fact store: medium-term, verified facts & entity knowledge (24h TTL)
 *  3. User prefs: long-term, search patterns & domain preferences (no TTL)
 */

// ── Interfaces ─────────────────────────────────────

export interface CachedSearch {
  answer: string;
  sources: any[];
  stats: any;
}

export interface FactEntry {
  key: string;
  fact: string;
  source: string;
  confidence: number;
  createdAt: number;
}

export interface MemoryStore {
  // Search cache (short-term)
  getSearch(query: string): Promise<CachedSearch | null>;
  setSearch(query: string, result: CachedSearch): Promise<void>;

  // Fact store (medium-term knowledge)
  getFacts(entity: string): Promise<FactEntry[]>;
  addFact(entity: string, fact: FactEntry): Promise<void>;

  // Stats
  getStats(): Promise<{ searchCacheSize: number; factCount: number }>;

  // Lifecycle
  close(): Promise<void>;
}
