import { describe, it, expect } from 'vitest';
import { buildProspeoFilters, leadFromProspeoResult } from '../../scripts/pipeline/_pull';
import type { ClientConfig } from '../../scripts/_client_config';

const SAMPLE_CFG: ClientConfig = {
  business: { name: 'Test', website: '', one_liner: '', tone: '' },
  offer: { primary_product: '', primary_cta: '', lead_magnet: '', value_prop: '' },
  icp_hard_filters: {
    job_titles: ['CMO', 'VP Marketing'],
    industries_in: ['Restaurants', 'General Retail'],
    industries_out: [],
    headcount_min: 200,
    headcount_max: 10000,
    countries: ['US'],
    excluded_domains: [],
  },
  proof_points: { headline_stats: [], vertical_anchor_map: {}, portfolio_stats: [], by_product: {} },
} as any;

describe('buildProspeoFilters', () => {
  it('maps client config to Prospeo filter object', () => {
    const filters = buildProspeoFilters(SAMPLE_CFG);
    expect(filters.person_job_title?.include).toContain('CMO');
    expect(filters.company_industry?.include).toContain('Restaurants');
    expect(filters.company_headcount_custom).toEqual({ min: 200, max: 10000 });
    expect(filters.person_location_search?.include).toContain('United States #US');
  });

  it('applies category override when provided', () => {
    const cfg = { ...SAMPLE_CFG };
    (cfg as any).vertical_industries = { qsr: ['Restaurants'] };
    const filters = buildProspeoFilters(cfg, 'qsr');
    expect(filters.company_industry?.include).toEqual(['Restaurants']);
  });

  it('falls back to industries_in when category has no override', () => {
    const cfg = { ...SAMPLE_CFG };
    (cfg as any).vertical_industries = { other: ['X'] };
    const filters = buildProspeoFilters(cfg, 'qsr');
    expect(filters.company_industry?.include).toContain('Restaurants');
  });
});

describe('leadFromProspeoResult', () => {
  it('extracts standard fields from Prospeo result', () => {
    const result = {
      person: {
        person_id: 'p1', first_name: 'Jane', last_name: 'Doe', full_name: 'Jane Doe',
        current_job_title: 'CMO', linkedin_url: 'https://lnk', location: { city: 'NYC', state: 'NY', country: 'US' },
        email: 'jane@acme.com',
      },
      company: { name: 'Acme', domain: 'acme.com', industry: 'Restaurants', headcount: 500, headcount_range: '201-500' },
    };
    const lead = leadFromProspeoResult(result);
    expect(lead.person_id).toBe('p1');
    expect(lead.full_name).toBe('Jane Doe');
    expect(lead.company_name).toBe('Acme');
    expect(lead.company_domain).toBe('acme.com');
    expect(lead.email).toBe('jane@acme.com');
  });

  it('returns empty strings for missing fields', () => {
    const lead = leadFromProspeoResult({});
    expect(lead.person_id).toBe('');
    expect(lead.full_name).toBe('');
  });
});
