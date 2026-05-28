import { resolve } from 'path';
import type { ClientConfig } from '../_client_config';
import { prospeoSearchPage, extractEmail, type ProspeoFilters } from '../_prospeo_client';
import { fetchWithCache, hashKey } from './_cache';

export interface Lead {
  person_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  current_job_title: string;
  email: string;
  email_status: string;
  person_linkedin_url: string;
  person_city: string;
  person_state: string;
  person_country: string;
  company_name: string;
  company_domain: string;
  company_industry: string;
  company_headcount: string;
  company_headcount_range: string;
  company_linkedin_url: string;
  company_city: string;
  company_state: string;
  company_country: string;
}

export function buildProspeoFilters(cfg: ClientConfig, category?: string): ProspeoFilters {
  const f = cfg.icp_hard_filters;
  const verticalIndustries = (cfg as any).vertical_industries as Record<string, string[]> | undefined;
  const industries = category && verticalIndustries?.[category]
    ? verticalIndustries[category]
    : f.industries_in;

  return {
    person_job_title: { include: f.job_titles, match_only_exact_job_titles: false },
    person_location_search: { include: (f.countries ?? ['US']).map(c => `United States #${c}`) },
    company_headcount_custom: { min: f.headcount_min, max: f.headcount_max },
    company_industry: { include: industries },
    person_contact_details: { email: ['VERIFIED'] },
  };
}

export function leadFromProspeoResult(result: any): Lead {
  const p = result.person ?? {};
  const c = result.company ?? {};
  const loc = p.location ?? {};
  const em = extractEmail(p.email);
  return {
    person_id: p.person_id ?? '',
    first_name: p.first_name ?? '',
    last_name: p.last_name ?? '',
    full_name: p.full_name ?? '',
    current_job_title: p.current_job_title ?? '',
    email: em.value,
    email_status: em.status || (p.email_status ?? ''),
    person_linkedin_url: p.linkedin_url ?? '',
    person_city: loc.city ?? '',
    person_state: loc.state ?? '',
    person_country: loc.country ?? '',
    company_name: c.name ?? '',
    company_domain: c.domain ?? '',
    company_industry: c.industry ?? '',
    company_headcount: c.headcount ?? '',
    company_headcount_range: c.headcount_range ?? '',
    company_linkedin_url: c.linkedin_url ?? '',
    company_city: (c.location ?? {}).city ?? '',
    company_state: (c.location ?? {}).state ?? '',
    company_country: (c.location ?? {}).country ?? '',
  };
}

export interface PullOptions {
  apiKey: string;
  cfg: ClientConfig;
  category?: string;
  maxPages: number;
  startPage?: number;
  cacheDir?: string;
  ttlDays?: number;
  callerScript?: string;
}

export interface PullResult {
  leads: Lead[];
  pagesFetched: number;
  pagesFromCache: number;
  totalPool: number;
}

export async function pullLeads(opts: PullOptions): Promise<PullResult> {
  const filters = buildProspeoFilters(opts.cfg, opts.category);
  const filterHash = hashKey(JSON.stringify(filters));
  const cacheDir = opts.cacheDir ?? resolve(process.cwd(), 'data/research-cache/prospeo');
  const ttl = opts.ttlDays ?? 30;
  const startPage = opts.startPage ?? 1;
  const callerScript = opts.callerScript ?? 'pipeline/_pull.ts';

  const leads: Lead[] = [];
  const seen = new Set<string>();
  let pagesFetched = 0;
  let pagesFromCache = 0;
  let totalPool = 0;

  for (let page = startPage; page < startPage + opts.maxPages; page++) {
    const cacheKey = `${filterHash}-page-${page}`;
    const result = await fetchWithCache(cacheDir, cacheKey, ttl, async () => {
      return await prospeoSearchPage(filters, page, opts.apiKey, callerScript);
    });

    if (result.fromCache) pagesFromCache++;
    else pagesFetched++;

    const data = result.raw;
    if (page === startPage) totalPool = data?.pagination?.total_count ?? 0;
    const results = data?.results ?? [];
    if (results.length === 0) break;

    for (const r of results) {
      const lead = leadFromProspeoResult(r);
      if (!lead.person_id || seen.has(lead.person_id)) continue;
      seen.add(lead.person_id);
      leads.push(lead);
    }

    if (results.length < 25) break;
    if (!result.fromCache) await new Promise(r => setTimeout(r, 1500));
  }

  return { leads, pagesFetched, pagesFromCache, totalPool };
}
