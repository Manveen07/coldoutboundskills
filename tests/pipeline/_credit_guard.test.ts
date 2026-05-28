import { describe, it, expect } from 'vitest';
import { estimateRunCost, formatPreflightReport } from '../../scripts/pipeline/_credit_guard';

describe('estimateRunCost', () => {
  it('computes serper credit estimate from lead count and tier mix', () => {
    const estimate = estimateRunCost({
      qualifiedLeads: 100,
      tierMix: { T1: 70, T2: 20, T3: 10 },
      pagesToFetch: 0,
      cachedPages: 10,
      leadmagicLookups: 80,
    });
    // T1=8, T2=5, T3=3 (company) + T3 person=3
    // 70*8 + 20*5 + 10*3 + 10*3 = 560+100+30+30 = 720
    expect(estimate.serper_credits).toBe(720);
    expect(estimate.prospeo_pages).toBe(0);
    expect(estimate.leadmagic_lookups).toBe(80);
  });
});

describe('formatPreflightReport', () => {
  it('produces a readable summary table', () => {
    const report = formatPreflightReport({
      client: 'mythic', category: 'qsr',
      leads: 100, cachedLeads: 12,
      estimate: { serper_credits: 690, prospeo_pages: 0, leadmagic_lookups: 80, scrape_pages: 100, subagent_calls: 700 },
    });
    expect(report).toContain('mythic');
    expect(report).toContain('qsr');
    expect(report).toContain('690');
    expect(report).toContain('Proceed');
  });
});
