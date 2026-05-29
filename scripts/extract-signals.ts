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
      const result = await serperSearch(q.query, serperKey, 'extract-signals.ts');
      firedQueries++;
      sidecar.fetch_log!.push({
        query_id: q.id,
        query: q.query,
        signal_type: q.signal_type,
        fired_at: result.timestamp,
        status: result.status,
        result_count: result.raw?.organic?.length ?? 0,
        raw_response: result.raw,  // stored for cache replay -- avoids re-fetching on extractor bugs
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

async function runCli() {
  const inputCsv = process.argv[2];
  const outputCsv = process.argv[3];
  const signalsDir = process.argv[4] || 'data/signals';
  if (!inputCsv || !outputCsv) {
    console.error('Usage: tsx scripts/extract-signals.ts <leads-all-with-qual.csv> <leads-with-signals.csv> [signals-dir]');
    process.exit(1);
  }

  const { readFileSync, writeFileSync } = await import('fs');
  const { parseCsv, writeCsv } = await import('./_csv_io');
  const text = readFileSync(inputCsv, 'utf8');
  const { headers, rows } = parseCsv(text);

  const qualified = rows.filter(r => r.qualified === 'true');
  console.error(`Processing ${qualified.length} qualified leads`);

  const serperKey = process.env.SERPER_API_KEY;
  if (!serperKey) {
    console.error('ERROR: SERPER_API_KEY not set in .env');
    process.exit(1);
  }

  const results: Record<string, string>[] = [];
  for (const lead of qualified) {
    try {
      const result = await extractSignalsForLead({
        person_id: lead.person_id,
        qual_confidence: parseFloat(lead.qual_confidence),
        title: lead.current_job_title,
        company_name: lead.company_name,
        company_domain: lead.company_domain,
      }, serperKey, signalsDir);

      results.push({
        ...lead,
        enrichment_tier: result.enrichment_tier,
        fired_queries: String(result.fired_queries),
        cache_hit: String(result.cache_hit),
        skipped_ineligible: String(result.skipped_ineligible),
      });
      console.error(`  ${lead.company_name}: tier=${result.enrichment_tier} fired=${result.fired_queries} hit=${result.cache_hit}`);
    } catch (err) {
      console.error(`  ${lead.company_name}: ERROR ${err}`);
      results.push({ ...lead, enrichment_tier: 'ERROR', fired_queries: '0', cache_hit: 'false', skipped_ineligible: 'false' });
    }
  }

  const outHeaders = [...headers, 'enrichment_tier', 'fired_queries', 'cache_hit', 'skipped_ineligible'];
  writeFileSync(outputCsv, writeCsv(results, outHeaders));
  console.error(`Wrote ${results.length} rows to ${outputCsv}`);
}

import { pathToFileURL } from 'url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(e => { console.error(e); process.exit(1); });
}
