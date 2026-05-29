#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// mythic-extract-signals.ts -- Signal extraction for Mythic Growth Codes
//
// Same structure as extract-signals.ts but uses Mythic-specific Serper queries:
// brand campaigns, franchise expansion, new marketing leadership, media spend.
// These surface signals directly relevant to the Growth Codes audit pitch.
//
// Usage:
//   npx tsx scripts/mythic-extract-signals.ts \
//     profiles/mythic/campaigns/growth-codes/data/leads-scored-qsr.csv \
//     profiles/mythic/campaigns/growth-codes/data/leads-with-signals-qsr.csv \
//     profiles/mythic/campaigns/growth-codes/data/signals-qsr
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { parseCsv, writeCsvWithExtra } from './_csv_io';
import { readSidecar, writeSidecar, type SignalSidecar } from './_lib_signals';
import { computeTier } from './_lib_tier';
import { getMythicQueriesForTier } from './_query_templates';
import { serperSearch } from './_serper_client';
import {
  extractFundingFact,
  extractPressFact,
  extractSnippetFact,
  extractAcquisitionFact,
} from './_fact_extractor';

function loadEnv(): Record<string, string> {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    const out: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const [k, ...v] = t.split('=');
      out[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
    }
    return out;
  } catch { return {}; }
}

const [,, inputArg, outputArg, signalsDirArg] = process.argv;
if (!inputArg || !outputArg || !signalsDirArg) {
  console.error('Usage: npx tsx scripts/mythic-extract-signals.ts <input.csv> <output.csv> <signals-dir>');
  process.exit(1);
}

const inputPath  = resolve(process.cwd(), inputArg);
const outputPath = resolve(process.cwd(), outputArg);
const signalsDir = resolve(process.cwd(), signalsDirArg);

const env = loadEnv();
const SERPER_KEY = env.SERPER_API_KEY;
if (!SERPER_KEY) { console.error('SERPER_API_KEY not set'); process.exit(1); }

if (!existsSync(signalsDir)) mkdirSync(signalsDir, { recursive: true });

// Shared extraction logic -- used both for live Serper responses and cache replay
function applyExtraction(signalType: string, raw: any, companyName: string, query: string, sidecar: SignalSidecar): void {
  if (signalType === 'funding') {
    const fact = extractFundingFact(raw, companyName);
    if (fact && !sidecar.funding?.found) {
      sidecar.funding = { fact, found: true };
      if (!sidecar.available_signals!.includes('funding')) sidecar.available_signals!.push('funding');
    }
  } else if (signalType === 'press') {
    const fact = extractPressFact(raw, companyName);
    if (fact) {
      sidecar.press!.push({ fact, found: true } as any);
      if (!sidecar.available_signals!.includes('press')) sidecar.available_signals!.push('press');
    }
  } else if (signalType === 'snippet') {
    const fact = extractSnippetFact(raw, companyName);
    if (fact && !sidecar.company_snippet?.fact) {
      sidecar.company_snippet = { fact, source_query: query, raw_serper_response: null };
      if (!sidecar.available_signals!.includes('company_snippet')) sidecar.available_signals!.push('company_snippet');
    }
  } else if (signalType === 'acquisition') {
    const fact = extractAcquisitionFact(raw, companyName);
    if (fact && !sidecar.acquisition?.found) {
      sidecar.acquisition = { fact, found: true };
      if (!sidecar.available_signals!.includes('acquisition')) sidecar.available_signals!.push('acquisition');
    }
  }
}

const { rows } = parseCsv(readFileSync(inputPath, 'utf8'));
const results: Record<string, string>[] = [];

let totalSerperCredits = 0;
let cacheHits = 0;
let processed = 0;

for (const lead of rows) {
  if (!lead.person_id || !lead.company_domain) {
    results.push({ ...lead, enrichment_tier: '', signal_used: 'fallback', signal_fact: '', signal_freshness_days: '' });
    continue;
  }

  const domain = lead.company_domain.toLowerCase().replace(/^www\./, '');
  const tier = computeTier({ qual_confidence: parseFloat(lead.icp_confidence || lead.qual_confidence || '0.5'), title: lead.current_job_title });

  // Cache check
  const existing = readSidecar(domain, signalsDir);
  if (existing && existing.cache_status === 'fresh') {
    cacheHits++;
    results.push({ ...lead, enrichment_tier: tier, signal_used: existing.available_signals?.[0] ?? 'fallback' });
    processed++;
    continue;
  }

  // Fetch signals
  const queries = getMythicQueriesForTier(tier, { company: lead.company_name, domain });
  const sidecar: SignalSidecar = {
    schema_version: '1.0',
    domain,
    fetched_at: new Date().toISOString(),
    company_snippet: { fact: null, source_query: null, raw_serper_response: null },
    funding: { fact: null, found: false },
    press: [],
    product_launch: { fact: null, found: false },
    acquisition: { fact: null, found: false },
    available_signals: [],
    fetch_log: [],
  };

  for (const q of queries.serper) {
    try {
      const res = await serperSearch(q.query, SERPER_KEY, 'mythic-extract-signals.ts');
      totalSerperCredits++;
      const raw = res.raw;

      // Store raw response in fetch_log so extraction can be replayed without re-fetching
      sidecar.fetch_log!.push({
        query_id: q.id,
        query: q.query,
        signal_type: q.signal_type,
        fired_at: new Date().toISOString(),
        raw_response: raw,
      });

      applyExtraction(q.signal_type, raw, lead.company_name, q.query, sidecar);
    } catch (err: any) {
      console.error(`  Query ${q.id} error: ${err?.message ?? err}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  writeSidecar(domain, sidecar, signalsDir);

  const signalUsed = sidecar.available_signals![0] ?? 'fallback';
  function unwrapFact(f: any): string {
    if (!f) return '';
    if (typeof f === 'string') return f;
    if (typeof f === 'object' && typeof f.fact === 'string') return f.fact;
    if (typeof f === 'object' && typeof f.fact === 'object') return f.fact?.fact ?? '';
    return String(f);
  }
  let signalFact = '';
  if (signalUsed === 'funding') signalFact = unwrapFact(sidecar.funding?.fact);
  else if (signalUsed === 'press') signalFact = unwrapFact(sidecar.press?.[0]?.fact);
  else if (signalUsed === 'company_snippet') signalFact = unwrapFact(sidecar.company_snippet?.fact);
  else if (signalUsed === 'acquisition') signalFact = unwrapFact(sidecar.acquisition?.fact);

  results.push({ ...lead, enrichment_tier: tier, signal_used: signalUsed, signal_fact: String(signalFact) });
  processed++;

  console.error(`[${processed}/${rows.length}] ${domain} (${tier}): ${sidecar.available_signals!.join(', ') || 'fallback'} | serper=${totalSerperCredits}`);
}

const outDir = dirname(outputPath);
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const extraCols = ['enrichment_tier', 'signal_used', 'signal_fact'];
writeFileSync(outputPath, writeCsvWithExtra(results, extraCols), 'utf8');

console.error('');
console.error('=== Mythic signal extraction summary ===');
console.error(`Processed:      ${processed}`);
console.error(`Cache hits:     ${cacheHits}`);
console.error(`Serper credits: ${totalSerperCredits}`);
console.error(`Output:         ${outputPath}`);
