#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Standardized cold email pipeline orchestrator
//
// Usage:
//   npx tsx scripts/pipeline/run.ts --client mythic --category qsr
//   npx tsx scripts/pipeline/run.ts --client mythic --category qsr --smoke
//   npx tsx scripts/pipeline/run.ts --client mythic --category qsr --dry-run
//   npx tsx scripts/pipeline/run.ts --client mythic --category qsr --offline
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { loadClientConfigByName, getPriorityDomains, getExampleEmails } from '../_client_config';
import { writeCsvWithExtra } from '../_csv_io';
import { loadLimits, checkCap } from './_limits';
import { pullLeads } from './_pull';
import { scoreLeads, type ScoredLead } from './_score';
import { researchLead, writeDossier, decideTier, type Tier } from './_research';
import { writeEmailsForLead } from './_write';
import { validateEmails } from './_validate';
import { estimateRunCost, formatPreflightReport, promptPreflight } from './_credit_guard';
import { initRunDir, writeArtifact, appendLog } from './_run_artifacts';

export interface PipelineArgs {
  client: string;
  category: string;
  smoke: boolean;
  dryRun: boolean;
  offline: boolean;
}

export function parsePipelineArgs(argv: string[]): PipelineArgs {
  const args = argv.slice(2);
  const get = (flag: string) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined; };
  const client = get('--client');
  const category = get('--category');
  if (!client) throw new Error('--client is required');
  if (!category) throw new Error('--category is required');
  return {
    client, category,
    smoke: args.includes('--smoke'),
    dryRun: args.includes('--dry-run'),
    offline: args.includes('--offline'),
  };
}

