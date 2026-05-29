#!/usr/bin/env tsx
// Pull leads for missing verticals using the standardized _pull.ts.
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

const TARGETS: Array<{ client: string; category: string; outDir: string }> = [
  // Mythic: 4 new verticals
  { client: 'mythic', category: 'retail',      outDir: 'profiles/mythic/campaigns/growth-codes/data' },
  { client: 'mythic', category: 'financial',   outDir: 'profiles/mythic/campaigns/growth-codes/data' },
  { client: 'mythic', category: 'healthcare',  outDir: 'profiles/mythic/campaigns/growth-codes/data' },
  { client: 'mythic', category: 'hospitality', outDir: 'profiles/mythic/campaigns/growth-codes/data' },
  // BW: 3 verticals that need topping up (food_bev, footwear, denim)
  { client: 'belardi-wong', category: 'fnb',      outDir: 'profiles/belardi-wong/campaigns/lookalike-anchor/data' },
];

(async () => {
  let totalCredits = 0;
  for (const t of TARGETS) {
    const cfg = loadClientConfigByName(t.client);
    console.log(`\n=== Pulling ${t.client}/${t.category} (1 page) ===`);
    try {
      const result = await pullLeads({
        apiKey, cfg, category: t.category,
        maxPages: 1,
        callerScript: 'pull-missing-verticals',
      });
      totalCredits += result.pagesFetched;
      console.log(`  ${result.leads.length} leads | fetched=${result.pagesFetched} cached=${result.pagesFromCache} pool=${result.totalPool}`);

      if (!existsSync(t.outDir)) mkdirSync(t.outDir, { recursive: true });
      const csvPath = resolve(t.outDir, `leads-raw-${t.category}.csv`);
      writeFileSync(csvPath, writeCsvWithExtra(result.leads as any, []), 'utf8');
      console.log(`  saved: ${csvPath}`);
    } catch (err: any) {
      console.error(`  FAILED: ${err?.message ?? err}`);
    }
  }
  console.log(`\n=== Total credits spent this run: ${totalCredits} ===`);
})();
