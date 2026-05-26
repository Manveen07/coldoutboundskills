import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { extractSignalsForLead } from '../scripts/extract-signals';

const TEST_DIR = resolve(__dirname, '../data/signals-test-extractor');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
  vi.restoreAllMocks();
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('extractSignalsForLead', () => {
  it('writes sidecar after fetch + returns enrichment_tier', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ organic: [{ title: 'X raises $5M', snippet: 'X raised $5M Series A in February 2026.', date: '2026-02-15' }] }),
    } as any);

    const lead = {
      person_id: 'pid_1',
      qual_confidence: 0.85,
      title: 'VP Marketing',
      company_name: 'X',
      company_domain: 'x.com',
    };

    const result = await extractSignalsForLead(lead, 'fake-key', TEST_DIR);

    expect(result.enrichment_tier).toBe('T1');
    expect(result.skipped_ineligible).toBe(false);
    expect(existsSync(resolve(TEST_DIR, 'x.com.json'))).toBe(true);
    const sidecar = JSON.parse(readFileSync(resolve(TEST_DIR, 'x.com.json'), 'utf8'));
    expect(sidecar.funding.fact).toContain('Series A');
  });

  it('returns cached sidecar without re-fetching', async () => {
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(resolve(TEST_DIR, 'cached.com.json'), JSON.stringify({
      schema_version: '1.0',
      domain: 'cached.com',
      fetched_at: oneDayAgo,
      funding: { fact: 'old funding', freshness_days: 100 },
      company_snippet: { fact: 'snippet from cache' },
    }));

    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    const lead = {
      person_id: 'pid_2',
      qual_confidence: 0.85,
      title: 'VP Marketing',
      company_name: 'Cached',
      company_domain: 'cached.com',
    };

    const result = await extractSignalsForLead(lead, 'fake-key', TEST_DIR);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.cache_hit).toBe(true);
    expect(result.enrichment_tier).toBe('T1');
  });

  it('skips ineligible leads (Amendment 1)', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    const lead = {
      person_id: 'pid_3',
      qual_confidence: 0.85,
      title: 'VP Marketing',
      company_name: 'NoLongerHere',
      company_domain: 'gone.com',
      eligible: false,
    };

    const result = await extractSignalsForLead(lead, 'fake-key', TEST_DIR);
    expect(result.skipped_ineligible).toBe(true);
    expect(result.fired_queries).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(resolve(TEST_DIR, 'gone.com.json'))).toBe(false);
  });

  it('persists available_signals[] in sidecar (Amendment 2)', async () => {
    let callIdx = 0;
    const responses = [
      // F1 funding
      { organic: [{ title: 'Y raises $10M', snippet: 'Y raised $10M Series B in Jan 2026.', date: '2026-01-15' }] },
      // F2 funding (T1) — second funding query, will not overwrite first
      { organic: [{ title: 'Y series B', snippet: 'Y Series B led by Acme', date: '2026-01-15' }] },
      // P1 press
      { organic: [{ title: 'Y opens store', snippet: 'Y announces new store in March 2026.', date: '2026-03-01' }] },
      // P2 press
      { organic: [{ title: 'Y press', snippet: 'Y announces partnership.', date: '2026-02-01' }] },
      // L1 launch
      { organic: [{ title: 'Y launches', snippet: 'Y launches new product line.', date: '2026-03-15' }] },
      // L2 launch
      { organic: [{ title: 'Y debuts', snippet: 'Y debuts new collection.', date: '2026-03-20' }] },
      // S1 snippet
      { organic: [{ title: 'Y home page', snippet: 'Y is a DTC brand with 30 stores.' }] },
    ];
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve(responses[callIdx++] || { organic: [] }),
    } as any));

    const lead = {
      person_id: 'pid_4',
      qual_confidence: 0.85,
      title: 'VP Marketing',
      company_name: 'Y',
      company_domain: 'y.com',
    };

    await extractSignalsForLead(lead, 'fake-key', TEST_DIR);
    const sidecar = JSON.parse(readFileSync(resolve(TEST_DIR, 'y.com.json'), 'utf8'));

    expect(Array.isArray(sidecar.available_signals)).toBe(true);
    expect(sidecar.available_signals.length).toBeGreaterThanOrEqual(3);
    // Each entry has required fields
    for (const sig of sidecar.available_signals) {
      expect(sig.type).toBeDefined();
      expect(sig.fact).toBeDefined();
      expect(sig.rank).toBeDefined();
    }
  });
});
