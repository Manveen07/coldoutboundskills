#!/usr/bin/env tsx
// Backfill Serper facts for any lead domain not already in facts/.
// Writes data/runs/showcase-2026-05-28/facts/_backfill.json

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

const root = process.cwd();
function loadEnv(): Record<string,string> {
  const raw = readFileSync(resolve(root,'.env'),'utf8');
  const out: Record<string,string> = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    out[t.slice(0,eq).trim()] = t.slice(eq+1).trim().replace(/^["']|["']$/g,'');
  }
  return out;
}
const env = loadEnv();
const SERPER_KEY = env.SERPER_API_KEY;
if (!SERPER_KEY) { console.error('SERPER_API_KEY missing'); process.exit(1); }

const emailsDir = resolve(root,'data/runs/showcase-2026-05-28/emails');
const factsDir = resolve(root,'data/runs/showcase-2026-05-28/facts');
const outPath = join(factsDir,'_backfill.json');

const norm = (d:string) => d.toLowerCase().replace(/^www\./,'').trim();

const have = new Set<string>();
for (const f of readdirSync(factsDir).filter(x=>x.endsWith('.json'))) {
  if (f === '_backfill.json') continue;
  const arr = JSON.parse(readFileSync(join(factsDir,f),'utf8'));
  for (const r of arr) if (r.domain) have.add(norm(r.domain));
}

interface Lead { lead:string; domain:string; title?:string; client:string; vertical:string; }
const missing: Lead[] = [];
for (const f of readdirSync(emailsDir).filter(x=>x.endsWith('.json'))) {
  const j = JSON.parse(readFileSync(join(emailsDir,f),'utf8'));
  const arr = Array.isArray(j) ? j : [j];
  for (const l of arr) {
    if (!l.domain) continue;
    if (have.has(norm(l.domain))) continue;
    missing.push({ lead:l.lead, domain:norm(l.domain), title:l.title, client:l.client, vertical:l.vertical });
  }
}
console.log(`backfill target: ${missing.length} domains`);

async function serper(q:string): Promise<any[]> {
  const r = await fetch('https://google.serper.dev/search', {
    method:'POST',
    headers:{'X-API-KEY':SERPER_KEY,'Content-Type':'application/json'},
    body: JSON.stringify({ q, num:5 }),
  });
  if (!r.ok) return [];
  const d:any = await r.json();
  return d.organic || [];
}

function pickFact(results:any[], company:string): { fact:string; source:string } | null {
  if (!results.length) return null;
  const scored = results.map(r=>{
    let s = 0;
    const snip = (r.snippet||'').toLowerCase();
    const title = (r.title||'').toLowerCase();
    if (/2026|2025/.test(snip) || /2026|2025/.test(title)) s += 3;
    if (/launches|announces|opens|expands|acquires|debuts|partners|raises|named/.test(snip)) s += 2;
    if (snip.includes(company.toLowerCase().slice(0,8))) s += 1;
    if (/press|news|prnewswire|businesswire/.test((r.link||'').toLowerCase())) s += 1;
    return { ...r, _score:s };
  });
  scored.sort((a,b)=>b._score - a._score);
  const t = scored[0];
  if (!t || !t.snippet) return null;
  return { fact: `${t.title}: ${t.snippet}`, source: t.link || '' };
}

function companyFromDomain(d:string): string {
  return d.replace(/\.(com|co|io|net|org|us|life)$/,'').replace(/-/g,' ').replace(/^./,c=>c.toUpperCase());
}

interface Out { domain:string; company_name:string; full_name:string; title:string; fact:string; fact_source:string; }

(async () => {
  const out: Out[] = [];
  const CONC = 5;
  let done = 0;
  async function work(l: Lead) {
    const company = companyFromDomain(l.domain);
    const q1 = `"${company}" 2026 launches OR announces OR opens OR expands`;
    let r = await serper(q1);
    let f = pickFact(r, company);
    if (!f) {
      const q2 = `"${company}" news 2025 OR 2026`;
      r = await serper(q2);
      f = pickFact(r, company);
    }
    out.push({
      domain: l.domain,
      company_name: company,
      full_name: l.lead,
      title: l.title || '',
      fact: f?.fact || '',
      fact_source: f?.source || '',
    });
    done++;
    if (done % 20 === 0) console.log(`  ${done}/${missing.length}`);
  }
  for (let i=0; i<missing.length; i+=CONC) {
    await Promise.all(missing.slice(i,i+CONC).map(work));
  }
  writeFileSync(outPath, JSON.stringify(out,null,2),'utf8');
  const hits = out.filter(o=>o.fact).length;
  console.log(`saved ${out.length} rows, ${hits} with facts -> ${outPath}`);
})();
