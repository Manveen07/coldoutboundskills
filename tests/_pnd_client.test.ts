import { describe, it, expect } from 'vitest';
import { detectSignals, PersonSidecar } from '../scripts/_pnd_client';
import { checkW1_companyMatch, checkW2_activeEmployment, checkW3_titleMatch } from '../scripts/validate-lead-eligibility';

const NOW = Date.now();
const DAYS = (n: number) => NOW - n * 24 * 60 * 60 * 1000;

function dateFor(ms: number) {
  const d = new Date(ms);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

describe('detectSignals', () => {
  it('returns null/null for empty positions', () => {
    const { new_role, promotion } = detectSignals([], 'Jane');
    expect(new_role).toBeNull();
    expect(promotion).toBeNull();
  });

  it('detects new_role when current position started within 90 days at different company', () => {
    const positions = [
      {
        title: 'VP Marketing',
        companyName: 'Acme Corp',
        startDate: dateFor(DAYS(30)),
        endDate: null,
      },
      {
        title: 'Director Marketing',
        companyName: 'Other Co',
        startDate: dateFor(DAYS(400)),
        endDate: dateFor(DAYS(31)),
      },
    ];
    const { new_role, promotion } = detectSignals(positions, 'Jane');
    expect(new_role).not.toBeNull();
    expect(new_role!.freshness_days).toBeLessThanOrEqual(90);
    expect(new_role!.fact).toContain('Acme Corp');
    expect(new_role!.fact).toContain('VP Marketing');
    expect(promotion).toBeNull();
  });

  it('detects promotion when same company, different title, within 90 days', () => {
    const positions = [
      {
        title: 'VP Marketing',
        companyName: 'Acme Corp',
        startDate: dateFor(DAYS(20)),
        endDate: null,
      },
      {
        title: 'Director Marketing',
        companyName: 'Acme Corp',
        startDate: dateFor(DAYS(500)),
        endDate: dateFor(DAYS(21)),
      },
    ];
    const { new_role, promotion } = detectSignals(positions, 'Jane');
    expect(promotion).not.toBeNull();
    expect(promotion!.fact).toContain('promoted');
    expect(promotion!.fact).toContain('Acme Corp');
    expect(new_role).toBeNull();
  });

  it('returns null/null when current position older than 90 days', () => {
    const positions = [
      {
        title: 'VP Marketing',
        companyName: 'Acme Corp',
        startDate: dateFor(DAYS(120)),
        endDate: null,
      },
    ];
    const { new_role, promotion } = detectSignals(positions, 'Jane');
    expect(new_role).toBeNull();
    expect(promotion).toBeNull();
  });

  it('returns null/null when current position has an endDate (not active)', () => {
    const positions = [
      {
        title: 'VP Marketing',
        companyName: 'Acme Corp',
        startDate: dateFor(DAYS(10)),
        endDate: dateFor(DAYS(5)),
      },
    ];
    const { new_role, promotion } = detectSignals(positions, 'Jane');
    expect(new_role).toBeNull();
    expect(promotion).toBeNull();
  });

  it('uses firstName in fact string', () => {
    const positions = [
      {
        title: 'CMO',
        companyName: 'Brand Co',
        startDate: dateFor(DAYS(15)),
        endDate: null,
      },
    ];
    const { new_role } = detectSignals(positions, 'Alice');
    expect(new_role!.fact).toContain('Alice');
  });

  it('returns null/null when startDate has no year', () => {
    const positions = [{ title: 'VP', companyName: 'Corp', startDate: {}, endDate: null }];
    const { new_role, promotion } = detectSignals(positions, 'Bob');
    expect(new_role).toBeNull();
    expect(promotion).toBeNull();
  });
});

describe('validate-lead-eligibility W1/W2/W3', () => {
  const base = { person_id: 'p1', company_domain: 'acmecorp.com', current_job_title: 'VP Marketing' };

  it('W1 passes when no PND data', () => {
    expect(checkW1_companyMatch(base, null).pass).toBe(true);
  });

  it('W1 passes when company name matches domain root', () => {
    const sidecar = { current_company: 'Acme Corp' } as PersonSidecar;
    expect(checkW1_companyMatch(base, sidecar).pass).toBe(true);
  });

  it('W1 fails when company clearly different', () => {
    const sidecar = { current_company: 'Google LLC' } as PersonSidecar;
    expect(checkW1_companyMatch(base, sidecar).pass).toBe(false);
  });

  it('W2 passes when no PND data', () => {
    expect(checkW2_activeEmployment(base, null).pass).toBe(true);
  });

  it('W2 passes when current_company present', () => {
    const sidecar = { current_company: 'Acme Corp' } as PersonSidecar;
    expect(checkW2_activeEmployment(base, sidecar).pass).toBe(true);
  });

  it('W2 fails when PND data exists but no current_company', () => {
    const sidecar = { current_company: '' } as PersonSidecar;
    expect(checkW2_activeEmployment(base, sidecar).pass).toBe(false);
  });

  it('W3 passes when no PND data', () => {
    expect(checkW3_titleMatch(base, null).pass).toBe(true);
  });

  it('W3 passes when titles share a significant word', () => {
    const sidecar = { current_title: 'Vice President of Marketing' } as PersonSidecar;
    expect(checkW3_titleMatch(base, sidecar).pass).toBe(true);
  });

  it('W3 fails when titles share no significant words', () => {
    const sidecar = { current_title: 'Chief Technology Officer' } as PersonSidecar;
    expect(checkW3_titleMatch({ ...base, current_job_title: 'VP Sales' }, sidecar).pass).toBe(false);
  });
});
