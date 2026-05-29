#!/usr/bin/env tsx
// Aggregate all per-batch email JSON files into per-vertical CSVs.
// Joins emails + Serper facts + ICP scoring for full reasoning trail.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

const root = process.cwd();
const runDir = resolve(root, 'data/runs/showcase-2026-05-28');
const emailsDir = join(runDir, 'emails');
const factsDir = join(runDir, 'facts');
const scoringDir = join(runDir, 'scoring');
const scoringP2Dir = join(runDir, 'scoring-p2');
const icpBackfillDir = join(runDir, 'icp-backfill-results');
const finalDir = join(runDir, 'final');
if (!existsSync(finalDir)) mkdirSync(finalDir, { recursive: true });

function normDomain(d: string): string {
  return (d || '').toLowerCase().replace(/^www\./, '').trim();
}

// Load all facts JSONs (Serper signal data per lead)
interface FactRow { domain: string; company_name: string; full_name: string; title: string; fact: string; fact_source: string; }
const factsByDomain = new Map<string, FactRow>();
if (existsSync(factsDir)) {
  for (const f of readdirSync(factsDir).filter(f => f.endsWith('.json'))) {
    try {
      const arr: FactRow[] = JSON.parse(readFileSync(join(factsDir, f), 'utf8'));
      for (const r of arr) {
        const d = normDomain(r.domain);
        if (d) factsByDomain.set(d, r);
      }
    } catch {}
  }
}

// Load all ICP scoring JSONs
interface ScoreRow { domain?: string; name?: string; qualified?: boolean; confidence?: number; reason?: string; icp_qualified?: boolean | string; icp_confidence?: number | string; icp_reason?: string; relevance_summary?: string; }
const scoresByDomain = new Map<string, ScoreRow>();
for (const dir of [scoringDir, scoringP2Dir, icpBackfillDir]) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    try {
      const arr: ScoreRow[] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      for (const r of arr) {
        const d = normDomain(r.domain || '');
        if (d) scoresByDomain.set(d, r);
      }
    } catch {}
  }
}

interface LeadEmail {
  lead: string;
  domain: string;
  title: string;
  vertical: string;
  client: string;
  dossier_summary: string;
  source_urls: string[];
  email1: { subject: string; body: string };
  email2: { subject: string; body: string };
  email3: { subject: string; body: string };
  email4: { subject: string; body: string };
}

const all: LeadEmail[] = [];
const files = readdirSync(emailsDir).filter(f => f.endsWith('.json'));

for (const f of files) {
  try {
    const raw = readFileSync(join(emailsDir, f), 'utf8');
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const it of items) {
      const lead: LeadEmail = {
        lead: it.lead || '',
        domain: it.domain || '',
        title: it.title || '',
        vertical: it.vertical || '',
        client: it.client || '',
        dossier_summary: it.dossier_summary || '',
        source_urls: Array.isArray(it.source_urls) ? it.source_urls : [],
        email1: normalizeEmail(it.email1),
        email2: normalizeEmail(it.email2),
        email3: normalizeEmail(it.email3),
        email4: normalizeEmail(it.email4),
      };
      if (lead.lead && lead.vertical && lead.client) all.push(lead);
    }
  } catch (e: any) {
    console.warn(`failed to parse ${f}: ${e.message}`);
  }
}

function normalizeEmail(e: any): { subject: string; body: string } {
  if (!e) return { subject: '', body: '' };
  if (typeof e === 'string') return { subject: '', body: e };
  return { subject: e.subject || '', body: e.body || '' };
}