function loadEnvKeys(): Record<string, string> {
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

function defaultDispatcher(_prompt: string): Promise<string> {
  throw new Error('No sub-agent dispatcher provided. Run this script from within Claude Code which injects a dispatcher.');
}

async function processLead(
  lead: ScoredLead,
  cfg: any,
  exampleEmails: string[],
  priorityDomains: string[],
  thresholds: { t2: number; t3: number },
  semanticThreshold: number,
  dispatch: (p: string) => Promise<string>,
  serperKey: string,
  dossierDir: string,
): Promise<{ row: Record<string, any> | null; failure?: any }> {
  try {
    const dossier = await researchLead({
      lead, serperKey, priorityDomains, thresholds,
      callerScript: 'pipeline/run.ts',
    });
    writeDossier(dossier, dossierDir);

    const written = await writeEmailsForLead({
      dossier, cfg, exampleEmails,
      firstName: lead.first_name,
      dispatch, maxRetries: 3,
    });
    if (!written.output) {
      return { row: null, failure: { person_id: lead.person_id, stage: 'write', error: written.error } };
    }

    const reports = await validateEmails({
      output: written.output, dossier, cfg, dispatch,
      semanticThreshold,
      recipientName: lead.full_name, recipientTitle: lead.current_job_title, recipientCompany: lead.company_name,
    });
    const allPass = reports.every(r => r.final_pass);

    const row = {
      ...lead,
      research_tier: dossier.tier,
      signal_used: dossier.signals.funding_fact ? 'funding'
        : dossier.signals.press_facts[0] ? 'press'
        : dossier.signals.category_snippet ? 'snippet'
        : 'fallback',
      signal_fact: dossier.signals.funding_fact ?? dossier.signals.press_facts[0] ?? dossier.signals.category_snippet ?? '',
      research_dossier_path: resolve(dossierDir, `${dossier.company.domain}.json`),
      assigned_variant: dossier.tier === 'T3' ? 'A' : dossier.tier === 'T2' ? 'B' : 'C',
      validator_score: reports[0].semantic.score,
      validator_role_play_verdict: reports[0].role_play?.verdict ?? '',
      email1_subject: written.output.email1.subject,
      email1_body: written.output.email1.body,
      email1_research_detail: written.output.email1.research_detail_used,
      email2_subject: written.output.email2.subject,
      email2_body: written.output.email2.body,
      email2_research_detail: written.output.email2.research_detail_used,
      email3_subject: written.output.email3.subject,
      email3_body: written.output.email3.body,
      email3_research_detail: written.output.email3.research_detail_used,
      email4_subject: written.output.email4.subject,
      email4_body: written.output.email4.body,
      email4_research_detail: written.output.email4.research_detail_used,
    };
    return { row, failure: allPass ? undefined : { person_id: lead.person_id, stage: 'validate', reports } };
  } catch (err: any) {
    return { row: null, failure: { person_id: lead.person_id, stage: 'unknown', error: err?.message ?? String(err) } };
  }
}

export async function runPipeline(args: PipelineArgs, dispatch: (prompt: string) => Promise<string> = defaultDispatcher): Promise<void> {
  const cfg = loadClientConfigByName(args.client);
  const limits = loadLimits();
  const env = loadEnvKeys();
  const priorityDomains = getPriorityDomains(cfg);
  const exampleEmails = getExampleEmails(args.client);
  const runDir = initRunDir(args.client, args.category);
  const thresholds = { t2: limits.tier_thresholds.t2_qual_confidence, t3: limits.tier_thresholds.t3_qual_confidence };

  appendLog(runDir, `pipeline start args=${JSON.stringify(args)}`);
  console.log(`\n=== PIPELINE: ${cfg.business.name} / ${args.category} ===`);
  console.log(`Run dir: ${runDir}`);

  const prospeoKey = env.PROSPEO_API_KEY;
  if (!prospeoKey && !args.offline) throw new Error('PROSPEO_API_KEY not set');

  // --- Stage 1: pull ---
  console.log('\n[Stage 1] Lead pull...');
  const pull = await pullLeads({
    apiKey: prospeoKey ?? '',
    cfg, category: args.category,
    maxPages: 10,
    callerScript: 'pipeline/run.ts',
  });
  console.log(`  pulled ${pull.leads.length} leads (${pull.pagesFromCache} cached, ${pull.pagesFetched} fetched, pool=${pull.totalPool})`);
  appendLog(runDir, `stage1 leads=${pull.leads.length} fetched=${pull.pagesFetched} cached=${pull.pagesFromCache}`);
  writeArtifact(runDir, 'raw-leads.csv', writeCsvWithExtra(pull.leads as any, []));

  // --- Stage 2: score ---
  console.log('\n[Stage 2] ICP score...');
  const icpPromptPath = `profiles/${args.client}/icp-prompt.txt`;
  const scored = await scoreLeads({
    leads: pull.leads,
    client: args.client,
    icpPromptPath,
    dispatch,
    batchSize: 10,
  });
  const qualified = scored.filter(l => l.icp_qualified === 'true' && parseFloat(l.icp_confidence) >= 0.7);
  console.log(`  ${qualified.length}/${scored.length} qualified at >= 0.7`);
  appendLog(runDir, `stage2 qualified=${qualified.length} total=${scored.length}`);
  writeArtifact(runDir, 'scored-leads.csv', writeCsvWithExtra(scored as any, ['icp_qualified', 'icp_confidence', 'icp_reason']));

  // --- Preflight ---
  const tierMix = { T1: 0, T2: 0, T3: 0 } as Record<Tier, number>;
  for (const l of qualified) tierMix[decideTier(l, priorityDomains, thresholds)]++;
  const estimate = estimateRunCost({
    qualifiedLeads: qualified.length, tierMix,
    pagesToFetch: 0, cachedPages: pull.pagesFromCache,
    leadmagicLookups: 0,
  });
  checkCap(limits, 'serper_per_run', estimate.serper_credits);
  const report = formatPreflightReport({ client: args.client, category: args.category, leads: qualified.length, cachedLeads: pull.pagesFromCache, estimate });
  writeArtifact(runDir, 'preflight.json', { args, tierMix, estimate });

  if (args.dryRun) {
    console.log(report);
    console.log('\n[dry-run] aborting before any API calls.');
    return;
  }

  let proceed = await promptPreflight(report);
  if (proceed === 'no') { console.log('Aborted.'); return; }
  if (proceed === 'dry-run') { console.log('Dry-run requested; aborting.'); return; }

  // --- Stages 3-5: research + write + validate ---
  const isSmoke = args.smoke || proceed === 'smoke';
  const dossierDir = resolve(runDir, 'dossiers');
  if (!existsSync(dossierDir)) mkdirSync(dossierDir, { recursive: true });

  const targetLeads = isSmoke ? qualified.slice(0, 3) : qualified;
  console.log(`\n[Stage 3-5] Researching + writing + validating ${targetLeads.length} leads${isSmoke ? ' (SMOKE)' : ''}...`);

  const finalRows: Record<string, any>[] = [];
  const failures: any[] = [];

  for (const lead of targetLeads) {
    const { row, failure } = await processLead(
      lead, cfg, exampleEmails, priorityDomains, thresholds,
      limits.semantic_pass_threshold, dispatch, env.SERPER_API_KEY ?? '', dossierDir,
    );
    if (row) finalRows.push(row);
    if (failure) failures.push(failure);
  }

  writeArtifact(runDir, 'failures.json', failures);

  if (isSmoke && !args.smoke) {
    const remaining = qualified.slice(3);
    console.log(`\nSmoke complete on ${targetLeads.length} leads. ${remaining.length} remaining.`);
    proceed = await promptPreflight('Proceed with the rest? (yes / no):');
    if (proceed !== 'yes') {
      console.log('Stopped after smoke.');
      writeArtifact(runDir, 'output.csv', writeCsvWithExtra(finalRows, []));
      return;
    }
    for (const lead of remaining) {
      const { row, failure } = await processLead(
        lead, cfg, exampleEmails, priorityDomains, thresholds,
        limits.semantic_pass_threshold, dispatch, env.SERPER_API_KEY ?? '', dossierDir,
      );
      if (row) finalRows.push(row);
      if (failure) failures.push(failure);
    }
    writeArtifact(runDir, 'failures.json', failures);
  }

  // --- Stage 6: quality gate ---
  if (!isSmoke || (isSmoke && !args.smoke)) {
    console.log('\n[Stage 6] Quality gate...');
    const { runQualityGate } = await import('../_quality_gate');
    const approved = await runQualityGate(finalRows as any, args.client, args.category);
    if (!approved) { console.log('Not approved.'); return; }
  }

  writeArtifact(runDir, 'output.csv', writeCsvWithExtra(finalRows, []));
  writeArtifact(runDir, 'final-stats.json', { rendered: finalRows.length, failures: failures.length });
  console.log(`\nFinal CSV: ${resolve(runDir, 'output.csv')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parsePipelineArgs(process.argv);
  runPipeline(args).catch(e => { console.error('FATAL:', e?.message ?? e); process.exit(1); });
}
