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
    // Bug 3: company_snippet is treated as fallback for E1 — no fact line in body
    expect(result.email1_body).not.toContain('30 stores');
    // Anchor proof block still renders
    expect(result.email1_body).toContain('Bombas');
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

  it('company_snippet leads have NO fact line in Email 1 + no bridge call (Bug 3)', async () => {
    writeFileSync(resolve(TEST_DIR, 'snippetco.com.json'), JSON.stringify({
      schema_version: '1.0',
      domain: 'snippetco.com',
      fetched_at: new Date().toISOString(),
      funding: { fact: null, found: false },
      company_snippet: { fact: 'SnippetCo is a DTC apparel brand with 12 retail stores.' },
    }));

    const lead = {
      person_id: 'pid_snip', first_name: 'Casey', full_name: 'Casey K', current_job_title: 'VP Marketing',
      company_name: 'SnippetCo', company_domain: 'snippetco.com', qual_confidence: 0.85,
      primary_vertical: 'apparel', assigned_variant: 'B' as const, vertical_anchor: 'Bombas',
      ai_similarity_dimension: 'DTC channel mix',
      ai_brand_category: 'premium apparel',
      ai_role_hook: 'VP Marketing owns acquisition mix',
    };

    const aiInvoke = vi.fn().mockResolvedValue('Brands at this stage benchmark fast.');
    const rotator = new StatRotator();
    const result = await renderLead(lead, aiInvoke, TEST_DIR, rotator);

    expect(result.signal_used).toBe('company_snippet');
    // No bridge generation for company_snippet
    expect(aiInvoke).not.toHaveBeenCalled();
    // Snippet text MUST NOT appear in email body
    expect(result.email1_body).not.toContain('SnippetCo is a DTC apparel brand');
    // E1 opens with the first-name + anchor proof; no fact line
    expect(result.email1_body).toMatch(/^Casey,\s*\n\nWe run direct mail for Bombas/);
  });

  it('real funding signal renders fact line + invokes bridge (Bug 3 regression guard)', async () => {
    writeFileSync(resolve(TEST_DIR, 'realfund.com.json'), JSON.stringify({
      schema_version: '1.0',
      domain: 'realfund.com',
      fetched_at: new Date().toISOString(),
      funding: { fact: 'RealFund raised $22M Series B in April 2026.', found: true, freshness_days: 14 },
      company_snippet: { fact: 'RealFund snippet.' },
    }));

    const lead = {
      person_id: 'pid_real', first_name: 'Jamie', full_name: 'Jamie R', current_job_title: 'VP Marketing',
      company_name: 'RealFund', company_domain: 'realfund.com', qual_confidence: 0.85,
      primary_vertical: 'apparel', assigned_variant: 'B' as const, vertical_anchor: 'Bombas',
      ai_similarity_dimension: 'DTC channel mix',
      ai_brand_category: 'premium apparel',
      ai_role_hook: 'VP Marketing owns acquisition mix',
    };

    const aiInvoke = vi.fn().mockResolvedValue('Brands at that funding stage start asking the channel-mix question.');
    const rotator = new StatRotator();
    const result = await renderLead(lead, aiInvoke, TEST_DIR, rotator);

    expect(result.signal_used).toBe('funding');
    expect(aiInvoke).toHaveBeenCalled();
    expect(result.email1_body).toContain('RealFund raised $22M Series B');
    expect(result.email1_body).toContain('Brands at that funding stage');
  });

  it('collapses to fallback when funding fact contains banned word (Bug 2)', async () => {
    writeFileSync(resolve(TEST_DIR, 'bannedco.com.json'), JSON.stringify({
      schema_version: '1.0',
      domain: 'bannedco.com',
      fetched_at: new Date().toISOString(),
      funding: { fact: 'BannedCo is the best DTC brand to raise $10M Series A this year.', found: true, freshness_days: 14 },
      company_snippet: { fact: null },
    }));

    const lead = {
      person_id: 'pid_b1', first_name: 'Pat', full_name: 'Pat B', current_job_title: 'VP Marketing',
      company_name: 'BannedCo', company_domain: 'bannedco.com', qual_confidence: 0.85,
      primary_vertical: 'apparel', assigned_variant: 'B' as const, vertical_anchor: 'Bombas',
      ai_similarity_dimension: 'DTC channel mix',
      ai_brand_category: 'premium apparel',
      ai_role_hook: 'VP Marketing owns acquisition mix',
    };

    const aiInvoke = vi.fn().mockResolvedValue('Brands at this funding stage benchmark fast.');
    const rotator = new StatRotator();
    const result = await renderLead(lead, aiInvoke, TEST_DIR, rotator);

    // signal collapsed to fallback
    expect(result.signal_used).toBe('fallback');
    expect(result.signal_fact).toBe('');
    expect(aiInvoke).not.toHaveBeenCalled();
    // no fact line in body
    expect(result.email1_body).not.toContain('best DTC');
  });

  it('renders clean funding fact normally (Bug 2 regression guard)', async () => {
    writeFileSync(resolve(TEST_DIR, 'cleanco.com.json'), JSON.stringify({
      schema_version: '1.0',
      domain: 'cleanco.com',
      fetched_at: new Date().toISOString(),
      funding: { fact: 'CleanCo raised $12M Series B in April 2026.', found: true, freshness_days: 20 },
      company_snippet: { fact: null },
    }));

    const lead = {
      person_id: 'pid_b2', first_name: 'Robin', full_name: 'Robin C', current_job_title: 'VP Marketing',
      company_name: 'CleanCo', company_domain: 'cleanco.com', qual_confidence: 0.85,
      primary_vertical: 'apparel', assigned_variant: 'B' as const, vertical_anchor: 'Bombas',
      ai_similarity_dimension: 'DTC channel mix',
      ai_brand_category: 'premium apparel',
      ai_role_hook: 'VP Marketing owns acquisition mix',
    };

    const aiInvoke = vi.fn().mockResolvedValue('Brands at that funding stage start asking the channel-mix question.');
    const rotator = new StatRotator();
    const result = await renderLead(lead, aiInvoke, TEST_DIR, rotator);

    expect(result.signal_used).toBe('funding');
    expect(aiInvoke).toHaveBeenCalled();
    expect(result.email1_body).toContain('CleanCo raised $12M Series B');
    expect(result.email1_body).toContain('Brands at that funding stage');
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

  // Fix #4 tests — compress anchor proof to outcome-only when signal-bridge present
  it('Fix #4: Variant B with bridge present → proof is first sentence only', async () => {
    writeFileSync(resolve(TEST_DIR, 'frankies.com.json'), JSON.stringify({
      schema_version: '1.0',
      domain: 'frankies.com',
      fetched_at: new Date().toISOString(),
      funding: { fact: 'Frankies Bikinis has raised $18M.', found: true, freshness_days: 20 },
      company_snippet: { fact: 'Frankies Bikinis: premium swimwear DTC.' },
    }));

    const lead = {
      person_id: 'pid_fix4a', first_name: 'Maya', full_name: 'Maya B', current_job_title: 'VP Marketing',
      company_name: 'Frankies Bikinis', company_domain: 'frankies.com', qual_confidence: 0.85,
      primary_vertical: 'apparel', assigned_variant: 'B' as const, vertical_anchor: 'Bombas',
      ai_similarity_dimension: 'DTC swimwear channel mix',
      ai_brand_category: 'premium swimwear',
      ai_role_hook: 'VP Marketing owns acquisition mix at premium swimwear brand',
    };

    const aiInvoke = vi.fn().mockResolvedValue('Post-funding swimwear brands typically reinvest in customer acquisition.');
    const rotator = new StatRotator();
    const result = await renderLead(lead, aiInvoke, TEST_DIR, rotator);

    expect(result.signal_used).toBe('funding');
    // Bridge is present → compressed proof only: "We run direct mail for Bombas."
    expect(result.email1_body).toContain('We run direct mail for Bombas.');
    // Second sentence of Bombas proof must NOT appear
    expect(result.email1_body).not.toContain('Scaled from a single test');
  });

  it('Fix #4: Variant B without bridge (fallback signal) → full proof retained', async () => {
    writeFileSync(resolve(TEST_DIR, 'nobridge.com.json'), JSON.stringify({
      schema_version: '1.0',
      domain: 'nobridge.com',
      fetched_at: new Date().toISOString(),
      funding: { fact: null, found: false },
      company_snippet: { fact: 'NoBridge: a DTC apparel brand.' },
    }));

    const lead = {
      person_id: 'pid_fix4b', first_name: 'Chris', full_name: 'Chris T', current_job_title: 'VP Marketing',
      company_name: 'NoBridge', company_domain: 'nobridge.com', qual_confidence: 0.85,
      primary_vertical: 'apparel', assigned_variant: 'B' as const, vertical_anchor: 'Bombas',
      ai_similarity_dimension: 'DTC apparel channel mix',
      ai_brand_category: 'premium apparel',
      ai_role_hook: 'VP Marketing owns acquisition mix',
    };

    const aiInvoke = vi.fn();
    const rotator = new StatRotator();
    const result = await renderLead(lead, aiInvoke, TEST_DIR, rotator);

    // company_snippet → no bridge call → no bridge → full proof retained
    expect(result.signal_used).toBe('company_snippet');
    expect(aiInvoke).not.toHaveBeenCalled();
    // Full Bombas proof including second sentence
    expect(result.email1_body).toContain('Scaled from a single test into their core profitable acquisition channel');
  });

  it('Fix #4: single-sentence anchor proof (Serena & Lily) compresses to same string + one period', async () => {
    writeFileSync(resolve(TEST_DIR, 'serenalily.com.json'), JSON.stringify({
      schema_version: '1.0',
      domain: 'serenalily.com',
      fetched_at: new Date().toISOString(),
      funding: { fact: 'Serena & Lily raised $30M Series C in February 2026.', found: true, freshness_days: 15 },
      company_snippet: { fact: 'Serena & Lily: premium home DTC brand.' },
    }));

    const lead = {
      person_id: 'pid_fix4c', first_name: 'Jordan', full_name: 'Jordan L', current_job_title: 'CMO',
      company_name: 'Serena & Lily', company_domain: 'serenalily.com', qual_confidence: 0.85,
      primary_vertical: 'home', assigned_variant: 'B' as const, vertical_anchor: 'Serena & Lily',
      ai_similarity_dimension: 'premium home DTC',
      ai_brand_category: 'premium home',
      ai_role_hook: 'CMO owns acquisition mix',
    };

    const aiInvoke = vi.fn().mockResolvedValue('Home brands at that funding stage benchmark acquisition fast.');
    const rotator = new StatRotator();
    const result = await renderLead(lead, aiInvoke, TEST_DIR, rotator);

    expect(result.signal_used).toBe('funding');
    // Single-sentence proof; compressProof must return it unchanged + one period
    expect(result.email1_body).toContain("We've been running direct mail for Serena & Lily for 11 years.");
    // Confirm no double period
    expect(result.email1_body).not.toContain('..');
  });

  it('Variant B Email 1 does not contain duplicate "sits in the same lane" sentences (Bug 5 regression)', async () => {
    writeFileSync(resolve(TEST_DIR, 'faherty.com.json'), JSON.stringify({
      schema_version: '1.0',
      domain: 'faherty.com',
      fetched_at: new Date().toISOString(),
      funding: { fact: 'Faherty raised $18M Series B in March 2026.', found: true, freshness_days: 30 },
    }));

    const lead = {
      person_id: 'pid_dup', first_name: 'Alex', full_name: 'Alex Smith',
      current_job_title: 'VP Marketing', company_name: 'Faherty',
      company_domain: 'faherty.com', qual_confidence: 0.85,
      primary_vertical: 'apparel', assigned_variant: 'B' as const,
      vertical_anchor: 'Bombas',
      ai_similarity_dimension: 'DTC channel, premium apparel, store plus DTC mix',
      ai_brand_category: 'lifestyle apparel',
      ai_role_hook: 'VP Marketing owns acquisition mix',
    };

    const aiInvoke = vi.fn().mockResolvedValue('Brands at that funding stage benchmark fast.');
    const rotator = new StatRotator();
    const result = await renderLead(lead, aiInvoke, TEST_DIR, rotator);

    const matches = result.email1_body.match(/sits in the same lane/g) || [];
    expect(matches.length).toBe(1);
  });
});
