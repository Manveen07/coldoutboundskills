import { resolve } from 'path';
import { readSidecar, writeSidecar, type SignalSidecar } from './_lib_signals';
import { computeTier } from './_lib_tier';
import { getQueriesForTier, type SignalType } from './_query_templates';
import { serperSearch } from './_serper_client';
import {
  extractFundingFact,
  extractPressFact,
  extractLaunchFact,
  extractSnippetFact,
  extractAcquisitionFact,
} from './_fact_extractor';

const SIGNAL_PRIORITY: SignalType[] = ['funding', 'press', 'launch', 'snippet'];
// Note: new_role, promotion need PND (Task 19). acquisition is a Serper press-shape result.

export interface LeadRow {
  person_id: string;
  qual_confidence: number;
  title: string;
  company_name: string;
  company_domain: string;
  eligible?: boolean; // Amendment 1 — if false, skip
}

export interface ExtractionResult {
  enrichment_tier: 'T1' | 'T2' | 'T3';
  sidecar_path: string;
  fired_queries: number;
  cache_hit: boolean;
  skipped_ineligible: boolean;
}

export async function extractSignalsForLead(
  lead: LeadRow,
  serperKey: string,
  baseDir = 'data/signals'
): Promise<ExtractionResult> {
  const tier = computeTier({ qual_confidence: lead.qual_confidence, title: lead.title });
  const domain = lead.company_domain;
  const sidecarPath = resolve(baseDir, `${domain}.json`);

  // Amendment 1 — eligibility gate
  if (lead.eligible === false) {
    return {
      enrichment_tier: tier,
      sidecar_path: sidecarPath,
      fired_queries: 0,
      cache_hit: false,
      skipped_ineligible: true,
    };
  }

  // Cache hit path
  const existing = readSidecar(domain, baseDir);
  if (existing && existing.cache_status === 'fresh') {
    return {
      enrichment_tier: tier,
      sidecar_path: sidecarPath,
      fired_queries: 0,
      cache_hit: true,
      skipped_ineligible: false,
    };
  }

  // Cache miss / stale — fetch
  const queries = getQueriesForTier(tier, { company: lead.company_name, domain });
  const sidecar: SignalSidecar = {
    schema_version: '1.0',
    domain,
    fetched_at: new Date().toISOString(),
    company_snippet: { fact: null, source_query: null, raw_serper_response: null },
    funding: { fact: null, found: false },
    press: [],
    product_launch: { fact: null, found: false },
    acquisition: { fact: null, found: false },
    available_signals: [], // Amendment 2
    fetch_log: [],
  };

  let firedQueries = 0;
  for (const q of queries.serper) {
    try {
      const result = await serperSearch(q.query, serperKey);
      firedQueries++;
      sidecar.fetch_log!.push({
        query: q.query,
        signal_type: q.signal_type,
        timestamp: result.timestamp,
        status: result.status,
        result_count: result.raw?.organic?.length ?? 0,
      });

      if (q.signal_type === 'funding') {
        const fact = extractFundingFact(result.raw, lead.company_name);
        if (fact && !sidecar.funding!.fact) {
          sidecar.funding = {
            ...fact,
            found: true,
            source_query: q.query,
            raw_serper_response: result.raw,
          };
        }
      } else if (q.signal_type === 'press') {
        // Also try acquisition extractor on press queries (Amendment 9 - split)
        const acqFact = extractAcquisitionFact(result.raw, lead.company_name);
        if (acqFact && !sidecar.acquisition!.fact) {
          sidecar.acquisition = {
            ...acqFact,
            found: true,
            source_query: q.query,
            raw_serper_response: result.raw,
          };
        }
        const fact = extractPressFact(result.raw, lead.company_name);
        if (fact) {
          sidecar.press!.push({ ...fact, source_query: q.query, raw_serper_response: result.raw });
        }
      } else if (q.signal_type === 'launch') {
        const fact = extractLaunchFact(result.raw, lead.company_name);
        if (fact && !sidecar.product_launch!.fact) {
          sidecar.product_launch = {
            ...fact,
            found: true,
            source_query: q.query,
            raw_serper_response: result.raw,
          };
        }
      } else if (q.signal_type === 'snippet') {
        const fact = extractSnippetFact(result.raw, lead.company_name);
        if (fact && !sidecar.company_snippet!.fact) {
          sidecar.company_snippet = {
            ...fact,
            source_query: q.query,
            raw_serper_response: result.raw,
          };
        }
      }
    } catch (err) {
      sidecar.fetch_log!.push({
        query: q.query,
        signal_type: q.signal_type,
        timestamp: new Date().toISOString(),
        status: 'ERROR',
        error: String(err),
      });
    }
  }

  // Amendment 2 — build available_signals[] ranked list
  const FRESHNESS_WINDOW = 90;
  const inWindow = (f: any) => !!f?.fact && (f.freshness_days ?? 999) <= FRESHNESS_WINDOW;
  const available: Array<{
    type: string;
    fact: string;
    freshness_days: number | null;
    in_window: boolean;
    rank: number;
  }> = [];

  // Priority: acquisition > funding > product_launch > press > company_snippet
  const candidates: Array<[string, any]> = [
    ['acquisition', sidecar.acquisition],
    ['funding', sidecar.funding],
    ['product_launch', sidecar.product_launch],
  ];
  for (const [type, fact] of candidates) {
    if (fact?.fact) {
      available.push({
        type,
        fact: fact.fact,
        freshness_days: fact.freshness_days ?? null,
        in_window: inWindow(fact),
        rank: available.length + 1,
      });
    }
  }
  for (const p of sidecar.press ?? []) {
    if (p?.fact) {
      available.push({
        type: 'press',
        fact: p.fact,
        freshness_days: p.freshness_days ?? null,
        in_window: inWindow(p),
        rank: available.length + 1,
      });
    }
  }
  if (sidecar.company_snippet?.fact) {
    available.push({
      type: 'company_snippet',
      fact: sidecar.company_snippet.fact,
      freshness_days: null,
      in_window: true, // no time decay
      rank: available.length + 1,
    });
  }
  sidecar.available_signals = available;

  writeSidecar(domain, sidecar, baseDir);

  return {
    enrichment_tier: tier,
    sidecar_path: sidecarPath,
    fired_queries: firedQueries,
    cache_hit: false,
    skipped_ineligible: false,
  };
}
