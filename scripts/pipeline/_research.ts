import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import type { ScoredLead } from './_score';
import { serperSearch } from '../_serper_client';
import { fetchWithCache, hashKey } from './_cache';
import { scrapeCompany, type ScrapeResult } from './_scrape';
import { webResearch, gapsToSerperQueryTypes, type WebResearchDossier } from './_web_research';
import type { SubagentDispatcher } from './_subagent_runner';
import {
  extractFundingFact,
  extractPressFact,
  extractAcquisitionFact,
  extractSnippetFact,
} from '../_fact_extractor';
import { getMythicQueriesForTier } from '../_query_templates';

export type Tier = 'T1' | 'T2' | 'T3';

export interface ResearchDossier {
  tier: Tier;
  person: {
    person_id: string;
    full_name: string;
    title: string;
    seniority: string;
    linkedin_url: string;
  };
  company: {
    name: string;
    domain: string;
    industry: string;
    headcount_range: string;
    location: string;
  };
  signals: {
    funding_fact: string | null;
    press_facts: string[];
    acquisition_fact: string | null;
    category_snippet: string | null;
  };
  scrape: ScrapeResult | null;
  person_depth: {
    person_quote: string | null;
    recent_post_topic: string | null;
    public_speaking_topics: string[];
    career_pivot_signal: string | null;
  };
}

export function decideTier(
  lead: ScoredLead,
  priorityDomains: string[],
  thresholds: { t2: number; t3: number },
): Tier {
  const d = (lead.company_domain ?? '').toLowerCase().replace(/^www\./, '');
  if (priorityDomains.map(x => x.toLowerCase()).includes(d)) return 'T3';
  const conf = parseFloat(lead.icp_confidence ?? '0');
  if (conf >= thresholds.t3) return 'T3';
  if (conf >= thresholds.t2) return 'T2';
  return 'T1';
}

export function buildPersonQueries(fullName: string, companyName: string): string[] {
  return [
    `"${fullName}" "${companyName}" -inurl:linkedin`,
    `"${fullName}" "${companyName}" interview podcast -inurl:linkedin`,
    `"${fullName}" "${companyName}" conference speaker -inurl:linkedin`,
  ];
}

function unwrapFact(f: any): string {
  if (!f) return '';
  if (typeof f === 'string') return f;
  if (typeof f === 'object' && typeof f.fact === 'string') return f.fact;
  if (typeof f === 'object' && typeof f.fact === 'object') return f.fact?.fact ?? '';
  return String(f);
}

function inferSeniority(title: string): string {
  const t = title.toLowerCase();
  if (/chief|cmo|cfo|ceo|coo|president/.test(t)) return 'C-suite';
  if (/\bsvp\b|senior vice/.test(t)) return 'SVP';
  if (/\bvp\b|vice president/.test(t)) return 'VP';
  if (/senior director|sr\.? director/.test(t)) return 'Senior Director';
  if (/director/.test(t)) return 'Director';
  if (/head of/.test(t)) return 'Head';
  return 'Manager';
}

export interface ResearchOptions {
  lead: ScoredLead;
  serperKey: string;
  priorityDomains: string[];
  thresholds: { t2: number; t3: number };
  serperCacheDir?: string;
  callerScript?: string;
  dispatch?: SubagentDispatcher;  // if provided, free web research runs first
}

