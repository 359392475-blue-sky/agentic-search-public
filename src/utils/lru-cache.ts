/**
 * Bounded LRU cache with TTL support.
 * Replaces the unbounded Map used for search result caching.
 */

interface CacheEntry<V> {
  value: V;
  ts: number;
}

export class LRUCache<V> {
  private cache = new Map<string, CacheEntry<V>>();

  constructor(
    private maxSize: number = 100,
    private ttlMs: number = 10 * 60 * 1000,
  ) {}

  get(key: string): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.ts > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    this.cache.delete(key);

    if (this.cache.size >= this.maxSize) {
      // Evict oldest (first entry in Map iteration order)
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }

    this.cache.set(key, { value, ts: Date.now() });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}
