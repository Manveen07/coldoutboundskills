import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { serperSearch } from '../scripts/_serper_client';

const FUNDING_SUCCESS = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/serper-funding-success.json'), 'utf8'));
const EMPTY = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/serper-empty.json'), 'utf8'));

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('serperSearch', () => {
  it('returns structured response on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(FUNDING_SUCCESS),
    } as any);

    const result = await serperSearch('Test Co raised funding 2025 2026', 'test-api-key');
    expect(result.status).toBe(200);
    expect(result.queryString).toBe('Test Co raised funding 2025 2026');
    expect(result.raw.organic[0].title).toContain('Series B');
    expect(result.timestamp).toBeDefined();
  });

  it('returns empty result count when no organic results', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(EMPTY),
    } as any);

    const result = await serperSearch('Random Brand raised funding 2025 2026', 'test-api-key');
    expect(result.raw.organic).toHaveLength(0);
  });

  it('retries on 429 rate limit', async () => {
    let calls = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      calls++;
      if (calls === 1) {
        return Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}) } as any);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(FUNDING_SUCCESS) } as any);
    });

    const result = await serperSearch('q', 'key');
    expect(calls).toBe(2);
    expect(result.status).toBe(200);
  });

  it('gives up after 3 retries', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 429, json: () => Promise.resolve({})
    } as any);

    await expect(serperSearch('q', 'key')).rejects.toThrow(/rate limit/i);
  });
});
