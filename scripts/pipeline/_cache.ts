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

function pathFor(dir: string, key: string): string {
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
  } catch {
    return null;
  }
}

export function isCacheStale(dir: string, key: string, ttlDays: number): boolean {
  const p = pathFor(dir, key);
  if (!existsSync(p)) return true;
  const ageMs = Date.now() - statSync(p).mtimeMs;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays > ttlDays;
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
 * Returns number of files deleted.
 */
export function clearCacheDomain(dir: string, domain: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  const prefix = domain.toLowerCase();
  for (const f of readdirSync(dir)) {
    if (f.toLowerCase().startsWith(prefix) && f.endsWith('.json')) {
      unlinkSync(resolve(dir, f));
      count++;
    }
  }
  return count;
}