export async function researchLead(opts: ResearchOptions): Promise<ResearchDossier> {
  const lead = opts.lead;
  const tier = decideTier(lead, opts.priorityDomains, opts.thresholds);
  const domain = (lead.company_domain ?? '').toLowerCase().replace(/^www\./, '');
  const serperCacheDir = opts.serperCacheDir ?? resolve(process.cwd(), 'data/research-cache/serper');
  const caller = opts.callerScript ?? 'pipeline/_research.ts';

  // --- Step 1 (free): web research via sub-agent if dispatcher provided ---
  let webDossier: WebResearchDossier | null = null;
  if (opts.dispatch) {
    try {
      webDossier = await webResearch({ lead, dispatch: opts.dispatch });
    } catch (err: any) {
      console.warn(`[research] web research failed for ${domain}: ${err?.message ?? err}`);
    }
  }

  const signals = {
    funding_fact: webDossier?.funding_fact ?? null,
    press_facts: webDossier?.press_facts ?? [],
    acquisition_fact: null as string | null,
    category_snippet: webDossier?.category_observation ?? null,
  };

  // --- Step 2 (Serper): only fire queries for gaps ---
  // Map research tier to query depth: T3=T1 queries (most), T2=T2, T1=T3 (least)
  const queryTier = tier === 'T3' ? 'T1' : tier === 'T2' ? 'T2' : 'T3';
  const queries = getMythicQueriesForTier(queryTier, { company: lead.company_name, domain });
  const gapTypes = webDossier ? gapsToSerperQueryTypes(webDossier.gaps) : new Set(['funding', 'press', 'snippet']);

  for (const q of queries.serper) {
    // Skip Serper queries for signal types already filled by web research
    if (webDossier && !gapTypes.has(q.signal_type as string)) continue;
    const cacheKey = hashKey(domain, q.query);
    try {
      const cached = await fetchWithCache(serperCacheDir, cacheKey, 90, async () => {
        const res = await serperSearch(q.query, opts.serperKey, caller);
        return res.raw;
      });
      const raw = cached.raw;
      if (q.signal_type === 'funding' && !signals.funding_fact) {
        const f = extractFundingFact(raw, lead.company_name);
        if (f) signals.funding_fact = unwrapFact(f);
      } else if (q.signal_type === 'press') {
        const p = extractPressFact(raw, lead.company_name);
        if (p) signals.press_facts.push(unwrapFact(p));
        const a = extractAcquisitionFact(raw, lead.company_name);
        if (a && !signals.acquisition_fact) signals.acquisition_fact = unwrapFact(a);
      } else if (q.signal_type === 'snippet' && !signals.category_snippet) {
        const s = extractSnippetFact(raw, lead.company_name);
        if (s) signals.category_snippet = unwrapFact(s);
      }
    } catch (err: any) {
      console.warn(`[research] query failed for ${domain}: ${err?.message ?? err}`);
    }
  }

  // T2: company scrape (free, always run on qualified leads)
  let scrape: ScrapeResult | null = null;
  try {
    scrape = await scrapeCompany(domain);
  } catch {
    scrape = null;
  }

  // T3: person depth
  const personDepth = {
    person_quote: null as string | null,
    recent_post_topic: null as string | null,
    public_speaking_topics: [] as string[],
    career_pivot_signal: null as string | null,
  };

  if (tier === 'T3') {
    const personQueries = buildPersonQueries(lead.full_name, lead.company_name);
    for (const pq of personQueries) {
      const cacheKey = hashKey('person', lead.person_id, pq);
      try {
        const cached = await fetchWithCache(serperCacheDir, cacheKey, 90, async () => {
          const res = await serperSearch(pq, opts.serperKey, caller);
          return res.raw;
        });
        const organic = cached.raw?.organic ?? [];
        for (const item of organic.slice(0, 3)) {
          const text = (item.snippet ?? item.title ?? '').trim();
          if (!text) continue;
          if (/podcast|interview/i.test(text) && !personDepth.person_quote) {
            personDepth.person_quote = text;
          }
          if (/conference|speaker|spoke at|keynote/i.test(text)) {
            personDepth.public_speaking_topics.push(text);
          }
          if (/joined|appointed|named|hired/i.test(text) && !personDepth.career_pivot_signal) {
            personDepth.career_pivot_signal = text;
          }
        }
      } catch (err: any) {
        console.warn(`[research] person query failed for ${lead.person_id}: ${err?.message ?? err}`);
      }
    }
  }

  return {
    tier,
    person: {
      person_id: lead.person_id,
      full_name: lead.full_name,
      title: lead.current_job_title,
      seniority: inferSeniority(lead.current_job_title),
      linkedin_url: lead.person_linkedin_url,
    },
    company: {
      name: lead.company_name,
      domain,
      industry: lead.company_industry,
      headcount_range: lead.company_headcount_range,
      location: [lead.company_city, lead.company_state, lead.company_country].filter(Boolean).join(', '),
    },
    signals,
    scrape,
    person_depth: personDepth,
  };
}

export function writeDossier(dossier: ResearchDossier, dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `${dossier.company.domain}.json`), JSON.stringify(dossier, null, 2), 'utf8');
}

export function readDossier(domain: string, dir: string): ResearchDossier | null {
  const p = resolve(dir, `${domain.toLowerCase().replace(/^www\./, '')}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}
