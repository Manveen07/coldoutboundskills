import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { extractSignalsForLead } from '../scripts/extract-signals';

const TEST_DIR = resolve(__dirname, '../data/signals-cross-client');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
  vi.restoreAllMocks();
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('cross-client cache', () => {
  it('second client touching same domain reads cache and fires zero queries', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ organic: [{ title: 'Faherty launches Swim', snippet: 'Faherty launched Swim in March 2026.', date: '2026-03-15' }] }),
      } as any);
    });

    // BW Apparel touches faherty.com first
    const bwLead = {
      person_id: 'bw_pid_1',
      qual_confidence: 0.85,
      title: 'VP Marketing',
      company_name: 'Faherty',
      company_domain: 'faherty.com',
    };
    const bwResult = await extractSignalsForLead(bwLead, 'key', TEST_DIR);
    expect(bwResult.cache_hit).toBe(false);
    expect(bwResult.fired_queries).toBeGreaterThan(0);
    const callsAfterBw = callCount;

    // Hypothetical Client-Y touches faherty.com second
    const clientYLead = {
      person_id: 'cy_pid_1',
      qual_confidence: 0.82,
      title: 'CMO',
      company_name: 'Faherty',
      company_domain: 'faherty.com',
    };
    const cyResult = await extractSignalsForLead(clientYLead, 'key', TEST_DIR);

    expect(cyResult.cache_hit).toBe(true);
    expect(cyResult.fired_queries).toBe(0);
    expect(callCount).toBe(callsAfterBw);  // No new fetch calls
  });

  it('different domains do not share cache', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ organic: [] }),
      } as any);
    });

    const a = { person_id: 'a', qual_confidence: 0.85, title: 'VP', company_name: 'A', company_domain: 'a.com' };
    const b = { person_id: 'b', qual_confidence: 0.85, title: 'VP', company_name: 'B', company_domain: 'b.com' };

    await extractSignalsForLead(a, 'key', TEST_DIR);
    const callsAfterA = callCount;
    await extractSignalsForLead(b, 'key', TEST_DIR);

    expect(callCount).toBeGreaterThan(callsAfterA);  // Fresh fetches for b.com
  });
});
