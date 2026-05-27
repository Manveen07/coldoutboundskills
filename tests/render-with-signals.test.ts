import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { renderLead } from '../scripts/render-with-signals';
import { StatRotator } from '../scripts/_stat_rotator';

const TEST_DIR = resolve(__dirname, '../data/signals-renderer-test');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('renderLead', () => {
  it('renders Variant B with signal when fresh signal present', async () => {
    writeFileSync(resolve(TEST_DIR, 'faherty.com.json'), JSON.stringify({
      schema_version: '1.0',
      domain: 'faherty.com',
      fetched_at: new Date().toISOString(),
      funding: { fact: 'Faherty raised $18M Series B in March 2026.', found: true, freshness_days: 30 },
      company_snippet: { fact: 'Faherty: DTC heritage lifestyle with 30 stores.' },
    }));

    const lead = {
      person_id: 'pid_1', first_name: 'Alex', full_name: 'Alex Smith', current_job_title: 'VP Marketing',
      company_name: 'Faherty', company_domain: 'faherty.com', qual_confidence: 0.85,
      primary_vertical: 'apparel', assigned_variant: 'B' as const, vertical_anchor: 'Bombas',
      ai_similarity_dimension: 'DTC channel, premium apparel, store plus DTC mix',
      ai_brand_category: 'premium lifestyle apparel',
      ai_role_hook: 'VP Marketing owns acquisition mix at premium lifestyle apparel brand',
    };

    const aiInvoke = vi.fn().mockResolvedValue('Brands at that funding stage typically start asking the channel-mix question.');
    const rotator = new StatRotator();

    const result = await renderLead(lead, aiInvoke, TEST_DIR, rotator);

    expect(result.signal_used).toBe('funding');
    expect(result.email1_body).toContain('Faherty raised $18M Series B');
    expect(result.email1_body).toContain('Brands at that funding stage');
    expect(result.enrichment_tier).toBe('T1');
  });

  it('falls back to anchor-only when no in-window signal (Variant B)', async () => {
    writeFileSync(resolve(TEST_DIR, 'faherty.com.json'), JSON.stringify({
      schema_version: '1.0',
      domain: 'faherty.com',
      fetched_at: new Date().toISOString(),
      funding: { fact: null, found: false },
      company_snippet: { fact: 'Faherty: DTC heritage lifestyle with 30 stores.' },
    }));

    const lead = {
      person_id: 'pid_2', first_name: 'Alex', full_name: 'Alex Smith', current_job_title: 'VP Marketing',
      company_name: 'Faherty', company_domain: 'faherty.com', qual_confidence: 0.85,
      primary_vertical: 'apparel', assigned_variant: 'B' as const, vertical_anchor: 'Bombas',
      ai_similarity_dimension: 'DTC channel, premium apparel, store plus DTC mix',
      ai_brand_category: 'premium lifestyle apparel',
      ai_role_hook: 'VP Marketing owns acquisition mix',
    };

    const aiInvoke = vi.fn().mockResolvedValue('Brands have driven results.');
    const rotator = new StatRotator();
    const result = await renderLead(lead, aiInvoke, TEST_DIR, rotator);

    // Snippet found → signal_used will be 'company_snippet' not 'fallback'
    expect(result.signal_used).toBe('company_snippet');
    expect(result.email1_body).toContain('30 stores');
  });

  it('renders Variant C with stat rotation', async () => {
    writeFileSync(resolve(TEST_DIR, 'smallco.com.json'), JSON.stringify({
      schema_version: '1.0',
      domain: 'smallco.com',
      fetched_at: new Date().toISOString(),
      company_snippet: { fact: 'SmallCo: DTC premium accessories.' },
    }));

    const lead = {
      person_id: 'pid_3', first_name: 'Sam', full_name: 'Sam Jones', current_job_title: 'Marketing Manager',
      company_name: 'SmallCo', company_domain: 'smallco.com', qual_confidence: 0.75,
      primary_vertical: 'apparel', assigned_variant: 'C' as const,
      ai_brand_category: 'premium accessories',
      ai_role_hook: 'Marketing Manager owns brand and acquisition',
    };

    const aiInvoke = vi.fn().mockResolvedValue('Brands in this space have driven results.');
    const rotator = new StatRotator();
    const result = await renderLead(lead, aiInvoke, TEST_DIR, rotator);

    // Variant C must include stat in E1
    expect(result.email1_body).toMatch(/103%|3-8x|20%|4,000\+|300\+/);
    // Email 2 must include a DIFFERENT stat (no repeat per Amendment 6)
    expect(result.email2_body).toMatch(/103%|3-8x|20%|4,000\+|300\+/);
    // The two stats in E1 and E2 should be different — find them and check
  });

  it('Email 2 is <=65 words (Amendment 7)', async () => {
    writeFileSync(resolve(TEST_DIR, 'co.com.json'), JSON.stringify({
      schema_version: '1.0',
      domain: 'co.com',
      fetched_at: new Date().toISOString(),
      funding: { fact: 'Co raised $5M Series A.', freshness_days: 30, found: true },
      company_snippet: { fact: 'Co snippet.' },
    }));

    const lead = {
      person_id: 'pid_4', first_name: 'Drew', full_name: 'Drew C', current_job_title: 'CMO',
      company_name: 'Co', company_domain: 'co.com', qual_confidence: 0.85,
      primary_vertical: 'apparel', assigned_variant: 'B' as const, vertical_anchor: 'Bombas',
      ai_similarity_dimension: 'DTC channel',
      ai_brand_category: 'premium apparel',
      ai_role_hook: 'CMO owns acquisition',
    };

    const aiInvoke = vi.fn().mockResolvedValue('Brands at this funding stage benchmark fast.');
    const rotator = new StatRotator();
    const result = await renderLead(lead, aiInvoke, TEST_DIR, rotator);

    const wordCount = result.email2_body.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThanOrEqual(65);
    expect(wordCount).toBeGreaterThanOrEqual(20);
  });
});
