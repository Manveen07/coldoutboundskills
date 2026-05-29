#!/usr/bin/env tsx
// Top up per-vertical lead pools by re-reading leads-final-v4.csv,
// filtering by primary_vertical, dedup-ing against already-emailed domains
// (from data/runs/showcase-2026-05-28/emails/*.json), and writing remainder
// to data/runs/showcase-2026-05-28/topup/{vertical}.csv (cap 30 per vertical).

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

const root = process.cwd();
const v4 = resolve(root, 'profiles/belardi-wong/campaigns/lookalike-anchor/leads-final-v4.csv');
const emailsDir = resolve(root, 'data/runs/showcase-2026-05-28/emails');
const outDir = resolve(root, 'data/runs/showcase-2026-05-28/topup');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

// Naive CSV split that respects double-quoted fields.
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      out.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

// Build emailed-domain set from existing emails JSON files
const emailedDomains = new Set<string>();
for (const f of readdirSync(emailsDir).filter(f => f.endsWith('.json'))) {
  try {
    const raw = readFileSync(join(emailsDir, f), 'utf8');
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const it of items) {
      const d = (it.domain || '').toLowerCase().replace(/^www\./, '').trim();
      if (d) emailedDomains.add(d);
    }
  } catch {}
}
console.log(`emailed domains tracked: ${emailedDomains.size}`);

const verticals = ['apparel', 'lifestyle_apparel', 'athletic', 'footwear', 'denim', 'food_bev'];
const cap = 30;

const raw = readFileSync(v4, 'utf8').split(/\r?\n/);
const headerLine = raw[0];
const headers = splitCsv(headerLine);
const idxVertical = headers.indexOf('primary_vertical');
const idxDomain = headers.indexOf('company_domain');
const idxQualified = headers.indexOf('qualified');

const bucket: Record<string, string[]> = {};
for (const v of verticals) bucket[v] = [headerLine];

const seenPerVertical: Record<string, Set<string>> = {};
for (const v of verticals) seenPerVertical[v] = new Set();

for (let i = 1; i < raw.length; i++) {
  const line = raw[i];
  if (!line) continue;
  const cols = splitCsv(line);
  const v = (cols[idxVertical] || '').toLowerCase();
  if (!verticals.includes(v)) continue;
  const qual = (cols[idxQualified] || '').toLowerCase();
  if (qual !== 'true') continue;
  const d = (cols[idxDomain] || '').toLowerCase().replace(/^www\./, '').trim();
  if (!d) continue;
  if (emailedDomains.has(d)) continue;
  if (seenPerVertical[v].has(d)) continue;
  if (bucket[v].length - 1 >= cap) continue;
  seenPerVertical[v].add(d);
  bucket[v].push(line);
}

for (const v of verticals) {
  const outPath = join(outDir, `${v}.csv`);
  writeFileSync(outPath, bucket[v].join('\n'), 'utf8');
  console.log(`${v}: ${bucket[v].length - 1} new leads -> ${outPath}`);
}
