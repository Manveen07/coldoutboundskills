#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// build-list.ts — Mode A list-builder orchestrator (filters -> qualified CSV).
//
// Pipeline:
//   1. pull     — phase-prospeo (subprocess) from a Prospeo filters JSON
//   2. suppress — static exclude + ledger (+ optional Smartlead)
//   3. enrich   — email waterfall + MillionVerifier (phase-enrich subprocess)
//   4. score    — writes subagent prompt files (controller dispatches them)
//   5. merge    — after subagents return, merge + write qualified.csv
//   6. ledger   — append survivors
//
// Two invocations:
//   Stage 1 (pull -> prompts):  npx tsx build-list.ts --filters=f.json --client=mythic
//                               (stops after writing score prompts; prints next step)
//   Stage 2 (merge -> csv):     npx tsx build-list.ts --finalize --run=<runDir>
//
// Isolation: imports shared clients read-only; never touches scripts/pipeline/*.
// Scoring engine = subagent only (--engine=api errors).
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { execFileSync } from 'child_process';
import { parseCsv, writeCsv } from '../_csv_io';
import { suppress, Lead as SuppressLead } from './_suppress';
import { enrichAndValidate } from './_enrich';
import {
  resolveIcpPrompt,
  prepScorePrompts,
  mergeScoreResults,
  ScoreLead,
} from './_score';
import { appendToLedger } from './_ledger';

const root = process.cwd();

function arg(name: string, def?: string): string | undefined {
  const args = process.argv.slice(2);
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return def;
  if (hit.includes('=')) return hit.split('=').slice(1).join('=');
  return 'true';
}

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// Map phase-prospeo lead shape -> list-builder shape
function mapProspeoLead(l: any): any {
  return {
    full_name: l.full_name || `${l.first_name || ''} ${l.last_name || ''}`.trim(),
    first_name: l.first_name || '',
    last_name: l.last_name || '',
    title: l.job_title || l.title || '',
    company_name: l.company_name || '',
    domain: l.company_domain || l.domain || '',
    email: l.email || '',
    headcount: l.company_headcount || '',
    industry: l.company_industry || '',
    company_description: l.company_description || '',
    source: 'prospeo',
  };
}

const OUTPUT_HEADERS = [
  'full_name', 'title', 'company_name', 'domain', 'email', 'email_status',
  'icp_qualified', 'icp_confidence', 'icp_reason', 'relevance_signal',
  'source', 'pulled_at',
];

