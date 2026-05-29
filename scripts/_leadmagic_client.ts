// ---------------------------------------------------------------------------
// LeadMagic email-finder client
//
// API: https://api.leadmagic.io
// Auth: X-LEADMAGIC-API-KEY header
// Rate limit: 5 req/s (enforced via sleep between calls)
//
// Endpoints used:
//   POST /email-finder  — find by firstName + lastName + companyDomain
//   POST /profile-finder — find by linkedin_url (fallback when URL available)
// ---------------------------------------------------------------------------

import { logApiCall } from './_api_logger';

const LM_BASE = 'https://api.leadmagic.io';
const RATE_LIMIT_MS = 200; // 5 req/s

export type EmailConfidence = 'verified' | 'likely' | 'risky' | 'unknown';

export interface LeadMagicResult {
  email: string | null;
  confidence: EmailConfidence;
  source: 'email-finder' | 'profile-finder' | 'none';
  credits_used: number;
  raw?: any;
}

async function lmPost(path: string, body: Record<string, string>, apiKey: string): Promise<any> {
  const res = await fetch(`${LM_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-LEADMAGIC-API-KEY': apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LeadMagic ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

function parseConfidence(raw: any): EmailConfidence {
  const status = (raw?.email_status || raw?.status || '').toLowerCase();
  if (status === 'verified' || status === 'valid') return 'verified';
  if (status === 'likely' || status === 'accept_all') return 'likely';
  if (status === 'risky' || status === 'unknown') return 'risky';
  return 'unknown';
}

/**
 * Find email via name + domain. Falls back to profile-finder if linkedin_url provided.
 * Returns null email when LeadMagic finds nothing (not an error).
 */
export async function findEmail(
  opts: {
    first_name: string;
    last_name: string;
    company_domain: string;
    linkedin_url?: string;
  },
  apiKey: string,
): Promise<LeadMagicResult> {
  // Primary: email-finder by name + domain
  try {
    const raw = await lmPost(
      '/email-finder',
      {
        first_name: opts.first_name,
        last_name: opts.last_name,
        domain: opts.company_domain,
      },
      apiKey,
    );
    const email = raw?.email || raw?.work_email || null;
    if (email) {
      const credits = raw?.credits_used ?? 1;
      logApiCall({ provider: 'leadmagic', script: 'unknown', operation: 'email-finder', units: credits, unit_type: 'credits' });
      return {
        email,
        confidence: parseConfidence(raw),
        source: 'email-finder',
        credits_used: credits,
        raw,
      };
    }
  } catch (err) {
    // fall through to profile-finder if URL available
    if (!opts.linkedin_url) {
      return { email: null, confidence: 'unknown', source: 'none', credits_used: 0 };
    }
  }

  // Fallback: profile-finder by LinkedIn URL
  if (opts.linkedin_url) {
    try {
      const raw = await lmPost('/profile-finder', { url: opts.linkedin_url }, apiKey);
      const email = raw?.email || raw?.work_email || null;
      if (email) {
        const credits = raw?.credits_used ?? 1;
        logApiCall({ provider: 'leadmagic', script: 'unknown', operation: 'profile-finder', units: credits, unit_type: 'credits' });
        return {
          email,
          confidence: parseConfidence(raw),
          source: 'profile-finder',
          credits_used: credits,
          raw,
        };
      }
    } catch {
      // both paths failed
    }
  }

  return { email: null, confidence: 'unknown', source: 'none', credits_used: 0 };
}

export { RATE_LIMIT_MS };
