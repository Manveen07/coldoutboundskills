import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { extractFundingFact, extractPressFact } from '../../scripts/_fact_extractor';
import { leadFromProspeoResult } from '../../scripts/pipeline/_pull';
import { validateMechanical } from '../../scripts/pipeline/_validate';
import { buildWriterPrompt } from '../../scripts/pipeline/_write';

const FX = resolve(__dirname, '../fixtures');
const prospeoFx = JSON.parse(readFileSync(resolve(FX, 'prospeo-page-1.json'), 'utf8'));
const fundingFx = JSON.parse(readFileSync(resolve(FX, 'serper-funding-acme.json'), 'utf8'));
const pressFx = JSON.parse(readFileSync(resolve(FX, 'serper-press-acme.json'), 'utf8'));

describe('integration: Prospeo -> Lead -> Research -> Writer prompt', () => {
  it('Prospeo result becomes a valid Lead', () => {
    const lead = leadFromProspeoResult(prospeoFx.results[0]);
    expect(lead.person_id).toBe('p1');
    expect(lead.company_domain).toBe('acme.com');
    expect(lead.email).toBe('jane@acme.com');
  });

  it('Funding fixture extracts a fact (trusted domain)', () => {
    const fact = extractFundingFact(fundingFx, 'Acme');
    expect(fact).not.toBeNull();
    expect(fact!.fact).toMatch(/series b/i);
  });

  it('Press fixture extracts a fact (trusted domain)', () => {
    const fact = extractPressFact(pressFx, 'Acme');
    expect(fact).not.toBeNull();
    expect(fact!.fact).toMatch(/expand|opening/i);
  });

  it('Writer prompt embeds dossier and rules', () => {
    const lead = leadFromProspeoResult(prospeoFx.results[0]);
    const fundingFact = extractFundingFact(fundingFx, 'Acme');
    const dossier: any = {
      tier: 'T2',
      person: { person_id: lead.person_id, full_name: lead.full_name, title: lead.current_job_title, seniority: 'C-suite', linkedin_url: '' },
      company: { name: lead.company_name, domain: lead.company_domain, industry: lead.company_industry, headcount_range: lead.company_headcount_range, location: '' },
      signals: { funding_fact: fundingFact?.fact ?? null, press_facts: [], acquisition_fact: null, category_snippet: null },
      scrape: null,
      person_depth: { person_quote: null, recent_post_topic: null, public_speaking_topics: [], career_pivot_signal: null },
    };
    const cfg = {
      business: { name: 'TestCo', website: '', one_liner: 'A test', tone: 'peer-to-peer' },
      offer: { primary_product: 'Audit', primary_cta: '', value_prop: '', lead_magnet: '' },
      legal: { banned_words: [] },
      copy_tone: { in_vocabulary: [], out_vocabulary: [] },
    } as any;
    const prompt = buildWriterPrompt({ dossier, cfg, exampleEmails: [], firstName: lead.first_name });
    expect(prompt).toContain('Series B');
    expect(prompt).toContain('Jane');
    expect(prompt).toContain('Acme');
  });

  it('Mechanical validator rejects a templated email with em dashes', () => {
    const email = { subject: 's', body: 'jane — we noticed acme raised series b. happy to chat.', research_detail_used: 'Series B' };
    const result = validateMechanical(email, { wordCount: { min: 5, max: 90 }, banned: [] });
    expect(result.pass).toBe(false);
    expect(result.violations.some(v => /em dash/i.test(v))).toBe(true);
  });
});
