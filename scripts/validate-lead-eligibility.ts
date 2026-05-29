import { promises as dns } from 'dns';
import { readPersonSidecar, PersonSidecar } from './_pnd_client';

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

/**
 * W1 — company in PND matches the expected domain.
 * Passes if no PND data (unknown = non-blocking).
 * Fails if PND reports a company clearly different from the lead's domain.
 */
export function checkW1_companyMatch(
  input: EligibilityInput,
  personSidecar?: PersonSidecar | null,
): CheckResult {
  if (!personSidecar?.current_company) {
    return { pass: true, reason: 'unknown (no PND data)' };
  }
  // Normalize: lowercase, strip non-alphanumeric
  const pndCompany = personSidecar.current_company.toLowerCase().replace(/[^a-z0-9]/g, '');
  const domainRoot = input.company_domain
    .toLowerCase()
    .replace(/\.(com|co|io|net|org|co\.uk)$/, '')
    .replace(/[^a-z0-9]/g, '');

  if (pndCompany.length > 3 && (domainRoot.includes(pndCompany) || pndCompany.includes(domainRoot))) {
    return { pass: true };
  }
  return {
    pass: false,
    reason: `PND company "${personSidecar.current_company}" does not match domain "${input.company_domain}"`,
  };
}

/**
 * W2 — person has an active current employment.
 * Passes if no PND data. Fails if PND data exists but current_company is empty.
 */
export function checkW2_activeEmployment(
  input: EligibilityInput,
  personSidecar?: PersonSidecar | null,
): CheckResult {
  if (!personSidecar) {
    return { pass: true, reason: 'unknown (no PND data)' };
  }
  if (personSidecar.current_company) {
    return { pass: true };
  }
  return { pass: false, reason: 'No active employment found in PND data' };
}

/**
 * W3 — PND title roughly matches expected title.
 * Fuzzy match: at least one significant word (>4 chars) shared.
 * Passes if no PND data or no title provided.
 */
export function checkW3_titleMatch(
  input: EligibilityInput,
  personSidecar?: PersonSidecar | null,
): CheckResult {
  if (!personSidecar?.current_title || !input.current_job_title) {
    return { pass: true, reason: 'unknown (no PND data or title)' };
  }
  const pndWords = new Set(
    personSidecar.current_title.toLowerCase().split(/\W+/).filter(w => w.length > 4),
  );
  const inputWords = input.current_job_title.toLowerCase().split(/\W+/).filter(w => w.length > 4);
  const matches = inputWords.some(w => pndWords.has(w));
  if (matches) return { pass: true };
  return {
    pass: false,
    reason: `PND title "${personSidecar.current_title}" doesn't match expected "${input.current_job_title}"`,
  };
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

export async function validateEligibility(
  input: EligibilityInput,
  sidecarDir = 'data/person-signals',
): Promise<EligibilityResult> {
  const personSidecar = readPersonSidecar(input.person_id, sidecarDir);

  const w1 = checkW1_companyMatch(input, personSidecar);
  const w2 = checkW2_activeEmployment(input, personSidecar);
  const w3 = checkW3_titleMatch(input, personSidecar);
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
