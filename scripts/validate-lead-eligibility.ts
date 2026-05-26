import { promises as dns } from 'dns';

export interface EligibilityInput {
  person_id: string;
  company_domain: string;
  current_job_title?: string;
  linkedin_url?: string;
}

export interface CheckResult {
  pass: boolean;
  reason?: string;
}

export interface EligibilityResult {
  eligible: boolean;
  eligibility_warnings: string;
  details: Record<string, CheckResult>;
}

export async function checkW4_dnsResolves(domain: string): Promise<CheckResult> {
  try {
    const records = await dns.resolve(domain).catch(() => null);
    if (!records || records.length === 0) {
      return { pass: false, reason: 'DNS resolution failed' };
    }
    return { pass: true };
  } catch (err) {
    return { pass: false, reason: String(err) };
  }
}

// W1/W2/W3 stubs until PND integration (Task 19)
export function checkW1_companyMatch(input: EligibilityInput): CheckResult {
  // Pre-PND: return "unknown" — neither pass nor fail. Falls through to non-blocking.
  return { pass: true, reason: 'unknown (PND not integrated yet)' };
}

export function checkW2_activeEmployment(input: EligibilityInput): CheckResult {
  return { pass: true, reason: 'unknown (PND not integrated yet)' };
}

export function checkW3_titleMatch(input: EligibilityInput): CheckResult {
  return { pass: true, reason: 'unknown (PND not integrated yet)' };
}

export async function validateEligibility(input: EligibilityInput): Promise<EligibilityResult> {
  const w1 = checkW1_companyMatch(input);
  const w2 = checkW2_activeEmployment(input);
  const w3 = checkW3_titleMatch(input);
  const w4 = await checkW4_dnsResolves(input.company_domain);

  const failures: string[] = [];
  if (!w1.pass) failures.push('W1');
  if (!w2.pass) failures.push('W2');
  if (!w3.pass) failures.push('W3');
  if (!w4.pass) failures.push('W4');

  return {
    eligible: failures.length === 0,
    eligibility_warnings: failures.join(';'),
    details: { w1, w2, w3, w4 },
  };
}
