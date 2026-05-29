#!/usr/bin/env tsx
// Build per-vertical "qualified leads" files for email generation.
// Reads raw lead CSV + scoring JSON, intersects, writes one file per vertical.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { parseCsv, writeCsvWithExtra } from '../_csv_io';

interface VerticalSpec {
  client: string;
  vertical: string;
  leadsFile: string;
  scoringFile?: string;       // if missing -> assume already-qualified leads
  cap: number;
  alreadyQualified?: boolean; // BW leads-final-v4.csv rows are pre-qualified
  verticalKey?: string;       // for filtering inside leads-final-v4.csv
}

const SPECS: VerticalSpec[] = [
  // BW: pre-qualified from leads-final-v4.csv, filter by vertical
  { client: 'belardi-wong', vertical: 'apparel',           leadsFile: 'profiles/belardi-wong/campaigns/lookalike-anchor/leads-final-v4.csv', alreadyQualified: true, verticalKey: 'apparel', cap: 25 },
  { client: 'belardi-wong', vertical: 'beauty',            leadsFile: 'profiles/belardi-wong/campaigns/lookalike-anchor/leads-final-v4.csv', alreadyQualified: true, verticalKey: 'beauty', cap: 25 },
  { client: 'belardi-wong', vertical: 'home',              leadsFile: 'profiles/belardi-wong/campaigns/lookalike-anchor/leads-final-v4.csv', alreadyQualified: true, verticalKey: 'home', cap: 25 },
  { client: 'belardi-wong', vertical: 'lifestyle_apparel', leadsFile: 'profiles/belardi-wong/campaigns/lookalike-anchor/leads-final-v4.csv', alreadyQualified: true, verticalKey: 'lifestyle_apparel', cap: 25 },
  { client: 'belardi-wong', vertical: 'athletic',          leadsFile: 'profiles/belardi-wong/campaigns/lookalike-anchor/leads-final-v4.csv', alreadyQualified: true, verticalKey: 'athletic', cap: 25 },
  { client: 'belardi-wong', vertical: 'footwear',          leadsFile: 'profiles/belardi-wong/campaigns/lookalike-anchor/leads-final-v4.csv', alreadyQualified: true, verticalKey: 'footwear', cap: 25 },
  { client: 'belardi-wong', vertical: 'denim',             leadsFile: 'profiles/belardi-wong/campaigns/lookalike-anchor/leads-final-v4.csv', alreadyQualified: true, verticalKey: 'denim', cap: 25 },
  { client: 'belardi-wong', vertical: 'food_bev',          leadsFile: 'profiles/belardi-wong/campaigns/lookalike-anchor/leads-final-v4.csv', alreadyQualified: true, verticalKey: 'food_bev', cap: 25 },

  // Mythic: pre-scored QSR + 4 newly-scored
  { client: 'mythic', vertical: 'qsr',         leadsFile: 'profiles/mythic/campaigns/growth-codes/data/leads-scored-qsr.csv', alreadyQualified: true, cap: 25 },
  { client: 'mythic', vertical: 'retail',      leadsFile: 'profiles/mythic/campaigns/growth-codes/data/leads-raw-retail.csv',     scoringFile: 'data/runs/showcase-2026-05-28/scoring/mythic-retail.json', cap: 25 },
  { client: 'mythic', vertical: 'financial',   leadsFile: 'profiles/mythic/campaigns/growth-codes/data/leads-raw-financial.csv',  scoringFile: 'data/runs/showcase-2026-05-28/scoring/mythic-financial.json', cap: 25 },
  { client: 'mythic', vertical: 'healthcare',  leadsFile: 'profiles/mythic/campaigns/growth-codes/data/leads-raw-healthcare.csv', scoringFile: 'data/runs/showcase-2026-05-28/scoring/mythic-healthcare.json', cap: 25 },
  { client: 'mythic', vertical: 'hospitality', leadsFile: 'profiles/mythic/campaigns/growth-codes/data/leads-raw-hospitality.csv',scoringFile: 'data/runs/showcase-2026-05-28/scoring/mythic-hospitality.json', cap: 25 },
];

const outDir = resolve(process.cwd(), 'data/runs/showcase-2026-05-28/qualified');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

let totalQualified = 0;
const summary: any[] = [];

for (const spec of SPECS) {
  const leadsPath = resolve(process.cwd(), spec.leadsFile);
  if (!existsSync(leadsPath)) { console.warn(`missing: ${leadsPath}`); continue; }
  const { rows } = parseCsv(readFileSync(leadsPath, 'utf8'));

  let candidates = rows;

  // Filter by vertical for BW
  if (spec.verticalKey) {
    candidates = candidates.filter(r => (r.primary_vertical || '').toLowerCase() === spec.verticalKey);
  }

  // For pre-scored Mythic QSR, only keep qualified rows
  if (spec.client === 'mythic' && spec.vertical === 'qsr') {
    candidates = candidates.filter(r => r.icp_qualified === 'true' && parseFloat(r.icp_confidence || '0') >= 0.7);
  }

  // Apply scoring intersection for newly-scored Mythic verticals
  if (spec.scoringFile) {
    const scores = JSON.parse(readFileSync(resolve(process.cwd(), spec.scoringFile), 'utf8'));
    const qualifiedDomains = new Set(
      scores
        .filter((s: any) => s.qualified && s.confidence >= 0.7)
        .map((s: any) => (s.domain || '').toLowerCase().replace(/^www\./, ''))
    );
    // Attach scoring info to rows
    const scoreMap = new Map<string, any>();
    for (const s of scores) {
      const d = (s.domain || '').toLowerCase().replace(/^www\./, '');
      scoreMap.set(d, s);
    }
    candidates = candidates
      .filter(r => qualifiedDomains.has((r.company_domain || '').toLowerCase().replace(/^www\./, '')))
      .map(r => {
        const d = (r.company_domain || '').toLowerCase().replace(/^www\./, '');
        const s = scoreMap.get(d) || {};
        return { ...r, icp_qualified: 'true', icp_confidence: String(s.confidence || ''), icp_reason: s.reason || '' };
      });
  }

  // Dedup by domain
  const seen = new Set<string>();
  const dedup = candidates.filter(r => {
    const d = (r.company_domain || '').toLowerCase().replace(/^www\./, '');
    if (!d || seen.has(d)) return false;
    seen.add(d);
    return true;
  });
  const picked = dedup.slice(0, spec.cap);

  const outPath = resolve(outDir, `${spec.client}-${spec.vertical}.csv`);
  writeFileSync(outPath, writeCsvWithExtra(picked as any, []), 'utf8');
  console.log(`${spec.client}/${spec.vertical}: ${picked.length} qualified leads -> ${outPath}`);
  totalQualified += picked.length;
  summary.push({ client: spec.client, vertical: spec.vertical, count: picked.length });
}

console.log(`\nTOTAL qualified leads ready for email generation: ${totalQualified}`);
writeFileSync(resolve(outDir, '_summary.json'), JSON.stringify(summary, null, 2), 'utf8');
