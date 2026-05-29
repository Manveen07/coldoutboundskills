#!/usr/bin/env tsx
// End-to-end email pipeline. Run per-vertical.
//
// Usage:
//   npx tsx scripts/pipeline/_email-pipeline.ts \
//     --leads data/runs/showcase-2026-05-28/topup-v2/mythic-retail-p2.csv \
//     --vertical retail --client mythic --out emails-out.json
//
// Flow: Serper fact-fetch -> fact-richness gate -> batch into 5 -> dispatch
// (writes batch prompts to disk for sub-agent dispatch) -> output validator.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

const args = process.argv.slice(2);
function arg(name: string, def?: string): string {
  const i = args.indexOf(`--${name}`);
  if (i === -1) {
    if (def !== undefined) return def;
    throw new Error(`missing --${name}`);
  }
  return args[i + 1];
}

const leadsPath = arg('leads');
const vertical = arg('vertical');
const client = arg('client');
const outDir = arg('out', `data/runs/showcase-2026-05-28/pipeline-out/${client}-${vertical}`);
const batchSize = parseInt(arg('batchSize', '5'));

function loadEnv(): Record<string, string> {
  const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
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
  const out: string[] = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

interface SerperHit { title?: string; snippet?: string; link?: string; }
async function serperSearch(q: string): Promise<SerperHit[]> {
  const resp = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, num: 5 }),
  });
  if (!resp.ok) return [];
  const data = await resp.json() as any;
  return data.organic || [];
}

interface Fact { text: string; source: string; score: number; }
function scoreHit(h: SerperHit, company: string): number {
  let s = 0;
  const blob = `${h.title || ''} ${h.snippet || ''}`.toLowerCase();
  // Recency
  if (/2026/.test(blob)) s += 4;
  else if (/2025/.test(blob)) s += 2;
  // Action verbs
  if (/launches|announces|opens|expands|acquires|debuts|partners|raises|named|appoints/.test(blob)) s += 3;
  // Specific nouns: $, %, store, location
  if (/\$[\d.,]+|[\d]+%|\d+\s+(stores|locations|hospitals|hotels|properties)/.test(blob)) s += 3;
  // Mentions company
  if (blob.includes(company.toLowerCase().slice(0, 8))) s += 2;
  // Trade press / official sources
  if (/prnewswire|businesswire|reuters|wsj|bloomberg|nrn\.com|qsr|retaildive|wwd|adweek/.test((h.link || '').toLowerCase())) s += 2;
  return s;
}

async function fetchBestFact(company: string, domain: string): Promise<Fact | null> {
  const queries = [
    `"${company}" 2026 launches OR announces OR opens OR expands`,
    `"${company}" news 2025 2026 CEO OR CMO OR partnership`,
    `${domain} site:prnewswire.com OR site:businesswire.com 2026`,
  ];
  let best: Fact | null = null;
  for (const q of queries) {
    const hits = await serperSearch(q);
    for (const h of hits) {
      const sc = scoreHit(h, company);
      if (!h.snippet) continue;
      const cand: Fact = {
        text: `${h.title || ''}: ${h.snippet || ''}`.slice(0, 350),
        source: h.link || '',
        score: sc,
      };
      if (!best || sc > best.score) best = cand;
    }
    if (best && best.score >= 6) break;
  }
  return best;
}

interface LeadEnriched {
  full_name: string;
  first_name: string;
  title: string;
  company: string;
  domain: string;
  fact: string;
  source_url: string;
  fact_score: number;
  fact_rich: boolean; // gate result
}

function isFactRich(f: Fact | null): boolean {
  if (!f) return false;
  const blob = f.text.toLowerCase();
  const hasDate = /202[5-6]/.test(blob);
  const hasNoun = /\$[\d.,]+|[\d]+%|\d+\s+\w+|launches|opens|acquires|announces|appoints|named|debuts/.test(blob);
  return hasDate && hasNoun && f.source.length > 0;
}

