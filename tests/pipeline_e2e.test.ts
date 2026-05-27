import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { extractSignalsForLead } from '../scripts/extract-signals';
import { renderLead } from '../scripts/render-with-signals';
import { StatRotator } from '../scripts/_stat_rotator';
import {
  check11_bannedWords,
  check11b_firstPersonObservation,
  check12_capitalization,
  check13_freshness,
  check15_email2WordCap,
} from '../scripts/validate-final';

const TEST_DIR = resolve(__dirname, '../data/signals-e2e');

const MOCK_LEADS = [
  {
    person_id: 'pid_1', first_name: 'Alex', full_name: 'Alex Smith',
    current_job_title: 'VP Marketing', company_name: 'Faherty',
    company_domain: 'faherty-e2e.com', qual_confidence: 0.85,
    primary_vertical: 'apparel', assigned_variant: 'B' as const,
    vertical_anchor: 'Bombas',
    ai_similarity_dimension: 'DTC channel, premium apparel, store plus DTC',
    ai_brand_category: 'lifestyle apparel',
    ai_role_hook: 'VP Marketing owns acquisition mix at lifestyle apparel brand'
  },
  {
    person_id: 'pid_2', first_name: 'Sam', full_name: 'Sam Jones',
    current_job_title: 'Marketing Manager', company_name: 'SmallCo',
    company_domain: 'smallco-e2e.com', qual_confidence: 0.72,
    primary_vertical: 'apparel', assigned_variant: 'C' as const,
    ai_brand_category: 'premium accessories',
    ai_role_hook: 'Marketing Manager runs DTC marketing at premium accessories'
  },
];

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
  vi.restoreAllMocks();
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('e2e pipeline', () => {
  it('runs extractor -> renderer -> validator and all leads produce valid output', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({
        organic: [{
          title: 'Brand X press',
          snippet: 'Brand X opened a store in March 2026.',
          date: '2026-03-15',
        }],
      }),
    } as any);

    const aiInvoke = vi.fn().mockResolvedValue('Retail expansion at that pace pulls hard on the DTC channel.');

    const renderedLeads = [];
    const rotator = new StatRotator();
    for (const lead of MOCK_LEADS) {
      await extractSignalsForLead(lead, 'fake-key', TEST_DIR);
      const rendered = await renderLead(lead, aiInvoke, TEST_DIR, rotator);
      renderedLeads.push(rendered);
    }

    expect(renderedLeads).toHaveLength(2);

    for (const r of renderedLeads) {
      expect(check11_bannedWords(r).pass).toBe(true);
      expect(check11b_firstPersonObservation(r).pass).toBe(true);
      expect(check12_capitalization(r).pass).toBe(true);
      expect(check13_freshness(r).pass).toBe(true);
      expect(check15_email2WordCap(r).pass).toBe(true);
    }

    // T1 lead is pid_1 (conf 0.85, VP), T3 is pid_2 (conf 0.72, Manager)
    expect(renderedLeads.find(r => r.person_id === 'pid_1')!.enrichment_tier).toBe('T1');
    expect(renderedLeads.find(r => r.person_id === 'pid_2')!.enrichment_tier).toBe('T3');
  });

  it('re-run uses cache (no API calls second time)', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ organic: [] }),
      } as any);
    });

    const lead = MOCK_LEADS[0];
    await extractSignalsForLead(lead, 'k', TEST_DIR);
    const firstCalls = callCount;

    await extractSignalsForLead(lead, 'k', TEST_DIR);
    expect(callCount).toBe(firstCalls);
  });
});
