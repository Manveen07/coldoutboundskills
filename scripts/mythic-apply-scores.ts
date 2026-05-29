#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// mythic-apply-scores.ts -- Apply pre-computed ICP scores to leads CSV
//
// Usage:
//   npx tsx scripts/mythic-apply-scores.ts \
//     --scores data/mythic-qsr-scores.json \
//     --input profiles/mythic/campaigns/growth-codes/data/leads-raw-qsr.csv \
//     --output profiles/mythic/campaigns/growth-codes/data/leads-scored-qsr.csv \
//     --min-confidence 0.7
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { parseCsv, writeCsvWithExtra } from './_csv_io';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, def = '') => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };
  return {
    scores:        get('--scores'),
    input:         get('--input'),
    output:        get('--output'),
    minConfidence: parseFloat(get('--min-confidence', '0.65')),
  };
}

const { scores: scoresPath, input, output, minConfidence } = parseArgs();
if (!scoresPath || !input || !output) {
  console.error('Usage: npx tsx scripts/mythic-apply-scores.ts --scores <json> --input <csv> --output <csv>');
  process.exit(1);
}

// Load scores -- keyed by domain
const scoresRaw = JSON.parse(readFileSync(resolve(process.cwd(), scoresPath), 'utf8'));
const scoreMap = new Map<string, { qualified: boolean; confidence: number; reason: string }>();

function ingestBatch(batch: any[]) {
  for (const s of batch) {
    const d = (s.domain ?? '').toLowerCase().replace(/^www\./, '');
    if (d) scoreMap.set(d, { qualified: s.qualified, confidence: s.confidence, reason: s.reason });
  }
}

// Handle both flat array and {batch1, batch2...} format
if (Array.isArray(scoresRaw)) {
  ingestBatch(scoresRaw);
} else {
  for (const key of Object.keys(scoresRaw)) {
    if (Array.isArray(scoresRaw[key])) ingestBatch(scoresRaw[key]);
  }
}

const { rows } = parseCsv(readFileSync(resolve(process.cwd(), input), 'utf8'));
const qualified: Record<string, string>[] = [];
const rejected: Record<string, string>[] = [];
let unscored = 0;

for (const row of rows) {
  const domain = (row.company_domain ?? '').toLowerCase().replace(/^www\./, '');
  const score = scoreMap.get(domain);
  if (!score) { unscored++; rejected.push({ ...row, icp_qualified: 'unknown', icp_confidence: '0', icp_reason: 'not scored' }); continue; }
  const enriched = { ...row, icp_qualified: String(score.qualified), icp_confidence: String(score.confidence), icp_reason: score.reason };
  if (score.qualified && score.confidence >= minConfidence) {
    qualified.push(enriched);
  } else {
    rejected.push(enriched);
  }
}

const extraCols = ['icp_qualified', 'icp_confidence', 'icp_reason'];

const outDir = dirname(output);
if (!existsSync(resolve(process.cwd(), outDir))) mkdirSync(resolve(process.cwd(), outDir), { recursive: true });

writeFileSync(resolve(process.cwd(), output), writeCsvWithExtra(qualified, extraCols), 'utf8');
writeFileSync(resolve(process.cwd(), output.replace('.csv', '-rejected.csv')), writeCsvWithExtra(rejected, extraCols), 'utf8');

console.log(`Scored: ${rows.length} total, ${qualified.length} qualified (>= ${minConfidence}), ${rejected.length} rejected, ${unscored} unscored`);
console.log(`Output: ${output}`);
