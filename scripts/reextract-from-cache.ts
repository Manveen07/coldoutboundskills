#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// reextract-from-cache.ts -- Replay signal extraction from cached raw responses
//
// When an extractor bug is fixed, use this to re-extract facts from already-
// saved Serper responses WITHOUT making new API calls. Zero credits used.
//
// Usage:
//   npx tsx scripts/reextract-from-cache.ts \
//     --input  profiles/mythic/campaigns/growth-codes/data/leads-scored-qsr.csv \
//     --output profiles/mythic/campaigns/growth-codes/data/leads-with-signals-qsr.csv \
//     --signals profiles/mythic/campaigns/growth-codes/data/signals-qsr
//
// Reads each lead's sidecar, replays extraction on stored raw_response fields,
// rewrites the sidecar with corrected facts, writes the output CSV.
// Only processes sidecars that have raw_response in their fetch_log.
// Sidecars without raw_response are skipped (need a live Serper run).
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { parseCsv, writeCsvWithExtra } from './_csv_io';
import { readSidecar, writeSidecar, type SignalSidecar } from './_lib_signals';
import {
  extractFundingFact,
  extractPressFact,
  extractSnippetFact,
  extractAcquisitionFact,
} from './_fact_extractor';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, def = '') => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };
  return {
    input:    get('--input'),
    output:   get('--output'),
    signals:  get('--signals'),
  };
}

const { input, output, signals: signalsDir } = parseArgs();
if (!input || !output || !signalsDir) {
  console.error('Usage: npx tsx scripts/reextract-from-cache.ts --input <csv> --output <csv> --signals <dir>');
  process.exit(1);
}

const inputPath  = resolve(process.cwd(), input);
const outputPath = resolve(process.cwd(), output);
const sigDir     = resolve(process.cwd(), signalsDir);

const { rows } = parseCsv(readFileSync(inputPath, 'utf8'));
const results: Record<string, string>[] = [];

let reextracted = 0;
let skippedNoCache = 0;
let skippedNoRaw = 0;

for (const lead of rows) {
  if (!lead.person_id || !lead.company_domain) {
    results.push({ ...lead, enrichment_tier: '', signal_used: 'fallback', signal_fact: '' });
    continue;
  }

  const domain = lead.company_domain.toLowerCase().replace(/^www\./, '');
  const existing = readSidecar(domain, sigDir);

  if (!existing) {
    skippedNoCache++;
    results.push({ ...lead, enrichment_tier: lead.enrichment_tier || '', signal_used: 'fallback', signal_fact: '' });
    continue;
  }

  const fetchLog = existing.fetch_log ?? [];
  const hasRaw = fetchLog.some((e: any) => e.raw_response);

  if (!hasRaw) {
    skippedNoRaw++;
    // Keep whatever signals were previously extracted
    const signalUsed = existing.available_signals?.[0] ?? 'fallback';
    results.push({ ...lead, enrichment_tier: lead.enrichment_tier || '', signal_used: signalUsed, signal_fact: '' });
    continue;
  }

  // Reset extracted fields -- replay from raw responses
  const sidecar: SignalSidecar = {
    ...existing,
    funding: { fact: null, found: false },
    press: [],
    product_launch: { fact: null, found: false },
    acquisition: { fact: null, found: false },
    company_snippet: { fact: null, source_query: null, raw_serper_response: null },
    available_signals: [],
  };

  for (const entry of fetchLog) {
    if (!entry.raw_response) continue;
    const raw = entry.raw_response;
    const companyName = lead.company_name ?? '';
    const signalType = entry.signal_type;

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
      // Also try acquisition on press queries
      const acqFact = extractAcquisitionFact(raw, companyName);
      if (acqFact && !sidecar.acquisition?.found) {
        sidecar.acquisition = { fact: acqFact, found: true };
        if (!sidecar.available_signals!.includes('acquisition')) sidecar.available_signals!.push('acquisition');
      }
    } else if (signalType === 'snippet') {
      const fact = extractSnippetFact(raw, companyName);
      if (fact && !sidecar.company_snippet?.fact) {
        sidecar.company_snippet = { fact, source_query: entry.query, raw_serper_response: null };
        if (!sidecar.available_signals!.includes('company_snippet')) sidecar.available_signals!.push('company_snippet');
      }
    }
  }

  // Rewrite sidecar with corrected extracted facts
  writeSidecar(domain, sidecar, sigDir);

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

  results.push({ ...lead, enrichment_tier: lead.enrichment_tier || '', signal_used: signalUsed, signal_fact: String(signalFact) });
  reextracted++;

  console.error(`[${reextracted}] ${domain}: ${sidecar.available_signals!.join(', ') || 'fallback'}`);
}

const outDir = dirname(outputPath);
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
writeFileSync(outputPath, writeCsvWithExtra(results, ['enrichment_tier', 'signal_used', 'signal_fact']), 'utf8');

console.error('');
console.error('=== Re-extraction from cache summary ===');
console.error(`Re-extracted:       ${reextracted} (no Serper calls)`);
console.error(`Skipped (no sidecar): ${skippedNoCache}`);
console.error(`Skipped (no raw):   ${skippedNoRaw}`);
console.error(`Output:             ${outputPath}`);
