import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { fetchWithCache, readCache, writeCache, isCacheStale, hashKey, clearCacheDomain } from '../../scripts/pipeline/_cache';

const TEST_DIR = resolve(__dirname, '../../data/cache-test');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('hashKey', () => {
  it('returns same hash for same input', () => {
    expect(hashKey('captainds.com', 'funding query')).toBe(hashKey('captainds.com', 'funding query'));
  });

  it('returns different hash for different input', () => {
    expect(hashKey('a', 'b')).not.toBe(hashKey('a', 'c'));
  });
});

describe('writeCache and readCache', () => {
  it('writes and reads JSON payload', () => {
    writeCache(TEST_DIR, 'k1', { foo: 'bar', n: 42 });
    const got = readCache(TEST_DIR, 'k1');
    expect(got).toEqual({ foo: 'bar', n: 42 });
  });

  it('returns null for missing key', () => {
    expect(readCache(TEST_DIR, 'nonexistent')).toBeNull();
  });
});

describe('isCacheStale', () => {
  it('returns false for fresh cache within TTL', () => {
    writeCache(TEST_DIR, 'k1', { foo: 'bar' });
    expect(isCacheStale(TEST_DIR, 'k1', 30)).toBe(false);
  });

  it('returns true when file does not exist', () => {
    expect(isCacheStale(TEST_DIR, 'missing', 30)).toBe(true);
  });
});

describe('fetchWithCache', () => {
  it('calls fetcher on cache miss and saves response', async () => {
    let calls = 0;
    const result = await fetchWithCache(TEST_DIR, 'k1', 30, async () => {
      calls++;
      return { value: 'from-api' };
    });
    expect(calls).toBe(1);
    expect(result.raw).toEqual({ value: 'from-api' });
    expect(result.fromCache).toBe(false);
  });

  it('does not call fetcher on cache hit', async () => {
    writeCache(TEST_DIR, 'k1', { value: 'cached' });
    let calls = 0;
    const result = await fetchWithCache(TEST_DIR, 'k1', 30, async () => { calls++; return { value: 'new' }; });
    expect(calls).toBe(0);
    expect(result.raw).toEqual({ value: 'cached' });
    expect(result.fromCache).toBe(true);
  });

  it('saves to disk BEFORE returning, so parser failures do not lose data', async () => {
    await fetchWithCache(TEST_DIR, 'k1', 30, async () => ({ value: 'must-be-saved' }));
    const stored = readCache(TEST_DIR, 'k1');
    expect(stored).toEqual({ value: 'must-be-saved' });
  });
});

describe('clearCacheDomain', () => {
  it('only clears entries matching the domain', () => {
    writeCache(TEST_DIR, 'captainds.com--funding', { x: 1 });
    writeCache(TEST_DIR, 'captainds.com--press', { x: 2 });
    writeCache(TEST_DIR, 'other.com--funding', { x: 3 });
    const cleared = clearCacheDomain(TEST_DIR, 'captainds.com');
    expect(cleared).toBe(2);
    expect(readCache(TEST_DIR, 'captainds.com--funding')).toBeNull();
    expect(readCache(TEST_DIR, 'other.com--funding')).toEqual({ x: 3 });
  });
});

describe('path traversal protection', () => {
  it('rejects keys containing ..', () => {
    expect(() => writeCache(TEST_DIR, '../escape', { x: 1 })).toThrow(/invalid cache key/i);
  });

  it('rejects keys containing slash', () => {
    expect(() => writeCache(TEST_DIR, 'foo/bar', { x: 1 })).toThrow(/invalid cache key/i);
  });

  it('rejects keys containing backslash', () => {
    expect(() => writeCache(TEST_DIR, 'foo\\bar', { x: 1 })).toThrow(/invalid cache key/i);
  });

  it('rejects empty keys', () => {
    expect(() => writeCache(TEST_DIR, '', { x: 1 })).toThrow(/invalid cache key/i);
  });
});
