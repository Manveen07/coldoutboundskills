import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

export interface CacheResult<T = any> {
  raw: T;
  fromCache: boolean;
  cachedAt?: string;
}

export function hashKey(...parts: string[]): string {
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

// Reject keys that could escape the cache dir or hit reserved filenames.
function assertSafeKey(key: string): void {
  if (!key || typeof key !== 'string') throw new Error('Invalid cache key: empty');
  if (key.includes('..') || key.includes('/') || key.includes('\\') || key.includes('\0')) {
    throw new Error(`Invalid cache key: ${key}`);
  }
}

function pathFor(dir: string, key: string): string {
  assertSafeKey(key);
  return resolve(dir, `${key}.json`);
}

export function writeCache(dir: string, key: string, payload: any): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const wrapped = { _cached_at: new Date().toISOString(), payload };
  writeFileSync(pathFor(dir, key), JSON.stringify(wrapped, null, 2), 'utf8');
}

export function readCache<T = any>(dir: string, key: string): T | null {
  const p = pathFor(dir, key);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    return (raw.payload ?? raw) as T;
  } catch (err) {
    // Log so corrupt cache files are debuggable, but still return null so callers can re-fetch.
    console.warn(`[cache] failed to parse ${p}: ${(err as Error).message}`);
    return null;
  }
}

export function isCacheStale(dir: string, key: string, ttlDays: number): boolean {
  const p = pathFor(dir, key);
  if (!existsSync(p)) return true;
  // Race-safe: file may be deleted between existsSync and statSync.
  try {
    const ageMs = Date.now() - statSync(p).mtimeMs;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return ageDays > ttlDays;
  } catch {
    return true;
  }
}

/**
 * Core safety primitive. Saves raw response to disk BEFORE returning.
 * Bug in caller's parser? Cache is already on disk for replay.
 */
export async function fetchWithCache<T = any>(
  dir: string,
  key: string,
  ttlDays: number,
  fetcher: () => Promise<T>,
): Promise<CacheResult<T>> {
  if (!isCacheStale(dir, key, ttlDays)) {
    const cached = readCache<T>(dir, key);
    if (cached !== null) return { raw: cached, fromCache: true };
  }
  const raw = await fetcher();
  writeCache(dir, key, raw);
  return { raw, fromCache: false };
}

/**
 * Clear all cache files whose key starts with the domain prefix.
 * Returns number of files successfully deleted (concurrent deletes are skipped silently).
 */
export function clearCacheDomain(dir: string, domain: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  const prefix = domain.toLowerCase();
  for (const f of readdirSync(dir)) {
    if (f.toLowerCase().startsWith(prefix) && f.endsWith('.json')) {
      try {
        unlinkSync(resolve(dir, f));
        count++;
      } catch {
        // File may have been deleted concurrently; skip.
      }
    }
  }
  return count;
}
