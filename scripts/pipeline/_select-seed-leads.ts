#!/usr/bin/env tsx
// Select 25 leads per vertical for seed campaigns. Writes one CSV per vertical
// into data/runs/showcase-2026-05-28/inputs/ so the dispatcher can read them.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { parseCsv, writeCsvWithExtra } from '../_csv_io';

interface Source {
  vertical: string;
  client: string;
  file: string;
  filter?: (row: any) => boolean;
  cap: number;
}

const SOURCES: Source[] = [
  // BW from leads-final-v4.csv -- already qualified, just filter by primary_vertical
  { client: 'belardi-wong', vertical: 'apparel',           file: 'profiles/belardi-wong/campaigns/lookalike-anchor/leads-final-v4.csv', filter: r => (r.primary_vertical || '').toLowerCase() === 'apparel', cap: 25 },
  { client: 'belardi-wong', vertical: 'beauty',            file: 'profiles/belardi-wong/campaigns/lookalike-anchor/leads-final-v4.csv', filter: r => (r.primary_vertical || '').toLowerCase() === 'beauty', cap: 25 },
  { client: 'belardi-wong', vertical: 'home',              file: 'profiles/belardi-wong/campaigns/lookalike-anchor/leads-final-v4.csv', filter: r => (r.primary_vertical || '').toLowerCase() === 'home', cap: 25 },
  { client: 'belardi-wong', vertical: 'lifestyle_apparel', file: 'profiles/belardi-wong/campaigns/lookalike-anchor/leads-final-v4.csv', filter: r => (r.primary_vertical || '').toLowerCase() === 'lifestyle_apparel', cap: 25 },
  { client: 'belardi-wong', vertical: 'athletic',          file: 'profiles/belardi-wong/campaigns/lookalike-anchor/leads-final-v4.csv', filter: r => (r.primary_vertical || '').toLowerCase() === 'athletic', cap: 24 },
  { client: 'belardi-wong', vertical: 'footwear',          file: 'profiles/belardi-wong/campaigns/lookalike-anchor/leads-final-v4.csv', filter: r => (r.primary_vertical || '').toLowerCase() === 'footwear', cap: 9 },
  { client: 'belardi-wong', vertical: 'denim',             file: 'profiles/belardi-wong/campaigns/lookalike-anchor/leads-final-v4.csv', filter: r => (r.primary_vertical || '').toLowerCase() === 'denim', cap: 10 },
  { client: 'belardi-wong', vertical: 'food_bev',          file: 'profiles/belardi-wong/campaigns/lookalike-anchor/leads-final-v4.csv', filter: r => (r.primary_vertical || '').toLowerCase() === 'food_bev', cap: 11 },

  // Mythic: pre-pulled raw leads (no scoring yet, but high-quality industries + titles)
  { client: 'mythic', vertical: 'qsr',         file: 'profiles/mythic/campaigns/growth-codes/data/leads-scored-qsr.csv', cap: 25 },
  { client: 'mythic', vertical: 'retail',      file: 'profiles/mythic/campaigns/growth-codes/data/leads-raw-retail.csv', cap: 25 },
  { client: 'mythic', vertical: 'financial',   file: 'profiles/mythic/campaigns/growth-codes/data/leads-raw-financial.csv', cap: 25 },
  { client: 'mythic', vertical: 'healthcare',  file: 'profiles/mythic/campaigns/growth-codes/data/leads-raw-healthcare.csv', cap: 25 },
  { client: 'mythic', vertical: 'hospitality', file: 'profiles/mythic/campaigns/growth-codes/data/leads-raw-hospitality.csv', cap: 25 },
];

const outDir = resolve(process.cwd(), 'data/runs/showcase-2026-05-28/inputs');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

let total = 0;
for (const s of SOURCES) {
  const p = resolve(process.cwd(), s.file);
  if (!existsSync(p)) { console.warn(`missing: ${p}`); continue; }
  const { rows } = parseCsv(readFileSync(p, 'utf8'));
  const filtered = s.filter ? rows.filter(s.filter) : rows;
  const seen = new Set<string>();
  const dedup = filtered.filter(r => {
    const d = (r.company_domain || '').toLowerCase().replace(/^www\./, '');
    if (!d || seen.has(d)) return false;
    seen.add(d);
    return true;
  });
  const picked = dedup.slice(0, s.cap);
  const outPath = resolve(outDir, `${s.client}-${s.vertical}.csv`);
  writeFileSync(outPath, writeCsvWithExtra(picked as any, []), 'utf8');
  console.log(`${s.client}/${s.vertical}: ${picked.length} leads`);
  total += picked.length;
}
console.log(`\nTotal: ${total} leads selected for email generation`);