function csvEscape(s: string): string {
  if (s == null) return '';
  const needsQuote = /[",\n\r]/.test(s);
  const esc = s.replace(/"/g, '""');
  return needsQuote ? `"${esc}"` : esc;
}

// Detect anchor brand used in email1 body
const BW_ANCHORS = ['Serena & Lily', 'serena & lily', 'serena and lily', 'DWR', 'design within reach', 'Schoolhouse', 'schoolhouse', 'Crate & Barrel', 'crate & barrel', 'crate and barrel', 'McGee & Co', 'mcgee & co', 'Peacock Alley', 'peacock alley', 'Bombas', 'bombas', 'STAUD', 'staud', 'Reformation', 'reformation', 'Vera Bradley', 'vera bradley', 'Anthropologie', 'anthropologie', 'Title Nine', 'title nine', 'Birkenstock', 'birkenstock', 'Kuru', 'kuru', 'AG', 'Paige', 'paige'];
const MYTHIC_ANCHORS = ['Spectrum', 'spectrum', 'MetLife', 'metlife', 'Ally', 'ally', 'Subway', 'subway', 'Meineke', 'meineke', 'Cone Health', 'cone health', 'Harley-Davidson', 'harley-davidson', 'Harley', 'harley', 'UnitedHealthcare', 'unitedhealthcare'];

function detectAnchor(text: string, client: string): string {
  const pool = client === 'mythic' ? MYTHIC_ANCHORS : BW_ANCHORS;
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const a of pool) {
    if (lower.includes(a.toLowerCase())) found.add(a.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' '));
  }
  return Array.from(found).join(' | ');
}

const headers = [
  'client', 'vertical', 'lead', 'domain', 'title',
  'dossier_summary',
  'signal_fact', 'signal_source',
  'icp_confidence', 'icp_reason', 'relevance_summary',
  'anchors_used',
  'source_urls',
  'email1_subject', 'email1_body',
  'email2_subject', 'email2_body',
  'email3_subject', 'email3_body',
  'email4_subject', 'email4_body',
];

function rowFor(l: LeadEmail): string {
  const d = normDomain(l.domain);
  const fact = factsByDomain.get(d);
  const score = scoresByDomain.get(d);
  const allBodies = `${l.email1.body} ${l.email2.body} ${l.email3.body} ${l.email4.body}`;
  const anchors = detectAnchor(allBodies, l.client);
  const conf = score?.icp_confidence ?? score?.confidence ?? '';
  const reason = score?.icp_reason ?? score?.reason ?? '';
  const relevance = score?.relevance_summary ?? '';
  return [
    l.client, l.vertical, l.lead, l.domain, l.title,
    l.dossier_summary,
    fact?.fact || '',
    fact?.fact_source || '',
    String(conf),
    reason,
    relevance,
    anchors,
    l.source_urls.join(' | '),
    l.email1.subject, l.email1.body,
    l.email2.subject, l.email2.body,
    l.email3.subject, l.email3.body,
    l.email4.subject, l.email4.body,
  ].map(csvEscape).join(',');
}

const byVertical = new Map<string, LeadEmail[]>();
for (const l of all) {
  const k = `${l.client}-${l.vertical}`;
  if (!byVertical.has(k)) byVertical.set(k, []);
  byVertical.get(k)!.push(l);
}

let totalRows = 0;
for (const [key, leads] of byVertical) {
  const rows = [headers.join(',')];
  for (const l of leads) rows.push(rowFor(l));
  const outPath = join(finalDir, `${key}.csv`);
  writeFileSync(outPath, rows.join('\n'), 'utf8');
  console.log(`${key}: ${leads.length} leads -> ${outPath}`);
  totalRows += leads.length;
}

const masterRows = [headers.join(',')];
for (const l of all) masterRows.push(rowFor(l));
writeFileSync(join(finalDir, '_master.csv'), masterRows.join('\n'), 'utf8');

// Diagnostic: how many have signal_fact + icp_confidence joined
const joined = all.filter(l => factsByDomain.has(normDomain(l.domain))).length;
const scored = all.filter(l => scoresByDomain.has(normDomain(l.domain))).length;

const summary = Array.from(byVertical.entries()).map(([k, v]) => ({ key: k, count: v.length }));
writeFileSync(join(finalDir, '_summary.json'), JSON.stringify({ total: totalRows, byVertical: summary, joined_with_facts: joined, joined_with_scores: scored }, null, 2), 'utf8');

console.log(`\nTOTAL: ${totalRows} leads across ${byVertical.size} vertical files`);
console.log(`Joined with signal facts: ${joined}/${totalRows}`);
console.log(`Joined with ICP scores: ${scored}/${totalRows}`);
console.log(`Master CSV: ${join(finalDir, '_master.csv')}`);
