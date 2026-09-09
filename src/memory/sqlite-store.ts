/**
 * SQLiteMemoryStore — Persistent memory backed by SQLite.
 *
 * Uses the built-in node:sqlite module (Node 22.5+) or falls back
 * to in-memory LRU when SQLite is unavailable.
 *
 * Database schema:
 *  - search_cache: query → answer+sources+stats, with TTL
 *  - facts: entity → fact entries with confidence
 */

import { LRUCache } from '../utils/lru-cache.js';
import type { MemoryStore, CachedSearch, FactEntry } from './store.js';

const SEARCH_TTL_MS = 10 * 60 * 1000; // 10 minutes
const FACT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── SQLite Store ──────────────────────────────────

let Database: any = null;

async function loadSqlite(): Promise<any> {
  try {
    // Node.js 22.5+ built-in sqlite
    const mod = await import('node:sqlite' as any);
    return mod.DatabaseSync || mod.default?.DatabaseSync || null;
  } catch {
    try {
      // Fallback: better-sqlite3
      const mod = await import('better-sqlite3' as any);
      return mod.default || mod;
    } catch {
      return null;
    }
  }
}

export class SQLiteMemoryStore implements MemoryStore {
  private db: any = null;
  private fallbackCache: LRUCache<CachedSearch>;
  private factCache: Map<string, FactEntry[]>;
  private usingSqlite = false;

  constructor(private dbPath: string = './agentic-search.db') {
    this.fallbackCache = new LRUCache<CachedSearch>(200, SEARCH_TTL_MS);
    this.factCache = new Map();
  }

  async init(): Promise<void> {
    try {
      Database = await loadSqlite();
      if (Database) {
        this.db = new Database(this.dbPath);
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS search_cache (
            query TEXT PRIMARY KEY,
            answer TEXT NOT NULL,
            sources TEXT NOT NULL,
            stats TEXT NOT NULL,
            created_at INTEGER NOT NULL
          );
          CREATE TABLE IF NOT EXISTS facts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity TEXT NOT NULL,
            fact_key TEXT NOT NULL,
            fact_text TEXT NOT NULL,
            source TEXT DEFAULT '',
            confidence REAL DEFAULT 0.5,
            created_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_facts_entity ON facts(entity);
          CREATE INDEX IF NOT EXISTS idx_cache_created ON search_cache(created_at);
        `);
        this.usingSqlite = true;
        this.cleanExpired();
        console.log(`  ✓ 持久化记忆: SQLite (${this.dbPath})`);
      } else {
        console.log('  ⚠️ SQLite 不可用，使用内存缓存');
      }
    } catch (e: any) {
      console.log(`  ⚠️ SQLite 初始化失败: ${e.message}，使用内存缓存`);
    }
  }

  private cleanExpired(): void {
    if (!this.db) return;
    try {
      const now = Date.now();
      this.db.exec(`DELETE FROM search_cache WHERE created_at < ${now - SEARCH_TTL_MS}`);
      this.db.exec(`DELETE FROM facts WHERE created_at < ${now - FACT_TTL_MS}`);
    } catch {}
  }

  // ── Search Cache ─────────────────────────────────

  async getSearch(query: string): Promise<CachedSearch | null> {
    if (!this.db) {
      const cached = this.fallbackCache.get(query);
      return cached ?? null;
    }

    try {
      const stmt = this.db.prepare('SELECT answer, sources, stats, created_at FROM search_cache WHERE query = ?');
      const row = stmt.get(query);
      if (!row) return null;

      if (Date.now() - row.created_at > SEARCH_TTL_MS) {
        this.db.prepare('DELETE FROM search_cache WHERE query = ?').run(query);
        return null;
      }

      return {
        answer: row.answer,
        sources: JSON.parse(row.sources),
        stats: JSON.parse(row.stats),
      };
    } catch {
      return null;
    }
  }

  async setSearch(query: string, result: CachedSearch): Promise<void> {
    if (!this.db) {
      this.fallbackCache.set(query, result);
      return;
    }

    try {
      const stmt = this.db.prepare(
        'INSERT OR REPLACE INTO search_cache (query, answer, sources, stats, created_at) VALUES (?, ?, ?, ?, ?)',
      );
      stmt.run(query, result.answer, JSON.stringify(result.sources), JSON.stringify(result.stats), Date.now());
    } catch {}
  }

  // ── Fact Store ───────────────────────────────────

  async getFacts(entity: string): Promise<FactEntry[]> {
    if (!this.db) {
      return this.factCache.get(entity) ?? [];
    }

    try {
      const stmt = this.db.prepare(
        'SELECT fact_key, fact_text, source, confidence, created_at FROM facts WHERE entity = ? AND created_at > ? ORDER BY confidence DESC LIMIT 20',
      );
      const rows = stmt.all(entity, Date.now() - FACT_TTL_MS);
      return rows.map((r: any) => ({
        key: r.fact_key,
        fact: r.fact_text,
        source: r.source,
        confidence: r.confidence,
        createdAt: r.created_at,
      }));
    } catch {
      return [];
    }
  }

  async addFact(entity: string, fact: FactEntry): Promise<void> {
    if (!this.db) {
      const existing = this.factCache.get(entity) ?? [];
      existing.push(fact);
      if (existing.length > 50) existing.shift();
      this.factCache.set(entity, existing);
      return;
    }

    try {
      const stmt = this.db.prepare(
        'INSERT INTO facts (entity, fact_key, fact_text, source, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      );
      stmt.run(entity, fact.key, fact.fact, fact.source || '', fact.confidence, Date.now());
    } catch {}
  }

  // ── Stats ────────────────────────────────────────

  async getStats(): Promise<{ searchCacheSize: number; factCount: number }> {
    if (!this.db) {
      return { searchCacheSize: this.fallbackCache.size, factCount: 0 };
    }

    try {
      const cacheCount = this.db.prepare('SELECT COUNT(*) as c FROM search_cache').get().c;
      const factCount = this.db.prepare('SELECT COUNT(*) as c FROM facts').get().c;
      return { searchCacheSize: cacheCount, factCount };
    } catch {
      return { searchCacheSize: 0, factCount: 0 };
    }
  }

  // ── Lifecycle ────────────────────────────────────

  async close(): Promise<void> {
    if (this.db) {
      try { this.db.close(); } catch {}
    }
  }
}
