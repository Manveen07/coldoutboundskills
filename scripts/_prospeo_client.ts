// ---------------------------------------------------------------------------
// Prospeo API client — shared wrapper with usage logging
//
// Endpoint: POST https://api.prospeo.io/search-person
// Auth: X-KEY header
// 1 credit = 1 page (25 results)
// ---------------------------------------------------------------------------

import { logApiCall } from './_api_logger';

export interface ProspeoFilters {
  person_job_title?: { include?: string[]; exclude?: string[]; match_only_exact_job_titles?: boolean };
  person_location_search?: { include?: string[]; exclude?: string[] };
  company_headcount_custom?: { min?: number; max?: number };
  company_industry?: { include?: string[]; exclude?: string[] };
  company_technology?: { include?: string[]; exclude?: string[] };
  company_revenue_custom?: { min?: number; max?: number };
  company_founding_year?: { min?: number; max?: number };
  company_name?: { include?: string[]; exclude?: string[] };
  company_domain?: { include?: string[]; exclude?: string[] };
  person_contact_details?: { email?: string[]; mobile?: string[]; operator?: string };
  company_funding?: {
    funding_date?: 90 | 180 | 270 | 365 | null;
    last_funding?: { min?: string; max?: string } | null;
    total_funding?: { min?: string; max?: string };
    stage?: string[];
  };
  person_duplicate_control?: {
    hide_people_from_all_my_lists?: boolean;
    hide_people_already_exported_before?: boolean;
  };
}

export function extractEmail(emailField: any): { value: string; status: string } {
  if (emailField == null) return { value: '', status: '' };
  if (typeof emailField === 'string') return { value: emailField, status: '' };
  if (Array.isArray(emailField) && emailField.length > 0) return extractEmail(emailField[0]);
  if (typeof emailField === 'object') {
    const revealed = emailField.revealed;
    const raw = emailField.value ?? emailField.email ?? emailField.address ?? '';
    if (revealed === false || (typeof raw === 'string' && raw.includes('*'))) {
      return { value: '', status: emailField.status ?? emailField.email_status ?? '' };
    }
    return {
      value: raw,
      status: emailField.status ?? emailField.email_status ?? emailField.verified ?? '',
    };
  }
  return { value: '', status: '' };
}

const PROSPEO_BASE = 'https://api.prospeo.io';

export async function prospeoSearchPage(
  filters: ProspeoFilters,
  page: number,
  apiKey: string,
  callerScript = 'unknown',
  attempt = 0,
): Promise<any> {
  const res = await fetch(`${PROSPEO_BASE}/search-person`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-KEY': apiKey,
    },
    body: JSON.stringify({ page, filters }),
  });

  if (res.status === 429 && attempt < 5) {
    const backoff = Math.min(2000 * Math.pow(2, attempt), 60000);
    await new Promise(r => setTimeout(r, backoff));
    return prospeoSearchPage(filters, page, apiKey, callerScript, attempt + 1);
  }

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 400 && /rate limit/i.test(text) && attempt < 5) {
      const backoff = Math.min(15000 * Math.pow(2, attempt), 120000);
      await new Promise(r => setTimeout(r, backoff));
      return prospeoSearchPage(filters, page, apiKey, callerScript, attempt + 1);
    }
    throw new Error(`Prospeo API ${res.status}: ${text}`);
  }

  const data = await res.json();
  logApiCall({ provider: 'prospeo', script: callerScript, operation: 'search-person', units: 1, unit_type: 'credits' });
  return data;
}
