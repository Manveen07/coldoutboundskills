import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

export const DEFAULT_TTL_DAYS_HIT = 90;
export const DEFAULT_TTL_DAYS_MISS = 7;

export interface SignalSidecar {
  schema_version: string;
  domain: string;
  fetched_at: string;
  cache_status?: 'fresh' | 'stale' | 'fetched';
  ttl_days?: number;
  company_snippet?: any;
  funding?: any;
  press?: any[];
  product_launch?: any;
  fetch_log?: any[];
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
  writeFileSync(path, JSON.stringify(data, null, 2));
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

  const ageMs = Date.now() - new Date(data.fetched_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const ttl = ttlForSidecar(data);
  data.cache_status = ageDays <= ttl ? 'fresh' : 'stale';
  data.ttl_days = ttl;
  return data;
}
