#!/usr/bin/env tsx
// Simple selector: take p2 raw CSVs, drop emailed/BW-anchor/known-bad-fit rows,
// cap per vertical to hit 25 total when combined with prior emails.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

const root = process.cwd();
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

// Hard-skip domains: BW anchors + already-emailed
const BW_ANCHORS = new Set(['titlenine.com','bombas.com','verabradley.com','anthropologie.com','reformation.com','staud.com','birkenstock.com','kuru.com','agjeans.com','paige.com','serenaandlily.com','dwr.com','schoolhouse.com','schoolhouseelectric.com','crateandbarrel.com','mcgeeandco.com','peacockalley.com','grupobimbo.com']);
const BW_BAD_TITLES = /production coordinator|coordinator|assistant|intern|svp franchise development|franchise development/i;
const MYTHIC_BAD_TITLES = /ops & compliance|compliance only|administrative/i;

interface Spec { client: string; vertical: string; rawFile: string; cap: number; isBw: boolean; }
const SPECS: Spec[] = [
  { client: 'mythic',       vertical: 'retail',      rawFile: 'profiles/mythic/campaigns/growth-codes/data/leads-raw-retail-p2.csv',      cap: 15, isBw: false },
  { client: 'mythic',       vertical: 'financial',   rawFile: 'profiles/mythic/campaigns/growth-codes/data/leads-raw-financial-p2.csv',   cap: 17, isBw: false },
  { client: 'mythic',       vertical: 'healthcare',  rawFile: 'profiles/mythic/campaigns/growth-codes/data/leads-raw-healthcare-p2.csv',  cap: 20, isBw: false },
  { client: 'mythic',       vertical: 'hospitality', rawFile: 'profiles/mythic/campaigns/growth-codes/data/leads-raw-hospitality-p2.csv', cap: 7,  isBw: false },
  { client: 'mythic',       vertical: 'healthcare-p3',  rawFile: 'profiles/mythic/campaigns/growth-codes/data/leads-raw-healthcare-p3.csv',  cap: 10, isBw: false },
  { client: 'mythic',       vertical: 'hospitality-p3', rawFile: 'profiles/mythic/campaigns/growth-codes/data/leads-raw-hospitality-p3.csv', cap: 10, isBw: false },
  { client: 'belardi-wong', vertical: 'athletic',    rawFile: 'profiles/belardi-wong/campaigns/lookalike-anchor/data/leads-raw-athletic-p2.csv', cap: 7,  isBw: true },
  { client: 'belardi-wong', vertical: 'footwear',    rawFile: 'profiles/belardi-wong/campaigns/lookalike-anchor/data/leads-raw-footwear-p2.csv', cap: 13, isBw: true },
  { client: 'belardi-wong', vertical: 'denim',       rawFile: 'profiles/belardi-wong/campaigns/lookalike-anchor/data/leads-raw-denim-p2.csv',    cap: 7,  isBw: true },
  { client: 'belardi-wong', vertical: 'food_bev',    rawFile: 'profiles/belardi-wong/campaigns/lookalike-anchor/data/leads-raw-fnb-p2.csv',      cap: 13, isBw: true },
];

const emailsDir = resolve(root, 'data/runs/showcase-2026-05-28/emails');
const emailed = new Set<string>();
for (const f of readdirSync(emailsDir).filter(f => f.endsWith('.json'))) {
  try {
    const j = JSON.parse(readFileSync(join(emailsDir, f), 'utf8'));
    const arr = Array.isArray(j) ? j : [j];
    for (const it of arr) {
      const d = (it.domain || '').toLowerCase().replace(/^www\./, '').trim();
      if (d) emailed.add(d);
    }
  } catch {}
}

for (const s of SPECS) {
  const p = resolve(root, s.rawFile);
  if (!existsSync(p)) continue;
  const lines = readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
  const headers = splitCsv(lines[0]);
  const idxDomain = headers.indexOf('company_domain');
  const idxTitle = headers.indexOf('current_job_title');
  const out = [lines[0]];
  const seen = new Set<string>();
  let kept = 0;
  for (let i = 1; i < lines.length && kept < s.cap; i++) {
    const cols = splitCsv(lines[i]);
    const d = (cols[idxDomain] || '').toLowerCase().replace(/^www\./, '').trim();
    if (!d) continue;
    if (emailed.has(d) || seen.has(d) || BW_ANCHORS.has(d)) continue;
    const title = cols[idxTitle] || '';
    if (s.isBw && BW_BAD_TITLES.test(title)) continue;
    if (!s.isBw && MYTHIC_BAD_TITLES.test(title)) continue;
    seen.add(d);
    out.push(lines[i]);
    kept++;
  }
  const outPath = join(outDir, `${s.client}-${s.vertical}-p2.csv`);
  writeFileSync(outPath, out.join('\n'), 'utf8');
  console.log(`${s.client}/${s.vertical}: ${out.length - 1} leads -> ${outPath}`);
}
