import { describe, it, expect } from 'vitest';
import { selectSignal, selectSignalWithRotation } from '../scripts/_signal_selector';

describe('selectSignal', () => {
  it('picks new_role over funding when both fresh', () => {
    const sidecar = {
      funding: { fact: 'raised X', freshness_days: 30 },
      company_snippet: { fact: 'snippet' },
    };
    const person = {
      new_role: { fact: 'joined as VP', freshness_days: 10 },
    };
    const result = selectSignal(sidecar, person);
    expect(result.signal_used).toBe('new_role');
    expect(result.signal_fact).toBe('joined as VP');
  });

  it('picks funding when no new_role + no promotion + no acquisition', () => {
    const sidecar = {
      funding: { fact: 'raised X', freshness_days: 30 },
      company_snippet: { fact: 'snippet' },
    };
    const result = selectSignal(sidecar, null);
    expect(result.signal_used).toBe('funding');
  });

  it('picks acquisition over funding when both fresh (Amendment 9 priority)', () => {
    const sidecar = {
      acquisition: { fact: 'X acquired Y', freshness_days: 30 },
      funding: { fact: 'raised X', freshness_days: 30 },
      company_snippet: { fact: 'snippet' },
    };
    const result = selectSignal(sidecar, null);
    expect(result.signal_used).toBe('acquisition');
  });

  it('falls back to snippet when no in-window signals', () => {
    const sidecar = {
      funding: { fact: 'raised X', freshness_days: 200 },
      company_snippet: { fact: 'snippet' },
    };
    const result = selectSignal(sidecar, null);
    expect(result.signal_used).toBe('company_snippet');
  });

  it('returns "fallback" when sidecar has nothing useful', () => {
    const sidecar = { company_snippet: { fact: null } };
    const result = selectSignal(sidecar, null);
    expect(result.signal_used).toBe('fallback');
  });

  it('rejects stale signals (>90 days)', () => {
    const sidecar = {
      funding: { fact: 'old', freshness_days: 120 },
      press: [{ fact: 'recent press', freshness_days: 45 }],
      company_snippet: { fact: 'snippet' },
    };
    const result = selectSignal(sidecar, null);
    expect(result.signal_used).toBe('press');
  });
});

describe('selectSignalWithRotation (Amendment 3)', () => {
  it('picks different signal types for multiple leads at same company', () => {
    const companySidecar = {
      funding: { fact: 'raised $5M', freshness_days: 30 },
      acquisition: { fact: 'acquired Y', freshness_days: 20 },
      product_launch: { fact: 'launched Z', freshness_days: 10 },
      company_snippet: { fact: 'snippet' },
    };
    const used = new Set<string>();

    const lead1 = selectSignalWithRotation(companySidecar, null, used);
    const lead2 = selectSignalWithRotation(companySidecar, null, used);
    const lead3 = selectSignalWithRotation(companySidecar, null, used);

    const types = new Set([lead1.signal_used, lead2.signal_used, lead3.signal_used]);
    expect(types.size).toBe(3);
    // Order should follow priority: acquisition (top), funding, product_launch
    expect(lead1.signal_used).toBe('acquisition');
    expect(lead2.signal_used).toBe('funding');
    expect(lead3.signal_used).toBe('product_launch');
  });

  it('falls back to default selector when all types exhausted', () => {
    const sidecar = {
      funding: { fact: 'raised X', freshness_days: 30 },
      company_snippet: { fact: 'snippet' },
    };
    const used = new Set(['funding', 'company_snippet']);
    const result = selectSignalWithRotation(sidecar, null, used);
    // All in-window company-level signals exhausted → falls back to selectSignal which returns first available
    expect(result.signal_used).toBeDefined();
  });

  it('respects personSidecar priority over company signals', () => {
    const company = { funding: { fact: 'raised', freshness_days: 30 } };
    const person = { new_role: { fact: 'joined', freshness_days: 10 } };
    const used = new Set<string>();
    const result = selectSignalWithRotation(company, person, used);
    expect(result.signal_used).toBe('new_role');
  });
});
