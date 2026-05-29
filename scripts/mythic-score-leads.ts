#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// mythic-score-leads.ts -- ICP qualifier for Mythic Growth Codes campaign
//
// Reads a raw leads CSV, scores each company against icp-prompt.txt using
// Claude Code Task sub-agents (no external API cost), writes scored CSV.
//
// Usage:
//   npx tsx scripts/mythic-score-leads.ts \
//     --input profiles/mythic/campaigns/growth-codes/data/leads-raw-qsr.csv \
//     --output profiles/mythic/campaigns/growth-codes/data/leads-scored-qsr.csv
//
// Optional:
//   --batch-size 10   (companies per sub-agent, default 10)
//   --min-confidence 0.6  (discard below this threshold, default 0.6)
//   --prompt profiles/mythic/icp-prompt.txt  (default path)
//
// Output CSV adds columns: icp_qualified, icp_confidence, icp_reason
// Keeps only qualified=true AND confidence >= min_confidence rows.
// Writes a _rejected.csv sidecar with disqualified leads for reference.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parseCsv, writeCsv } from './_csv_io';

function parseArgs(): { input: string; output: string; batchSize: number; minConfidence: number; promptPath: string } {
  const args = process.argv.slice(2);
  const get = (flag: string, def: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : def;
  };
  const input = get('--input', '');
  const output = get('--output', '');
  const batchSize = parseInt(get('--batch-size', '10'), 10);
  const minConfidence = parseFloat(get('--min-confidence', '0.6'));
  const promptPath = get('--prompt', 'profiles/mythic/icp-prompt.txt');
  if (!input) throw new Error('--input is required');
  if (!output) throw new Error('--output is required');
  return { input, output, batchSize, minConfidence, promptPath };
}

