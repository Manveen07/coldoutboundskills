// ---------------------------------------------------------------------------
// PND client (Task 19)
//
// Fetches LinkedIn profile data from Professional Network Data (RapidAPI),
// extracts new_role / promotion signals, and writes a person-level sidecar.
//
// Endpoints used:
//   GET https://professional-network-data.p.rapidapi.com/?username=<handle>
//   GET https://professional-network-data.p.rapidapi.com/get-profile-data-by-url?url=<url>
//
// Auth: x-rapidapi-key header (PND_API_KEY from .env)
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { logApiCall } from './_api_logger';

const PND_HOST = 'professional-network-data.p.rapidapi.com';
const PND_BASE = `https://${PND_HOST}`;
const FRESHNESS_WINDOW_DAYS = 90;

export interface PersonSignal {
  fact: string;
  freshness_days: number;
}

export interface PersonSidecar {
  schema_version: '1.0';
  person_id: string;
  linkedin_url?: string;
  fetched_at: string;
  current_title?: string;
  current_company?: string;
  new_role?: PersonSignal | null;
  promotion?: PersonSignal | null;
}

interface PndPosition {
  title?: string;
  companyName?: string;
  companyUsername?: string;
  startDate?: { year?: number; month?: number };
  endDate?: { year?: number; month?: number } | null;
}

function positionStartMs(pos: PndPosition): number {
  const y = pos.startDate?.year;
  if (!y) return 0;
  const m = pos.startDate?.month ?? 1;
  return new Date(y, m - 1, 1).getTime();
}

function freshnessFromMs(startMs: number): number {
  return Math.floor((Date.now() - startMs) / (1000 * 60 * 60 * 24));
}

function extractUsername(linkedinUrl: string): string | null {
  const m = linkedinUrl.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? m[1] : null;
}

/**
 * Detect new_role and promotion signals from a sorted position list.
 *
 * new_role:  current position started within freshness window, different company from prev.
 * promotion: current position started within freshness window, same company as prev, different title.
 *
 * Mutual exclusion: promotion wins over new_role when same company.
 */
export function detectSignals(
  positions: PndPosition[],
  firstName: string,
): { new_role: PersonSignal | null; promotion: PersonSignal | null } {
  if (!positions.length) return { new_role: null, promotion: null };

  // Sort descending by startDate (most recent first)
  const sorted = [...positions].sort((a, b) => positionStartMs(b) - positionStartMs(a));
  const current = sorted[0];
  const currentStartMs = positionStartMs(current);

  if (!currentStartMs) return { new_role: null, promotion: null };

  const freshness = freshnessFromMs(currentStartMs);
  if (freshness > FRESHNESS_WINDOW_DAYS) return { new_role: null, promotion: null };

  // Current position must not have an endDate (still active)
  if (current.endDate) return { new_role: null, promotion: null };

  const companyLabel = current.companyName || 'a new company';
  const titleLabel = current.title || 'a new role';
  const firstName_ = firstName || 'They';

  if (sorted.length >= 2) {
    const prev = sorted[1];
    const sameCompany =
      current.companyName &&
      prev.companyName &&
      current.companyName.toLowerCase().trim() === prev.companyName.toLowerCase().trim();

    if (sameCompany && current.title !== prev.title) {
      return {
        new_role: null,
        promotion: {
          fact: `${firstName_} was promoted to ${titleLabel} at ${companyLabel}.`,
          freshness_days: freshness,
        },
      };
    }
  }

  return {
    new_role: {
      fact: `${firstName_} recently joined ${companyLabel} as ${titleLabel}.`,
      freshness_days: freshness,
    },
    promotion: null,
  };
}

async function pndGet(path: string, apiKey: string): Promise<any> {
  const res = await fetch(`${PND_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'x-rapidapi-host': PND_HOST,
      'x-rapidapi-key': apiKey,
    },
  });
  if (!res.ok) {
    throw new Error(`PND request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function fetchPersonSidecar(
  person_id: string,
  first_name: string,
  linkedin_url: string,
  apiKey: string,
  sidecarDir = 'data/person-signals',
): Promise<PersonSidecar> {
  const username = extractUsername(linkedin_url);

  let raw: any;
  if (username) {
    raw = await pndGet(`/?username=${encodeURIComponent(username)}`, apiKey);
  } else {
    raw = await pndGet(`/get-profile-data-by-url?url=${encodeURIComponent(linkedin_url)}`, apiKey);
  }
  logApiCall({ provider: 'rapidapi-pnd', script: 'fetch-pnd-signals.ts', operation: 'fetchPersonSidecar', units: 1, unit_type: 'calls' });

  // PND wraps payload in `data` on some endpoints
  const profile = raw?.data ?? raw;
  const positions: PndPosition[] = profile?.position ?? profile?.positions ?? [];
  const currentTitle: string = positions[0]?.title ?? profile?.headline ?? '';
  const currentCompany: string = positions[0]?.companyName ?? profile?.company ?? '';

  const { new_role, promotion } = detectSignals(positions, first_name);

  const sidecar: PersonSidecar = {
    schema_version: '1.0',
    person_id,
    linkedin_url,
    fetched_at: new Date().toISOString(),
    current_title: currentTitle,
    current_company: currentCompany,
    new_role,
    promotion,
  };

  if (!existsSync(sidecarDir)) mkdirSync(sidecarDir, { recursive: true });
  writeFileSync(resolve(sidecarDir, `${person_id}.json`), JSON.stringify(sidecar, null, 2));

  return sidecar;
}

export function readPersonSidecar(
  person_id: string,
  sidecarDir = 'data/person-signals',
): PersonSidecar | null {
  const path = resolve(sidecarDir, `${person_id}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}
