import { describe, it, expect } from 'vitest';
import { checkW4_dnsResolves, validateEligibility } from '../scripts/validate-lead-eligibility';

describe('Check W4 — DNS resolution', () => {
  it('returns pass for live domain', async () => {
    const result = await checkW4_dnsResolves('google.com');
    expect(result.pass).toBe(true);
  });

  it('returns fail for non-existent domain', async () => {
    const result = await checkW4_dnsResolves('thisdomainshouldnotexist-xyz-12345.com');
    expect(result.pass).toBe(false);
  });
});

describe('validateEligibility', () => {
  it('returns eligible=true with no warnings when all checks pass', async () => {
    const result = await validateEligibility({
      person_id: 'pid_1',
      company_domain: 'google.com',
      current_job_title: 'VP Marketing',
    });
    expect(result.eligible).toBe(true);
    expect(result.eligibility_warnings).toBe('');
  });

  it('returns eligible=false when W4 fails (DNS)', async () => {
    const result = await validateEligibility({
      person_id: 'pid_2',
      company_domain: 'thisdomainshouldnotexist-xyz-12345.com',
      current_job_title: 'VP Marketing',
    });
    expect(result.eligible).toBe(false);
    expect(result.eligibility_warnings).toContain('W4');
  });
});
