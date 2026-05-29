#!/usr/bin/env tsx
// Pull 1 page (25 leads) per vertical for verticals under 25 target.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { loadClientConfigByName } from '../_client_config';
import { pullLeads } from './_pull';
import { writeCsvWithExtra } from '../_csv_io';

function loadEnv(): Record<string, string> {
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
}

const env = loadEnv();
const apiKey = env.PROSPEO_API_KEY;
if (!apiKey) { console.error('PROSPEO_API_KEY not set'); process.exit(1); }

// 8 targets, page 2 onwards to avoid already-pulled leads
const TARGETS: Array<{ client: string; category: string; outDir: string; startPage: number }> = [
  { client: 'mythic', category: 'healthcare',  outDir: 'profiles/mythic/campaigns/growth-codes/data', startPage: 3 },
  { client: 'mythic', category: 'hospitality', outDir: 'profiles/mythic/campaigns/growth-codes/data', startPage: 3 },
  { client: 'belardi-wong', category: 'athletic', outDir: 'profiles/belardi-wong/campaigns/lookalike-anchor/data', startPage: 3 },
  { client: 'belardi-wong', category: 'footwear', outDir: 'profiles/belardi-wong/campaigns/lookalike-anchor/data', startPage: 3 },
  { client: 'belardi-wong', category: 'denim',    outDir: 'profiles/belardi-wong/campaigns/lookalike-anchor/data', startPage: 3 },
  { client: 'belardi-wong', category: 'fnb',      outDir: 'profiles/belardi-wong/campaigns/lookalike-anchor/data', startPage: 3 },
];

(async () => {
  let totalCredits = 0;
  for (const t of TARGETS) {
    const cfg = loadClientConfigByName(t.client);
    console.log(`\n=== Pulling ${t.client}/${t.category} (page ${t.startPage}) ===`);
    try {
      const result = await pullLeads({
        apiKey, cfg, category: t.category,
        maxPages: 1,
        startPage: t.startPage,
        callerScript: 'pull-topup-v2',
      } as any);
      totalCredits += result.pagesFetched;
      console.log(`  ${result.leads.length} leads | fetched=${result.pagesFetched} cached=${result.pagesFromCache} pool=${result.totalPool}`);

      if (!existsSync(t.outDir)) mkdirSync(t.outDir, { recursive: true });
      const csvPath = resolve(t.outDir, `leads-raw-${t.category}-p${t.startPage}.csv`);
      writeFileSync(csvPath, writeCsvWithExtra(result.leads as any, []), 'utf8');
      console.log(`  saved: ${csvPath}`);
    } catch (err: any) {
      console.error(`  FAILED: ${err?.message ?? err}`);
    }
  }
  console.log(`\n=== Total credits spent: ${totalCredits} ===`);
})();
