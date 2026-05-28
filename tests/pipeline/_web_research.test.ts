import { describe, it, expect } from 'vitest';
import { buildWebResearchPrompt, gapsToSerperQueryTypes } from '../../scripts/pipeline/_web_research';
import type { Lead } from '../../scripts/pipeline/_pull';

const LEAD: Lead = {
  person_id: 'p1', first_name: 'Jane', last_name: 'Doe', full_name: 'Jane Doe',
  current_job_title: 'CMO', email: '', email_status: '', person_linkedin_url: '',
  person_city: '', person_state: '', person_country: '',
  company_name: 'Acme', company_domain: 'acme.com', company_industry: 'Restaurants',
  company_headcount: '', company_headcount_range: '', company_linkedin_url: '',
  company_city: '', company_state: '', company_country: '',
};

describe('buildWebResearchPrompt', () => {
  it('embeds lead identity and target signals', () => {
    const prompt = buildWebResearchPrompt(LEAD);
    expect(prompt).toContain('Jane Doe');
    expect(prompt).toContain('Acme');
    expect(prompt).toContain('acme.com');
    expect(prompt).toMatch(/funding/i);
    expect(prompt).toMatch(/WebFetch/i);
    expect(prompt).toMatch(/JSON/i);
  });

  it('instructs not to fabricate', () => {
    const prompt = buildWebResearchPrompt(LEAD);
    expect(prompt).toMatch(/do NOT fabricate/i);
  });
});

describe('gapsToSerperQueryTypes', () => {
  it('returns only funding when funding is the only gap', () => {
    const types = gapsToSerperQueryTypes(['funding']);
    expect(types.has('funding')).toBe(true);
    expect(types.has('press')).toBe(false);
  });

  it('maps expansion to press queries', () => {
    const types = gapsToSerperQueryTypes(['expansion']);
    expect(types.has('press')).toBe(true);
  });

  it('returns empty set when no gaps', () => {
    expect(gapsToSerperQueryTypes([]).size).toBe(0);
  });
});
