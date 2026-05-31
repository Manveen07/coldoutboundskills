#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// _niche-scrape.ts — Mode B: category-driven niche-DB lead extraction.
//
// Instead of one hardcoded database, a registry maps a category -> candidate
// source(s). Each source has an extractor that returns leads in the shared
// list-builder shape, then feeds the SAME downstream stages as Mode A
// (suppress -> enrich -> validate -> score) via build-list --finalize.
//
// Add sources incrementally. SEC EDGAR Form 4 is included as a working example.
//
// Usage:
//   npx tsx scripts/list-builder/_niche-scrape.ts --list-sources
//   npx tsx scripts/list-builder/_niche-scrape.ts --category=finance --source=sec_form4 --out=<runDir>/pulled.json [--date=2026-05-29]
// ---------------------------------------------------------------------------

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';

export interface NicheLead {
  full_name: string;
  title: string;
  company_name: string;
  domain: string;
  email: string; // usually empty — enrich stage fills it
  source: string; // niche:<source_id>
  raw?: any;
}

interface NicheSource {
  id: string;
  category: string;
  label: string;
  extract: (opts: Record<string, string>) => Promise<NicheLead[]>;
}

// --- Example source: SEC EDGAR Form 4 (insider transactions) -----------------
// Public data, no key. Pulls recent Form 4 filings -> issuer + reporting person.
async function secForm4(opts: Record<string, string>): Promise<NicheLead[]> {
  const date = opts.date || new Date().toISOString().slice(0, 10);
  // EDGAR full-text/current filings index for Form 4.
  // daily-index: https://www.sec.gov/Archives/edgar/daily-index/
  // We use the current-events feed (atom) for type=4.
  const url =
    'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&company=&dateb=&owner=include&count=100&output=atom';
  const leads: NicheLead[] = [];
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'list-builder research contact@example.com' },
    });
    if (!res.ok) {
      console.error(`[niche:sec_form4] HTTP ${res.status}`);
      return leads;
    }
    const xml = await res.text();
    // entries: <entry><title>4 - NAME (CIK) (Reporting)</title>...
    const entries = xml.split('<entry>').slice(1);
    for (const e of entries) {
      const title = (e.match(/<title>([^<]+)<\/title>/) || [])[1] || '';
      // title format: "4 - Doe John (0001234567) (Reporting)"
      const m = title.match(/4\s*-\s*(.+?)\s*\(\d+\)\s*\((Reporting|Issuer)\)/i);
      if (!m) continue;
      const name = m[1].trim();
      const role = m[2];
      leads.push({
        full_name: role === 'Reporting' ? name : '',
        title: role === 'Reporting' ? 'Insider (Form 4 filer)' : 'Issuer',
        company_name: role === 'Issuer' ? name : '',
        domain: '', // resolved later or left for enrichment
        email: '',
        source: 'niche:sec_form4',
        raw: { title, date },
      });
    }
  } catch (err: any) {
    console.error(`[niche:sec_form4] ${err.message}`);
  }
  return leads;
}

// --- Source registry ---------------------------------------------------------
// Add entries here as sources are built. Keyed by id.
const SOURCES: NicheSource[] = [
  { id: 'sec_form4', category: 'finance', label: 'SEC EDGAR Form 4 insider filings', extract: secForm4 },
  // { id: 'chamber_<city>', category: 'local', label: 'Chamber of commerce directory', extract: chamberScrape },
  // { id: 'directory_<vertical>', category: 'b2b', label: 'Industry directory', extract: directoryScrape },
];

function arg(name: string, def?: string): string | undefined {
  const args = process.argv.slice(2);
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return def;
  if (hit.includes('=')) return hit.split('=').slice(1).join('=');
  return 'true';
}

async function main() {
  if (arg('list-sources') === 'true') {
    console.log('Available niche sources:');
    for (const s of SOURCES) console.log(`  ${s.id}  [${s.category}]  ${s.label}`);
    console.log('\nTo add a category, register a new source in SOURCES.');
    return;
  }

  const category = arg('category');
  const sourceId = arg('source');
  const out = arg('out');

  if (!out) {
    console.error('--out=<path> required (writes pulled.json for the run)');
    process.exit(1);
  }

  let chosen = SOURCES.filter((s) => {
    if (sourceId) return s.id === sourceId;
    if (category) return s.category === category;
    return false;
  });
  if (!chosen.length) {
    console.error(
      `No source matched (category=${category}, source=${sourceId}). Run --list-sources.`
    );
    process.exit(1);
  }

  const opts: Record<string, string> = {};
  for (const k of ['date', 'city', 'state', 'query']) {
    const v = arg(k);
    if (v) opts[k] = v;
  }

  const all: NicheLead[] = [];
  for (const s of chosen) {
    console.error(`[niche] extracting ${s.id} ...`);
    const leads = await s.extract(opts);
    console.error(`[niche] ${s.id}: ${leads.length} leads`);
    all.push(...leads);
  }

  if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ leads: all }, null, 2), 'utf8');
  console.error(`\nWrote ${all.length} leads -> ${out}`);
  console.error('NEXT: feed this through suppress -> enrich -> score (see README Mode B).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
