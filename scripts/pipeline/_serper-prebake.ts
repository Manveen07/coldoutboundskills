#!/usr/bin/env tsx
// Pre-research leads via Serper API. Writes one JSON per vertical CSV input
// into data/runs/showcase-2026-05-28/facts/{client}-{vertical}.json
// Each entry: { domain, company_name, full_name, title, fact, fact_source }

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

const root = process.cwd();
function loadEnv(): Record<string, string> {
  const raw = readFileSync(resolve(root, '.env'), 'utf8');
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = loadEnv();
const SERPER_KEY = env.SERPER_API_KEY;
if (!SERPER_KEY) { console.error('SERPER_API_KEY missing'); process.exit(1); }

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

async function serperSearch(q: string): Promise<any[]> {
  const resp = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, num: 5 }),
  });
  if (!resp.ok) return [];
  const data = await resp.json() as any;
  return data.organic || [];
}

function pickBestFact(results: any[], company: string): { fact: string; source: string } | null {
  if (!results.length) return null;
  // Prefer trade press / dated 2025-2026 results
  const scored = results.map(r => {
    let score = 0;
    const snippet = (r.snippet || '').toLowerCase();
    const title = (r.title || '').toLowerCase();
    if (/2026|2025/.test(snippet) || /2026|2025/.test(title)) score += 3;
    if (/launches|announces|opens|expands|acquires|debuts|partners|raises|named/.test(snippet)) score += 2;
    if (snippet.includes(company.toLowerCase().slice(0, 8))) score += 1;
    if (/press|news|prnewswire|businesswire/.test((r.link || '').toLowerCase())) score += 1;
    return { ...r, _score: score };
  });
  scored.sort((a, b) => b._score - a._score);
  const top = scored[0];
  if (!top || !top.snippet) return null;
  return { fact: `${top.title}: ${top.snippet}`, source: top.link || '' };
}

interface FactRow {
  domain: string;
  company_name: string;
  full_name: string;
  title: string;
  fact: string;
  fact_source: string;
}

async function processCsv(inPath: string, outPath: string, verticalLabel: string) {
  const lines = readFileSync(inPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const headers = splitCsv(lines[0]);
  const idx = (n: string) => headers.indexOf(n);
  const out: FactRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsv(lines[i]);
    const domain = (cols[idx('company_domain')] || '').replace(/^www\./, '').trim();
    const company = (cols[idx('company_name')] || '').trim();
    const full_name = (cols[idx('full_name')] || `${cols[idx('first_name')]} ${cols[idx('last_name')]}`).trim();
    const title = (cols[idx('current_job_title')] || '').trim();
    if (!domain || !company) continue;
    const q1 = `"${company}" 2026 launches OR announces OR opens OR expands`;
    console.log(`[${verticalLabel}] ${company} (${domain}) ...`);
    let r = await serperSearch(q1);
    let fact = pickBestFact(r, company);
    if (!fact) {
      const q2 = `"${company}" news 2025 OR 2026`;
      r = await serperSearch(q2);
      fact = pickBestFact(r, company);
    }
    out.push({
      domain, company_name: company, full_name, title,
      fact: fact?.fact || '',
      fact_source: fact?.source || '',
    });
  }
  writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`saved ${out.length} facts -> ${outPath}`);
}

(async () => {
  const inDir = resolve(root, 'data/runs/showcase-2026-05-28/topup-v2');
  const outDir = resolve(root, 'data/runs/showcase-2026-05-28/facts');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const files = [
    'mythic-healthcare-p3-p2.csv',
    'mythic-hospitality-p3-p2.csv',
  ];
  for (const f of files) {
    const inP = join(inDir, f);
    if (!existsSync(inP)) { console.warn(`skip: ${inP}`); continue; }
    const outP = join(outDir, f.replace('.csv', '.json'));
    await processCsv(inP, outP, f.replace('.csv', ''));
  }
})();