async function stage1() {
  const filtersPath = arg('filters');
  const client = arg('client');
  const icpPromptPath = arg('icp-prompt');
  const icpDescription = arg('icp-desc');
  const maxLeads = Number(arg('max-leads', '300'));
  const excludeCsv = arg('exclude-csv');
  const suppressSmartlead = arg('suppress-smartlead') === 'true';
  const engine = arg('engine', 'subagent');

  if (engine !== 'subagent') {
    console.error(`[build-list] engine "${engine}" not supported. Only subagent for now.`);
    process.exit(1);
  }
  if (!filtersPath || !existsSync(filtersPath)) {
    console.error('[build-list] --filters=<prospeo-filters.json> required (Stage 1)');
    process.exit(1);
  }

  const runDir = resolve(root, `data/list-builder/runs/${ts()}`);
  mkdirSync(runDir, { recursive: true });

  // 1. pull
  const leadsFile = join(runDir, 'pulled.json');
  console.error('[build-list] Stage 1.1 — Prospeo pull...');
  execFileSync(
    'npx',
    [
      'tsx',
      resolve(root, 'skills/auto-research-public/scripts/phase-prospeo.ts'),
      `--filters-file=${filtersPath}`,
      `--max-leads=${maxLeads}`,
      `--out=${leadsFile}`,
    ],
    { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' }
  );
  const pulledRaw = JSON.parse(readFileSync(leadsFile, 'utf8'));
  const pulled = (pulledRaw.leads || pulledRaw).map(mapProspeoLead);
  console.error(`[build-list] pulled ${pulled.length}`);

  // 2. suppress
  console.error('[build-list] Stage 1.2 — suppression...');
  const excludedDomains = client ? loadClientExcludes(client) : [];
  const { kept, report } = await suppress(pulled as SuppressLead[], {
    excludeCsvPath: excludeCsv,
    excludedDomains,
    suppressSmartlead,
    smartleadApiKey: process.env.SMARTLEAD_API_KEY,
  });
  console.error(`[build-list] suppression: ${JSON.stringify(report)}`);

  // 3. enrich
  console.error('[build-list] Stage 1.3 — enrich + validate...');
  const { withEmail, stats } = enrichAndValidate(kept, join(runDir, 'enrich'));
  console.error(`[build-list] enrich stats: ${JSON.stringify(stats)}`);

  // 4. score prompts
  console.error('[build-list] Stage 1.4 — writing score prompts...');
  const icpPrompt = resolveIcpPrompt({ icpPromptPath, client, icpDescription });
  const scoreLeads: ScoreLead[] = withEmail.map((l) => ({
    full_name: l.full_name,
    title: l.title,
    company_name: l.company_name,
    domain: l.domain,
    headcount: l.headcount,
    industry: l.industry,
    description: l.company_description,
  }));
  const { promptDir, batchCount } = prepScorePrompts(scoreLeads, icpPrompt, runDir, 20);

  // stash enriched leads for stage 2 join
  writeFileSync(join(runDir, 'enriched-with-email.json'), JSON.stringify(withEmail, null, 2), 'utf8');
  writeFileSync(
    join(runDir, 'run-meta.json'),
    JSON.stringify({ client, filtersPath, maxLeads, report, stats, batchCount, engine }, null, 2),
    'utf8'
  );
  mkdirSync(join(runDir, 'score-results'), { recursive: true });

  console.error('\n=== STAGE 1 DONE ===');
  console.error(`run dir: ${runDir}`);
  console.error(`enriched leads with email: ${withEmail.length}`);
  console.error(`score prompt batches: ${batchCount} in ${promptDir}`);
  console.error('\nNEXT: dispatch one sub-agent per batch-NN.txt, save JSON to score-results/batch-NN.json.');
  console.error(`Then run: npx tsx scripts/list-builder/build-list.ts --finalize --run=${runDir}`);
}

function loadClientExcludes(client: string): string[] {
  const yamlPath = resolve(root, `profiles/${client}/client-profile.yaml`);
  if (!existsSync(yamlPath)) return [];
  const txt = readFileSync(yamlPath, 'utf8');
  // crude YAML list extract under excluded_domains:
  const out: string[] = [];
  const lines = txt.split('\n');
  let inBlock = false;
  for (const line of lines) {
    if (/^\s*excluded_domains\s*:/.test(line)) { inBlock = true; continue; }
    if (inBlock) {
      const m = line.match(/^\s*-\s*([^\s#]+)/);
      if (m) out.push(m[1].replace(/['"]/g, ''));
      else if (/^\S/.test(line)) break; // dedent = block end
    }
  }
  return out;
}

function stage2() {
  const runDir = arg('run');
  if (!runDir || !existsSync(runDir)) {
    console.error('[build-list] --finalize requires --run=<runDir>');
    process.exit(1);
  }
  const minConf = Number(arg('min-confidence', '0.6'));

  const enriched = JSON.parse(
    readFileSync(join(runDir, 'enriched-with-email.json'), 'utf8')
  );
  const byDomain = new Map<string, any>();
  for (const l of enriched) byDomain.set((l.domain || '').toLowerCase(), l);

  const scores = mergeScoreResults(join(runDir, 'score-results'));
  if (!scores.length) {
    console.error('[build-list] no score results found. Dispatch sub-agents first.');
    process.exit(1);
  }

  const meta = JSON.parse(readFileSync(join(runDir, 'run-meta.json'), 'utf8'));
  const now = new Date().toISOString();

  const qualified: any[] = [];
  const rejected: any[] = [];
  for (const s of scores) {
    const lead = byDomain.get((s.domain || '').toLowerCase());
    if (!lead) continue;
    const row = {
      full_name: lead.full_name,
      title: lead.title,
      company_name: lead.company_name,
      domain: lead.domain,
      email: lead.email,
      email_status: lead.email ? 'validated' : 'none',
      icp_qualified: String(s.icp_qualified),
      icp_confidence: String(s.icp_confidence ?? ''),
      icp_reason: s.icp_reason || '',
      relevance_signal: s.relevance_signal || '',
      source: lead.source || 'prospeo',
      pulled_at: now,
    };
    const conf = Number(s.icp_confidence ?? 0);
    if (s.icp_qualified && conf >= minConf) qualified.push(row);
    else rejected.push(row);
  }

  writeFileSync(join(runDir, 'qualified.csv'), writeCsv(qualified, OUTPUT_HEADERS), 'utf8');
  writeFileSync(join(runDir, 'rejected.csv'), writeCsv(rejected, OUTPUT_HEADERS), 'utf8');

  const added = appendToLedger(
    qualified.map((q) => ({ domain: q.domain, email: q.email })),
    meta.client || 'generic',
    'prospeo'
  );

  console.error('\n=== STAGE 2 DONE ===');
  console.error(`qualified: ${qualified.length} -> ${join(runDir, 'qualified.csv')}`);
  console.error(`rejected:  ${rejected.length} -> ${join(runDir, 'rejected.csv')}`);
  console.error(`ledger appended: ${added}`);
}

(async () => {
  if (arg('finalize') === 'true') {
    stage2();
  } else {
    await stage1();
  }
})();
