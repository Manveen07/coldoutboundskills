#!/usr/bin/env tsx
// Drain pools to hit 25/vertical. Reads:
//   - leads-final-v4.csv (BW, qualified=true rows)
//   - leads-raw-{vertical}.csv (Mythic 4 verticals)
//   - leads-scored-qsr.csv (Mythic qsr)
// Skips domains already in showcase-2026-05-28/emails/*.json (the 197 leads done).
// Writes data/runs/showcase-2026-05-28/topup-v2/{client}-{vertical}.csv

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

const root = process.cwd();
const emailsDir = resolve(root, 'data/runs/showcase-2026-05-28/emails');
const outDir = resolve(root, 'data/runs/showcase-2026-05-28/topup-v2');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const emailedDomains = new Set<string>();
for (const f of readdirSync(emailsDir).filter(f => f.endsWith('.json'))) {
  try {
    const items = JSON.parse(readFileSync(join(emailsDir, f), 'utf8'));
    const arr = Array.isArray(items) ? items : [items];
    for (const it of arr) {
      const d = (it.domain || '').toLowerCase().replace(/^www\./, '').trim();
      if (d) emailedDomains.add(d);
    }
  } catch {}
}

interface Source {
  client: string;
  vertical: string;
  file: string;
  filter?: (cols: string[], headers: string[]) => boolean;
  cap: number;
  scoringFile?: string;
}

function col(cols: string[], headers: string[], name: string): string {
  const i = headers.indexOf(name);
  if (i < 0) return '';
  return (cols[i] || '').toString();
}

// Target = 25/vertical; we already emailed N; cap = 25 - N + few extra for safety.
const bwFile = 'profiles/belardi-wong/campaigns/lookalike-anchor/leads-final-v4.csv';
const mythicFile = (v: string) => `profiles/mythic/campaigns/growth-codes/data/leads-raw-${v}.csv`;

const SOURCES: Source[] = [
  { client: 'belardi-wong', vertical: 'home',              file: bwFile, filter: (c,h) => col(c,h,'qualified').toLowerCase()==='true' && col(c,h,'primary_vertical').toLowerCase()==='home', cap: 30 },
  { client: 'belardi-wong', vertical: 'athletic',          file: bwFile, filter: (c,h) => col(c,h,'qualified').toLowerCase()==='true' && col(c,h,'primary_vertical').toLowerCase()==='athletic', cap: 30 },
  { client: 'belardi-wong', vertical: 'footwear',          file: bwFile, filter: (c,h) => col(c,h,'qualified').toLowerCase()==='true' && col(c,h,'primary_vertical').toLowerCase()==='footwear', cap: 30 },
  { client: 'belardi-wong', vertical: 'denim',             file: bwFile, filter: (c,h) => col(c,h,'qualified').toLowerCase()==='true' && col(c,h,'primary_vertical').toLowerCase()==='denim', cap: 30 },
  { client: 'belardi-wong', vertical: 'food_bev',          file: bwFile, filter: (c,h) => col(c,h,'qualified').toLowerCase()==='true' && col(c,h,'primary_vertical').toLowerCase()==='food_bev', cap: 30 },
  { client: 'mythic', vertical: 'retail',      file: mythicFile('retail'),      scoringFile: 'data/runs/showcase-2026-05-28/scoring/mythic-retail.json',      cap: 30 },
  { client: 'mythic', vertical: 'hospitality', file: mythicFile('hospitality'), scoringFile: 'data/runs/showcase-2026-05-28/scoring/mythic-hospitality.json', cap: 30 },
];

const summary: any[] = [];
for (const s of SOURCES) {
  const p = resolve(root, s.file);
  if (!existsSync(p)) { console.warn(`missing: ${p}`); continue; }
  const lines = readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
  const headers = splitCsv(lines[0]);
  const idxDomain = headers.indexOf('company_domain');
  const out = [lines[0]];
  const seen = new Set<string>();
  let kept = 0;

  // Build scoring domain whitelist (qualified at 0.7+)
  let scoreOk: Set<string> | null = null;
  if (s.scoringFile) {
    const sj = JSON.parse(readFileSync(resolve(root, s.scoringFile), 'utf8'));
    scoreOk = new Set(sj.filter((x: any) => x.qualified && x.confidence >= 0.7)
      .map((x: any) => (x.domain || '').toLowerCase().replace(/^www\./, '')));
  }

  for (let i = 1; i < lines.length && kept < s.cap; i++) {
    const cols = splitCsv(lines[i]);
    if (s.filter && !s.filter(cols, headers)) continue;
    const d = (cols[idxDomain] || '').toLowerCase().replace(/^www\./, '').trim();
    if (!d || seen.has(d) || emailedDomains.has(d)) continue;
    if (scoreOk && !scoreOk.has(d)) continue;
    seen.add(d);
    out.push(lines[i]);
    kept++;
  }
  const outPath = join(outDir, `${s.client}-${s.vertical}.csv`);
  writeFileSync(outPath, out.join('\n'), 'utf8');
  summary.push({ key: `${s.client}-${s.vertical}`, count: out.length - 1 });
  console.log(`${s.client}/${s.vertical}: ${out.length - 1} new -> ${outPath}`);
}
console.log('\nemailed-domain set size:', emailedDomains.size);
writeFileSync(join(outDir, '_summary.json'), JSON.stringify(summary, null, 2), 'utf8');
