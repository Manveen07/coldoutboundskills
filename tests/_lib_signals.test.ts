import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { resolve } from 'path';
import { readSidecar, writeSidecar } from '../scripts/_lib_signals';
import { computeTier } from '../scripts/_lib_signals';

const TEST_DIR = resolve(__dirname, '../data/signals-test');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('cache read/write', () => {
  it('returns fresh sidecar when within TTL', () => {
    const now = new Date().toISOString();
    writeSidecar('example.com', {
      schema_version: '1.0',
      domain: 'example.com',
      fetched_at: now,
      company_snippet: { fact: 'snippet', source_query: 'q' },
    }, TEST_DIR);

    const data = readSidecar('example.com', TEST_DIR);
    expect(data).not.toBeNull();
    expect(data!.cache_status).toBe('fresh');
    expect(data!.company_snippet.fact).toBe('snippet');
  });

  it('returns stale sidecar when older than TTL', () => {
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    writeSidecar('example.com', {
      schema_version: '1.0',
      domain: 'example.com',
      fetched_at: oldDate,
      company_snippet: { fact: 'old', source_query: 'q' },
    }, TEST_DIR);

    const data = readSidecar('example.com', TEST_DIR);
    expect(data!.cache_status).toBe('stale');
  });

  it('uses 7-day TTL for empty sidecars', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    writeSidecar('example.com', {
      schema_version: '1.0',
      domain: 'example.com',
      fetched_at: eightDaysAgo,
      company_snippet: { fact: null, source_query: 'q' },
      funding: { fact: null, found: false },
    }, TEST_DIR);

    const data = readSidecar('example.com', TEST_DIR);
    expect(data!.cache_status).toBe('stale');
    expect(data!.ttl_days).toBe(7);
  });

  it('returns null if sidecar missing', () => {
    const data = readSidecar('nonexistent.com', TEST_DIR);
    expect(data).toBeNull();
  });
});

describe('tier computation', () => {
  it('T1: VP+ with conf >= 0.80', () => {
    expect(computeTier({ qual_confidence: 0.85, title: 'VP Marketing' })).toBe('T1');
    expect(computeTier({ qual_confidence: 0.92, title: 'CMO' })).toBe('T1');
    expect(computeTier({ qual_confidence: 0.80, title: 'Founder' })).toBe('T1');
  });

  it('T1: Director+ with conf >= 0.90', () => {
    expect(computeTier({ qual_confidence: 0.91, title: 'Director of Growth' })).toBe('T1');
    expect(computeTier({ qual_confidence: 0.89, title: 'Director of Growth' })).toBe('T2');
  });

  it('T1: Head of with conf >= 0.90 (regression for plan-template bug)', () => {
    expect(computeTier({ qual_confidence: 0.91, title: 'Head of Brand' })).toBe('T1');
  });

  it('T2: Director+ with conf 0.70-0.89', () => {
    expect(computeTier({ qual_confidence: 0.75, title: 'Director of Marketing' })).toBe('T2');
    expect(computeTier({ qual_confidence: 0.80, title: 'Head of Brand' })).toBe('T2');
    expect(computeTier({ qual_confidence: 0.85, title: 'Senior Manager' })).toBe('T2');
  });

  it('T2: Manager with conf >= 0.80', () => {
    expect(computeTier({ qual_confidence: 0.82, title: 'Marketing Manager' })).toBe('T2');
    expect(computeTier({ qual_confidence: 0.79, title: 'Marketing Manager' })).toBe('T3');
  });

  it('T3: everyone else qualified', () => {
    expect(computeTier({ qual_confidence: 0.71, title: 'Specialist' })).toBe('T3');
    expect(computeTier({ qual_confidence: 0.75, title: 'Coordinator' })).toBe('T3');
  });

  it('throws if below qualifier floor', () => {
    expect(() => computeTier({ qual_confidence: 0.65, title: 'CMO' }))
      .toThrow(/below qualifier floor/i);
  });
});
