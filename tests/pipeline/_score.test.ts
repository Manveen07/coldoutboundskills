import { describe, it, expect } from 'vitest';
import { buildScoringPrompt, applyScoresToLeads } from '../../scripts/pipeline/_score';
import type { Lead } from '../../scripts/pipeline/_pull';

const SAMPLE_LEAD: Lead = {
  person_id: 'p1', first_name: 'J', last_name: 'D', full_name: 'J D',
  current_job_title: 'CMO', email: '', email_status: '', person_linkedin_url: '',
  person_city: '', person_state: '', person_country: '',
  company_name: 'Acme', company_domain: 'acme.com', company_industry: 'Restaurants',
  company_headcount: '', company_headcount_range: '201-500', company_linkedin_url: '',
  company_city: '', company_state: '', company_country: '',
};

describe('buildScoringPrompt', () => {
  it('embeds ICP prompt and lead batch as JSON', () => {
    const prompt = buildScoringPrompt('ICP RULES HERE', [SAMPLE_LEAD]);
    expect(prompt).toContain('ICP RULES HERE');
    expect(prompt).toContain('acme.com');
    expect(prompt).toContain('Restaurants');
    expect(prompt).toMatch(/return.*JSON.*array/i);
  });
});

describe('applyScoresToLeads', () => {
  it('attaches qualified/confidence/reason to matching leads by domain', () => {
    const scores = [
      { company: 'Acme', domain: 'acme.com', qualified: true, confidence: 0.85, reason: 'fits ICP' },
    ];
    const result = applyScoresToLeads([SAMPLE_LEAD], scores);
    expect(result[0].icp_qualified).toBe('true');
    expect(result[0].icp_confidence).toBe('0.85');
    expect(result[0].icp_reason).toBe('fits ICP');
  });

  it('marks unscored leads with icp_qualified=unknown', () => {
    const result = applyScoresToLeads([SAMPLE_LEAD], []);
    expect(result[0].icp_qualified).toBe('unknown');
  });

  it('normalizes www. prefix when matching', () => {
    const scores = [{ company: 'Acme', domain: 'acme.com', qualified: true, confidence: 0.9, reason: '' }];
    const lead = { ...SAMPLE_LEAD, company_domain: 'www.acme.com' };
    const result = applyScoresToLeads([lead], scores);
    expect(result[0].icp_qualified).toBe('true');
  });
});