function deduplicateByDomain(rows: Record<string, string>[]): Record<string, string>[] {
  const seen = new Set<string>();
  const out: Record<string, string>[] = [];
  for (const row of rows) {
    const domain = (row.company_domain ?? '').toLowerCase().replace(/^www\./, '');
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    out.push(row);
  }
  return out;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function buildScoringPrompt(icpPrompt: string, companies: Record<string, string>[]): string {
  const companyList = companies.map((c, i) =>
    `${i + 1}. {"name":"${c.full_name ?? ''}","title":"${c.current_job_title ?? ''}","company":"${c.company_name ?? ''}","domain":"${c.company_domain ?? ''}","industry":"${c.company_industry ?? ''}","headcount":"${c.company_headcount_range ?? ''}"}`
  ).join('\n');

  return `${icpPrompt}

## Companies to evaluate

${companyList}

## Output
Return ONLY a JSON array of ${companies.length} objects in the same order:
{"company": "", "domain": "", "qualified": true/false, "confidence": 0.0-1.0, "reason": "one sentence"}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const { input, output, batchSize, minConfidence, promptPath } = parseArgs();

const inputPath = resolve(process.cwd(), input);
const outputPath = resolve(process.cwd(), output);
const rejectedPath = outputPath.replace('.csv', '-rejected.csv');
const icpPromptPath = resolve(process.cwd(), promptPath);

if (!existsSync(inputPath)) { console.error(`Input not found: ${inputPath}`); process.exit(1); }
if (!existsSync(icpPromptPath)) { console.error(`ICP prompt not found: ${icpPromptPath}`); process.exit(1); }

const icpPrompt = readFileSync(icpPromptPath, 'utf8');
const { rows } = parseCsv(readFileSync(inputPath, 'utf8'));

// Deduplicate by domain -- score each company once
const uniqueRows = deduplicateByDomain(rows);
const batches = chunkArray(uniqueRows, batchSize);

console.log(`Input: ${rows.length} leads, ${uniqueRows.length} unique domains, ${batches.length} batches of ${batchSize}`);
console.log(`ICP prompt: ${icpPromptPath}`);
console.log(`Min confidence threshold: ${minConfidence}`);
console.log('');

// Build domain -> score map from scored results
const scoreMap = new Map<string, { qualified: boolean; confidence: number; reason: string }>();

for (let i = 0; i < batches.length; i++) {
  const batch = batches[i];
  const prompt = buildScoringPrompt(icpPrompt, batch);

  console.log(`Batch ${i + 1}/${batches.length} (${batch.length} companies)...`);

  // Write prompt to temp file so user can run manually or pipe to Claude
  const tempPromptPath = resolve(process.cwd(), `.tmp-scoring-batch-${i + 1}.txt`);
  writeFileSync(tempPromptPath, prompt, 'utf8');
  console.log(`  Prompt written to: ${tempPromptPath}`);
  console.log(`  Run: npx claude --print < ${tempPromptPath} >> .tmp-scores.jsonl`);
  console.log('');
}

console.log('');
console.log('All batch prompts written. To score automatically:');
console.log('  Set ANTHROPIC_API_KEY and run: npx tsx scripts/mythic-score-leads.ts --input ... --output ... --auto');
console.log('');
console.log('Or to score manually: paste each .tmp-scoring-batch-N.txt into Claude and');
console.log('  copy the JSON array response into .tmp-scores.jsonl (one array per line).');
console.log('  Then run: npx tsx scripts/mythic-apply-scores.ts --scores .tmp-scores.jsonl --input ... --output ...');

// ---------------------------------------------------------------------------
// If --auto flag: use OpenRouter to score (costs OpenRouter credits, not Prospeo)
// ---------------------------------------------------------------------------
if (process.argv.includes('--auto')) {
  const openRouterKey = (() => {
    try {
      const env = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
      for (const line of env.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq === -1) continue;
        const [k, ...v] = t.split('=');
        if (k.trim() === 'OPENROUTER_API_KEY') return v.join('=').trim().replace(/^["']|["']$/g, '');
      }
    } catch { /* ignore */ }
    return null;
  })();

  if (!openRouterKey) {
    console.error('--auto requires OPENROUTER_API_KEY in .env');
    process.exit(1);
  }

  console.log('Auto mode: scoring via OpenRouter (haiku-4-5)...');
  console.log('');

  const qualified: Record<string, string>[] = [];
  const rejected: Record<string, string>[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const prompt = buildScoringPrompt(icpPrompt, batch);

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      }),
    });

    if (!res.ok) {
      console.error(`Batch ${i + 1} OpenRouter error: ${res.status} ${await res.text()}`);
      continue;
    }

    const data: any = await res.json();
    const text = data.choices?.[0]?.message?.content ?? '';

    let scores: Array<{ company: string; domain: string; qualified: boolean; confidence: number; reason: string }> = [];
    try {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) scores = JSON.parse(match[0]);
    } catch {
      console.error(`Batch ${i + 1}: failed to parse JSON from response`);
      continue;
    }

    // Build domain score map
    for (const score of scores) {
      const d = (score.domain ?? '').toLowerCase().replace(/^www\./, '');
      scoreMap.set(d, { qualified: score.qualified, confidence: score.confidence, reason: score.reason });
    }

    console.log(`Batch ${i + 1}/${batches.length}: ${scores.filter(s => s.qualified).length}/${scores.length} qualified`);
    await new Promise(r => setTimeout(r, 500));
  }

  // Apply scores back to all rows (including dupes -- same domain gets same score)
  for (const row of rows) {
    const domain = (row.company_domain ?? '').toLowerCase().replace(/^www\./, '');
    const score = scoreMap.get(domain);
    if (!score) {
      // Unscored -- put in rejected
      rejected.push({ ...row, icp_qualified: 'unknown', icp_confidence: '0', icp_reason: 'not scored' });
      continue;
    }
    const enriched = { ...row, icp_qualified: String(score.qualified), icp_confidence: String(score.confidence), icp_reason: score.reason };
    if (score.qualified && score.confidence >= minConfidence) {
      qualified.push(enriched);
    } else {
      rejected.push(enriched);
    }
  }

  const extraCols = ['icp_qualified', 'icp_confidence', 'icp_reason'];
  writeFileSync(outputPath, writeCsv(qualified, extraCols), 'utf8');
  writeFileSync(rejectedPath, writeCsv(rejected, extraCols), 'utf8');

  console.log('');
  console.log('=== Scoring complete ===');
  console.log(`Total input leads:  ${rows.length}`);
  console.log(`Unique domains:     ${uniqueRows.length}`);
  console.log(`Qualified (>= ${minConfidence}): ${qualified.length}`);
  console.log(`Rejected:           ${rejected.length}`);
  console.log(`Output:             ${outputPath}`);
  console.log(`Rejected sidecar:   ${rejectedPath}`);
}
