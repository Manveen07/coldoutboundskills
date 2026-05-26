import { describe, it, expect } from 'vitest';
import { getQueriesForTier, SignalType } from '../scripts/_query_templates';

describe('query templates', () => {
  it('T1 returns 8 total queries (7 Serper + 1 PND slot)', () => {
    const queries = getQueriesForTier('T1', { company: 'Test Co', domain: 'testco.com' });
    expect(queries.serper).toHaveLength(7);
    expect(queries.pnd).toBe(true);
  });

  it('T2 returns 4 Serper + 1 PND', () => {
    const queries = getQueriesForTier('T2', { company: 'Test Co', domain: 'testco.com' });
    expect(queries.serper).toHaveLength(4);
    expect(queries.pnd).toBe(true);
  });

  it('T3 returns 3 Serper, no PND', () => {
    const queries = getQueriesForTier('T3', { company: 'Test Co', domain: 'testco.com' });
    expect(queries.serper).toHaveLength(3);
    expect(queries.pnd).toBe(false);
  });

  it('substitutes company name into template', () => {
    const queries = getQueriesForTier('T3', { company: 'Acme Inc', domain: 'acme.com' });
    expect(queries.serper.some(q => q.query.includes('Acme Inc'))).toBe(true);
  });

  it('every query has a signal_type', () => {
    const queries = getQueriesForTier('T1', { company: 'Test', domain: 'test.com' });
    for (const q of queries.serper) {
      expect(['funding', 'press', 'launch', 'snippet']).toContain(q.signal_type);
    }
  });
});
