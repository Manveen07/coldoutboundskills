import { describe, it, expect } from 'vitest';
import { decideTier, buildPersonQueries } from '../../scripts/pipeline/_research';

describe('decideTier', () => {
  it('returns T1 by default', () => {
    expect(decideTier({ icp_confidence: '0.7' } as any, [], { t2: 0.8, t3: 0.9 })).toBe('T1');
  });

  it('returns T2 when icp_confidence >= t2 threshold', () => {
    expect(decideTier({ icp_confidence: '0.82', company_domain: 'foo.com' } as any, [], { t2: 0.8, t3: 0.9 })).toBe('T2');
  });

  it('returns T3 when icp_confidence >= t3 threshold', () => {
    expect(decideTier({ icp_confidence: '0.95', company_domain: 'foo.com' } as any, [], { t2: 0.8, t3: 0.9 })).toBe('T3');
  });

  it('returns T3 when domain in priority_domains regardless of confidence', () => {
    expect(decideTier({ icp_confidence: '0.5', company_domain: 'priority.com' } as any, ['priority.com'], { t2: 0.8, t3: 0.9 })).toBe('T3');
  });
});

describe('buildPersonQueries', () => {
  it('generates name + company queries excluding LinkedIn', () => {
    const queries = buildPersonQueries('Jane Doe', 'Acme');
    expect(queries.some(q => q.includes('Jane Doe'))).toBe(true);
    expect(queries.some(q => q.includes('Acme'))).toBe(true);
    expect(queries.every(q => q.includes('-inurl:linkedin'))).toBe(true);
  });
});
