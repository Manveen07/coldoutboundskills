#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// mythic-render.ts -- Email renderer for Mythic Growth Codes campaign
//
// Reads scored+signal-enriched leads CSV, renders 4-email sequences
// using variants.yaml copy templates. Writes final CSV ready for Smartlead upload.
//
// Usage:
//   npx tsx scripts/mythic-render.ts \
//     --input profiles/mythic/campaigns/growth-codes/data/leads-with-signals-qsr.csv \
//     --signals profiles/mythic/campaigns/growth-codes/data/signals-qsr \
//     --output profiles/mythic/campaigns/growth-codes/data/leads-final-qsr.csv
//
// Variant assignment:
//   A -- lead has funding or press signal (franchise/growth angle)
//   B -- lead has company_snippet signal (performance-over-brand angle)
//   C -- fallback (no signal)
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { parseCsv, writeCsvWithExtra } from './_csv_io';
import { readSidecar } from './_lib_signals';
import { makeAutoInvoker } from './_openrouter_invoker';

function loadEnv(): Record<string, string> {
  try {
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
  } catch { return {}; }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, def = '') => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };
  return {
    input:   get('--input'),
    signals: get('--signals'),
    output:  get('--output'),
  };
}

// ---------------------------------------------------------------------------
// Bridge prompt builders — one per variant
// ---------------------------------------------------------------------------
function buildBridgePromptA(signalFact: string, companyName: string, category: string): string {
  return `Write a single bridge sentence (max 22 words) that connects this signal to the idea that ${companyName}'s media spend may not match where their actual growth opportunity is geographically.

Signal: "${signalFact}"
Category: ${category}

Rules:
- No em dashes
- No exclamation points
- Peer-to-peer tone, senior strategist to senior marketing leader
- Do not mention Mythic or Growth Codes
- Start with the brand name or a specific observation about them
- Output ONLY the bridge sentence, nothing else`;
}

function buildBridgePromptB(signalFact: string, companyName: string): string {
  return `Write a single bridge sentence (max 22 words) that connects this signal to the idea that ${companyName} may be over-indexed on performance marketing at the expense of brand building.

Signal: "${signalFact}"

Rules:
- No em dashes
- No exclamation points
- Peer-to-peer tone, senior strategist to senior marketing leader
- Do not mention Mythic or Growth Codes
- Use vocabulary: share of voice, brand memory, category entry points, suppressed growth
- Output ONLY the bridge sentence, nothing else`;
}

// ---------------------------------------------------------------------------
// Email builders using variants.yaml copy
// ---------------------------------------------------------------------------
function buildEmail1A(firstName: string, companyName: string, signalFact: string, signalBridge: string): string {
  return `${firstName}, ${signalFact}.

${signalBridge}

We ran the Growth Codes audit on ${companyName} using public data and competitive benchmarking across your category. There are a few decisions in your media mix that look like they are suppressing topline growth, and one of them has to do with how your spend maps to your actual footprint.

Worth a 30-minute call? We already ran the audit -- happy to walk you through what we found.`;
}

function buildEmail1B(firstName: string, companyName: string, signalFact: string, signalBridge: string): string {
  return `${firstName}, ${signalFact}.

${signalBridge}

We ran the Growth Codes audit on ${companyName} using public data and competitive benchmarking. What we found: there are decisions being made in your media mix that are driving short-term performance but limiting how much brand memory you are building in your category. That gap tends to widen over time.

Worth a 30-minute call to walk through the findings? No pitch -- just what the data showed.`;
}

function buildEmail1C(firstName: string, companyName: string, brandCategory: string): string {
  return `${firstName}, we ran the Growth Codes audit on ${companyName} using public data and competitive benchmarking across the ${brandCategory} category.

The intent is not to give you a prescription on what to go do. It is to surface whether there are decisions being made -- intentionally or not -- that are contributing to suppressed growth.

Worth a 30-minute call to walk through what we found?`;
}

function buildEmail2(firstName: string, companyName: string): string {
  return `${firstName}, one data point from the audit that tends to resonate with brands at ${companyName}'s scale: the gap between where brands concentrate their media spend and where their actual growth opportunity is geographically tends to be larger than most marketing leaders realize.

We see it across the category. Happy to show you how ${companyName} maps against the benchmarks.`;
}

function buildEmail3(firstName: string, companyName: string, brandCategory: string): string {
  return `${firstName}, one pattern we are seeing across the ${brandCategory} category right now: the brands gaining share of voice are not necessarily the ones spending more. They are the ones making their media work harder by leaning into category entry points and distinctive brand assets rather than competing on spend alone.

${companyName} has the raw material to do that. The audit surfaced a few specific places where that shift could happen.

Worth 30 minutes?`;
}

function buildEmail4(firstName: string, companyName: string): string {
  return `${firstName}, last note from me. The Growth Codes audit findings on ${companyName} are ready whenever the timing works. If brand and media strategy is not yours to own right now, happy to loop in the right person on your team instead.

Either way, appreciate the time.`;
}

// ---------------------------------------------------------------------------
// Variant assignment
// ---------------------------------------------------------------------------
function assignVariant(signalUsed: string): 'A' | 'B' | 'C' {
  if (signalUsed === 'funding' || signalUsed === 'press' || signalUsed === 'acquisition') return 'A';
  if (signalUsed === 'company_snippet') return 'B';
  return 'C';
}

