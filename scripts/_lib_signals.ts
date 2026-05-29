import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

export const DEFAULT_TTL_DAYS_HIT = 90;
export const DEFAULT_TTL_DAYS_MISS = 7;
// Sidecars written with queries_fired=0 are corrupt/incomplete -- always re-fetch
export const SCHEMA_VERSION = '1.1';

export interface SignalSidecar {
  schema_version: string;
  domain: string;
  fetched_at: string;
  cache_status?: 'fresh' | 'stale' | 'fetched';
  ttl_days?: number;
  queries_fired?: number;       // how many Serper calls were made -- 0 means corrupt sidecar
  company_snippet?: any;
  funding?: any;
  press?: any[];
  product_launch?: any;
  acquisition?: any;
  available_signals?: string[];
  fetch_log?: Array<{
    query_id: string;
    query: string;
    signal_type: string;
    fired_at: string;
    raw_response?: any;         // stored so we can re-extract without re-fetching
  }>;
  [k: string]: any;
}

function ttlForSidecar(s: SignalSidecar): number {
  const empty = isEmpty(s);
  return empty ? DEFAULT_TTL_DAYS_MISS : DEFAULT_TTL_DAYS_HIT;
}

function isEmpty(s: SignalSidecar): boolean {
  const noSnippet = !s.company_snippet?.fact;
  const noFunding = !s.funding?.fact;
  const noPress = !s.press?.length || !s.press[0]?.fact;
  const noLaunch = !s.product_launch?.fact;
  return noSnippet && noFunding && noPress && noLaunch;
}

export function writeSidecar(domain: string, data: SignalSidecar, baseDir = 'data/signals'): void {
  if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });
  const path = resolve(baseDir, `${domain}.json`);
  // Always stamp schema version and query count so corrupt sidecars are detectable
  data.schema_version = SCHEMA_VERSION;
  data.queries_fired = data.fetch_log?.length ?? 0;
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

export function readSidecar(domain: string, baseDir = 'data/signals'): SignalSidecar | null {
  const path = resolve(baseDir, `${domain}.json`);
  if (!existsSync(path)) return null;

  let data: SignalSidecar;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }

  // Corrupt sidecar: fetch_log has entries but queries_fired=0 means raw responses
  // were not stored (old bug). Force re-fetch so credits aren't wasted again.
  // Only applies to v1.1+ sidecars (v1.0 sidecars don't have queries_fired).
  const logCount = data.fetch_log?.length ?? 0;
  if (data.schema_version === SCHEMA_VERSION && data.queries_fired === 0 && logCount === 0) {
    // Genuinely empty -- no queries ever fired, treat normally (miss TTL)
  } else if (data.schema_version === SCHEMA_VERSION && data.queries_fired === 0 && logCount > 0) {
    // Queries fired but not counted -- corrupt, force re-fetch
    data.cache_status = 'stale';
    data.ttl_days = 0;
    return data;
  }

  const ageMs = Date.now() - new Date(data.fetched_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const ttl = ttlForSidecar(data);
  data.cache_status = ageDays <= ttl ? 'fresh' : 'stale';
  data.ttl_days = ttl;
  return data;
}