(async () => {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const lines = readFileSync(leadsPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const headers = splitCsv(lines[0]);
  const idx = (n: string) => headers.indexOf(n);

  const enriched: LeadEnriched[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsv(lines[i]);
    const domain = (cols[idx('company_domain')] || '').replace(/^www\./, '').trim();
    const company = (cols[idx('company_name')] || '').trim();
    const full_name = (cols[idx('full_name')] || '').trim();
    const first_name = (cols[idx('first_name')] || '').trim();
    const title = (cols[idx('current_job_title')] || '').trim();
    if (!domain || !company) continue;
    console.log(`[serper] ${company} (${domain})`);
    const fact = await fetchBestFact(company, domain);
    const rich = isFactRich(fact);
    enriched.push({
      full_name, first_name, title, company, domain,
      fact: fact?.text || '',
      source_url: fact?.source || '',
      fact_score: fact?.score || 0,
      fact_rich: rich,
    });
    if (!rich) console.warn(`  [thin] ${company} — fact-richness gate failed (score ${fact?.score || 0})`);
  }

  writeFileSync(join(outDir, 'facts.json'), JSON.stringify(enriched, null, 2), 'utf8');
  console.log(`\nfacts saved: ${enriched.length} leads, ${enriched.filter(e => e.fact_rich).length} fact-rich`);

  // Build batched prompts for the rich leads only
  const rich = enriched.filter(e => e.fact_rich);
  const batches: LeadEnriched[][] = [];
  for (let i = 0; i < rich.length; i += batchSize) batches.push(rich.slice(i, i + batchSize));

  for (let b = 0; b < batches.length; b++) {
    const promptPath = join(outDir, `batch-${b+1}-prompt.txt`);
    const leads = batches[b];
    const promptBody = buildPrompt(leads, vertical, client);
    writeFileSync(promptPath, promptBody, 'utf8');
    console.log(`  batch-${b+1}: ${leads.length} leads -> ${promptPath}`);
  }

  // Also write skipped (thin) leads to a separate file for manual review
  const thin = enriched.filter(e => !e.fact_rich);
  if (thin.length) {
    writeFileSync(join(outDir, 'skipped-thin.json'), JSON.stringify(thin, null, 2), 'utf8');
    console.log(`  skipped-thin: ${thin.length} leads`);
  }

  console.log('\nNext step: dispatch each batch-N-prompt.txt to a sub-agent.');
})();

function buildPrompt(leads: LeadEnriched[], vertical: string, client: string): string {
  const isMythic = client === 'mythic';
  const isBw = client === 'belardi-wong';

  const bwAnchors: Record<string, string> = {
    apparel: 'Bombas, STAUD, Reformation, Vera Bradley, Anthropologie',
    beauty: 'Anthropologie (beauty floor), Bombas, multiple beauty DTC',
    home: 'Serena & Lily, DWR, Schoolhouse, Crate & Barrel, McGee & Co, Peacock Alley',
    athletic: 'Title Nine',
    footwear: 'Birkenstock, Kuru',
    denim: 'AG, Paige',
    food_bev: 'DTC wine clubs',
    lifestyle_apparel: 'Bombas, Vera Bradley, Anthropologie',
  };
  const mythicAnchors = 'Spectrum, MetLife, Ally, Subway, Meineke, Cone Health, Harley-Davidson, UnitedHealthcare';

  const bwVocab = 'catalog cadence, AOV, customer file, mail-acquired vs digital, segmentation, frequency, drops per year, considered purchase, store-and-DTC mix, gifting, subscription';
  const mythicVocab = 'share of voice, category entry points, distinctive brand assets, brand memory, suppressed growth, media mix, geographic concentration, attention-based planning, patient/member acquisition';

  const bwStats = '103% LTV mail-acquired vs digital, 3-8x ROAS new customers, 20-30% productivity lift year one';
  const mythicPositioning = 'Free Growth Codes audit (public-data brand+media analysis), 30-min walkthrough by senior strategist Scott Luther';

  const vocab = isMythic ? mythicVocab : bwVocab;
  const anchors = isMythic ? mythicAnchors : (bwAnchors[vertical] || '');
  const positioning = isMythic ? mythicPositioning : bwStats;

  const leadBlock = leads.map((l, i) => `LEAD ${i+1}
  Name: ${l.first_name} (${l.full_name})
  Title: ${l.title}
  Company: ${l.company}
  Domain: ${l.domain}
  FACT (weave into E1): ${l.fact}
  SOURCE: ${l.source_url}
`).join('\n');

  return `Write 4-email ${isMythic ? 'Mythic (Charlotte brand+performance agency)' : 'Belardi Wong (premium DTC direct mail agency, 25 years, 300+ brands)'} cold sequences for ${leads.length} leads. DO NOT use WebSearch. Use the FACT given inline per lead.

CLIENT POSITIONING: ${positioning}
ANCHOR/CLIENT BRANDS: ${anchors}

${leadBlock}

RULES per email (strict):
- E1: 60-90 words, lowercase opener "[first], " — weave the FACT into the opening — ONE specific fact (the one given) — NO em dashes, NO exclamations, NO bullets — do NOT mention ${isMythic ? 'Mythic or Growth Codes' : 'Belardi Wong or direct mail or catalog'} in the first 3 sentences — END with a question
- E2: 40-70 words, empty subject (threaded reply), reference fact in different angle
- E3: 40-70 words, new subject, third angle (case study or comp)
- E4: 40-70 words, soft close, subject must be "re: {e1_subject}"

VOCAB IN: ${vocab}
VOCAB OUT: leverage, synergy, ROI, pipeline, conversion rate, guarantee, "I noticed", "I came across", "hope this finds you well"

OUTPUT strict JSON array of ${leads.length} objects:
{
  "lead": "First Last / Company",
  "domain": "...",
  "title": "...",
  "vertical": "${vertical}",
  "client": "${client}",
  "dossier_summary": "2-3 sentence summary using the fact",
  "source_urls": ["..."],
  "email1": {"subject": "...", "body": "..."},
  "email2": {"subject": "", "body": "..."},
  "email3": {"subject": "...", "body": "..."},
  "email4": {"subject": "re: {e1 subject}", "body": "..."}
}`;
}
