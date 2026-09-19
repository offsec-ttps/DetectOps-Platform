/**
 * Phase 8 hardening — tiny in-memory cache for hot read endpoints.
 *
 * The Community Content hub is a read-heavy surface (search/registry/health
 * are hit frequently as analysts navigate the UI), and the underlying queries
 * are derived from data that only changes when a sync runs. A short-TTL
 * memo per process is plenty to absorb the burstiness without introducing
 * Redis or another runtime dependency.
 *
 * Cache is intentionally:
 *   - in-process (no shared state across instances — fine for the dev/single
 *     -node deployment this app targets),
 *   - opt-in per call site,
 *   - bounded in size with a simple LRU eviction.
 *
 * Sync mutations call `invalidateCache(prefix)` so analysts always see fresh
 * counts after a manual or scheduled sync.
 */

const MAX_ENTRIES = 256;

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();

function evictIfNeeded() {
  while (store.size > MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (oldestKey === undefined) break;
    store.delete(oldestKey);
  }
}

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key) as Entry<T> | undefined;
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return undefined;
  }
  // Touch for LRU (delete + set re-inserts at the tail).
  store.delete(key);
  store.set(key, entry);
  return entry.value;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  evictIfNeeded();
}

export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await loader();
  cacheSet(key, value, ttlMs);
  return value;
}

/** Invalidate by prefix. Called by sync routes after they mutate state. */
export function invalidateCache(prefix: string): number {
  let removed = 0;
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) {
      store.delete(k);
      removed++;
    }
  }
  return removed;
}

export function cacheStats() {
  return { size: store.size, max: MAX_ENTRIES };
}
