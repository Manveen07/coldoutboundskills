import { describe, it, expect } from 'vitest';
import { buildExclusionSet, isExcluded, loadExclusionSet } from '../scripts/_exclusion_list';

const SAMPLE_CSV = 'domain,company_name,reason\nbombas.com,Bombas,existing_client\ncohereone.com,CohereOne,competitor\n';

describe('buildExclusionSet', () => {
  it('loads domains from CSV text', () => {
    const set = buildExclusionSet(SAMPLE_CSV);
    expect(set.domains.has('bombas.com')).toBe(true);
    expect(set.domains.has('cohereone.com')).toBe(true);
  });

  it('loads company names from CSV text', () => {
    const set = buildExclusionSet(SAMPLE_CSV);
    expect(set.companyNames.has('bombas')).toBe(true);
  });

  it('skips header row', () => {
    const set = buildExclusionSet(SAMPLE_CSV);
    expect(set.domains.has('domain')).toBe(false);
  });
});

describe('isExcluded', () => {
  const set = buildExclusionSet(SAMPLE_CSV);

  it('matches exact domain', () => {
    expect(isExcluded('bombas.com', set)).toBe(true);
  });

  it('matches subdomain', () => {
    expect(isExcluded('shop.bombas.com', set)).toBe(true);
  });

  it('does not match unrelated domain', () => {
    expect(isExcluded('notbombas.com', set)).toBe(false);
  });

  it('matches by company name case-insensitive', () => {
    expect(isExcluded('bombas.com', set, 'BOMBAS')).toBe(true);
  });

  it('strips www prefix', () => {
    expect(isExcluded('www.bombas.com', set)).toBe(true);
  });
});

describe('loadExclusionSet', () => {
  it('returns empty set if file missing', () => {
    const set = loadExclusionSet('/nonexistent/path.csv');
    expect(set.domains.size).toBe(0);
    expect(set.companyNames.size).toBe(0);
  });

  it('loads actual data file without throwing', () => {
    const set = loadExclusionSet();
    expect(set.domains).toBeDefined();
  });
});
