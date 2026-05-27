import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { resolve } from 'path';
import { readSidecar, writeSidecar } from '../scripts/_lib_signals';

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