function inferBrandCategory(industry: string, companyName: string): string {
  if (/restaurant|qsr|food/i.test(industry)) return 'restaurant';
  if (/retail apparel|fashion/i.test(industry)) return 'retail apparel';
  if (/automotive/i.test(industry)) return 'automotive';
  if (/hospital|health/i.test(industry)) return 'healthcare';
  if (/hospitality/i.test(industry)) return 'hospitality';
  if (/financial|bank|insurance/i.test(industry)) return 'financial services';
  return 'consumer';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const { input, signals, output } = parseArgs();
if (!input || !signals || !output) {
  console.error('Usage: npx tsx scripts/mythic-render.ts --input <csv> --signals <dir> --output <csv>');
  process.exit(1);
}

const env = loadEnv();
const aiInvoke = makeAutoInvoker(env.OPENROUTER_API_KEY, 'data/bridge-responses-mythic');

const inputPath  = resolve(process.cwd(), input);
const signalsDir = resolve(process.cwd(), signals);
const outputPath = resolve(process.cwd(), output);

if (!existsSync(inputPath)) { console.error(`Input not found: ${inputPath}`); process.exit(1); }

const { rows } = parseCsv(readFileSync(inputPath, 'utf8'));
const rendered: Record<string, any>[] = [];
let done = 0;

for (const lead of rows) {
  if (!lead.person_id) continue;

  const domain  = (lead.company_domain ?? '').toLowerCase().replace(/^www\./, '');
  const sidecar = readSidecar(domain, signalsDir);

  const signalUsed = lead.signal_used || (sidecar?.available_signals?.[0] ?? 'fallback');
  const variant    = assignVariant(signalUsed);
  const category   = inferBrandCategory(lead.company_industry ?? '', lead.company_name ?? '');

  const firstName   = lead.first_name || (lead.full_name ?? '').split(' ')[0] || 'there';
  const companyName = lead.company_name ?? '';

  // Extract signal fact from sidecar
  // ExtractedFact is { fact: string, fact_date?, freshness_days? } -- unwrap .fact if nested
  function unwrapFact(f: any): string {
    if (!f) return '';
    if (typeof f === 'string') return f;
    if (typeof f === 'object' && typeof f.fact === 'string') return f.fact;
    if (typeof f === 'object' && typeof f.fact === 'object') return f.fact?.fact ?? '';
    return String(f);
  }

  let signalFact = '';
  if (signalUsed === 'funding' && sidecar?.funding?.fact)          signalFact = unwrapFact(sidecar.funding.fact);
  else if (signalUsed === 'press' && sidecar?.press?.[0]?.fact)    signalFact = unwrapFact(sidecar.press[0].fact);
  else if (signalUsed === 'company_snippet' && sidecar?.company_snippet?.fact) signalFact = unwrapFact(sidecar.company_snippet.fact);
  else if (signalUsed === 'acquisition' && sidecar?.acquisition?.fact) signalFact = unwrapFact(sidecar.acquisition.fact);

  // Generate bridge via AI (OpenRouter if available, else placeholder)
  let signalBridge = '';
  if (signalFact && (variant === 'A' || variant === 'B')) {
    try {
      const prompt = variant === 'A'
        ? buildBridgePromptA(signalFact, companyName, category)
        : buildBridgePromptB(signalFact, companyName);
      signalBridge = await aiInvoke(prompt, { person_id: lead.person_id });
    } catch {
      signalBridge = '';
    }
  }

  // Build emails
  let e1body = '', e1subject = '', e2body = '', e3body = '', e4body = '';
  const e2subject = '';
  const e3subject = `re: what we found on ${companyName}`;
  const e4subject = `re: what we found on ${companyName}`;

  if (variant === 'A') {
    e1subject = `what we found on ${companyName}`;
    e1body    = buildEmail1A(firstName, companyName, signalFact, signalBridge);
  } else if (variant === 'B') {
    e1subject = `brand vs performance at ${companyName}`;
    e1body    = buildEmail1B(firstName, companyName, signalFact, signalBridge);
  } else {
    e1subject = `Growth Codes audit on ${companyName}`;
    e1body    = buildEmail1C(firstName, companyName, category);
  }

  e2body = buildEmail2(firstName, companyName);
  e3body = buildEmail3(firstName, companyName, category);
  e4body = buildEmail4(firstName, companyName);

  rendered.push({
    ...lead,
    assigned_variant:   variant,
    signal_used:        signalUsed,
    signal_fact:        signalFact,
    signal_bridge:      signalBridge,
    email1_subject:     e1subject,
    email1_body:        e1body,
    email2_subject:     e2subject,
    email2_body:        e2body,
    email3_subject:     e3subject,
    email3_body:        e3body,
    email4_subject:     e4subject,
    email4_body:        e4body,
  });

  done++;
  if (done % 10 === 0) console.error(`Rendered ${done}/${rows.length}...`);
}

const outDir = dirname(outputPath);
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const extraCols = [
  'assigned_variant', 'signal_used', 'signal_fact', 'signal_bridge',
  'email1_subject', 'email1_body',
  'email2_subject', 'email2_body',
  'email3_subject', 'email3_body',
  'email4_subject', 'email4_body',
];
writeFileSync(outputPath, writeCsvWithExtra(rendered, extraCols), 'utf8');

const variantCounts = rendered.reduce((acc, r) => { acc[r.assigned_variant] = (acc[r.assigned_variant] || 0) + 1; return acc; }, {} as Record<string, number>);
console.error('');
console.error('=== Mythic render summary ===');
console.error(`Total rendered: ${rendered.length}`);
console.error(`Variant A (franchise signal): ${variantCounts.A ?? 0}`);
console.error(`Variant B (performance signal): ${variantCounts.B ?? 0}`);
console.error(`Variant C (fallback): ${variantCounts.C ?? 0}`);
console.error(`Output: ${outputPath}`);
