#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// run-pipeline.ts — single-command orchestrator
//
// Usage:
//   npx tsx scripts/run-pipeline.ts --client belardi-wong --category footwear
//   npx tsx scripts/run-pipeline.ts --client belardi-wong --category athletic --dry-run
//
// Steps:
//   1. Load client config
//   2. Prospeo pull → raw leads CSV
//   3. Signal extraction → leads-with-signals CSV
//   4. Bridge generation (OpenRouter if key set, else file-based)
//   5. Render emails → final CSV
//   6. Reveal emails via LeadMagic
//   7. Quality gate (human approval)
//   8. Print Smartlead upload command (never auto-runs)
// ---------------------------------------------------------------------------

import { resolve, dirname } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { pathToFileURL } from 'url';

import { loadClientConfigByName, getExcludedDomains } from './_client_config';
import { makeAutoInvoker } from './_openrouter_invoker';
import { runQualityGate } from './_quality_gate';
import { parseCsv, writeCsv } from './_csv_io';
import { renderLead } from './render-with-signals';
import { StatRotator } from './_stat_rotator';

export function parseCliArgs(argv: string[]): { client: string; category: string; dryRun: boolean } {
  const args = argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const client = get('--client');
  const category = get('--category');
  const dryRun = args.includes('--dry-run');
  if (!client) throw new Error('--client is required. e.g. --client belardi-wong');
  if (!category) throw new Error('--category is required. e.g. --category footwear');
  return { client, category, dryRun };
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n[→] ${name}...`);
  const t0 = Date.now();
  await fn();
  console.log(`[✓] ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

async function runPipeline(client: string, category: string, dryRun: boolean): Promise<void> {
  const cfg = loadClientConfigByName(client);
  const excludedDomains = new Set(getExcludedDomains(cfg).map(d => d.toLowerCase()));
  // Campaign folder: belardi-wong uses lookalike-anchor; mythic uses growth-codes; others default to first-campaign
  const CAMPAIGN_MAP: Record<string, string> = {
    'belardi-wong': 'lookalike-anchor',
    'mythic': 'growth-codes',
  };
  const campaign = CAMPAIGN_MAP[client] ?? 'first-campaign';
  const base = resolve(process.cwd(), `profiles/${client}/campaigns/${campaign}/data`);
  if (!existsSync(base)) mkdirSync(base, { recursive: true });

  const paths = {
    rawLeads:        resolve(base, `${category}-raw.csv`),
    withSignals:     resolve(base, `${category}-with-signals.csv`),
    signalsDir:      resolve(base, `signals-${category}`),
    bridgeResponses: resolve(base, `bridge-responses-${category}`),
    finalCsv:        resolve(base, `${category}-final-v5.csv`),
  };

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  PIPELINE: ${cfg.business.name} / ${category}`);
  if (dryRun) console.log('  Mode: DRY-RUN (no API calls, no writes)');
  console.log('═'.repeat(60));

  // Step 1: Prospeo pull
  // Each client has its own search script with client-specific filters and output paths.
  // Convention: scripts/{client-slug}-prospeo-search.ts
  // Fallback: scripts/prospeo-trial-search.ts (BW default)
  const prospeoScript = existsSync(resolve(process.cwd(), `scripts/${client}-prospeo-search.ts`))
    ? `scripts/${client}-prospeo-search.ts`
    : 'scripts/prospeo-trial-search.ts';

  await step(`Prospeo lead pull (${prospeoScript})`, async () => {
    if (dryRun) { console.log('  [dry-run] skipping Prospeo pull'); return; }
    execSync(
      `npx tsx ${prospeoScript}`,
      { stdio: 'inherit', env: { ...process.env, VERTICAL: category, PIPELINE_CATEGORY: category, PIPELINE_CLIENT: client } }
    );
  });

  // Step 1b: ICP scoring (Mythic only -- filters leads before signal extraction)
  const scoredLeads = resolve(base, `${category}-scored.csv`);
  if (client === 'mythic' && existsSync(paths.rawLeads)) {
    await step('ICP scoring', async () => {
      if (dryRun) { console.log('  [dry-run] skipping ICP scoring'); return; }
      execSync(
        `npx tsx scripts/mythic-score-leads.ts --input ${JSON.stringify(paths.rawLeads)} --output ${JSON.stringify(scoredLeads)} --auto`,
        { stdio: 'inherit' }
      );
    });
  }

  // Step 2: Signal extraction (client-specific extractor if available)
  const signalScript = existsSync(resolve(process.cwd(), `scripts/${client}-extract-signals.ts`))
    ? `scripts/${client}-extract-signals.ts`
    : 'scripts/extract-signals.ts';
  const signalInput = client === 'mythic' && existsSync(scoredLeads) ? scoredLeads : paths.rawLeads;

  await step(`Signal extraction (${signalScript})`, async () => {
    if (dryRun) { console.log('  [dry-run] skipping signal extraction'); return; }
    if (!existsSync(signalInput)) {
      console.log(`  No input CSV at ${signalInput} — skipping extraction`);
      return;
    }
    execSync(
      `npx tsx ${signalScript} ${JSON.stringify(signalInput)} ${JSON.stringify(paths.withSignals)} ${JSON.stringify(paths.signalsDir)}`,
      { stdio: 'inherit' }
    );
  });

  // Step 3 + 4: Bridge generation + email render
  await step('Bridge generation + email render', async () => {
    if (dryRun) { console.log('  [dry-run] skipping render'); return; }

    const csvPath = existsSync(paths.withSignals) ? paths.withSignals : paths.rawLeads;
    if (!existsSync(csvPath)) {
      console.log(`  No input CSV at ${csvPath} — skipping render`);
      return;
    }

    const openRouterKey = process.env.OPENROUTER_API_KEY;
    const aiInvoke = makeAutoInvoker(openRouterKey, paths.bridgeResponses);
    console.log(openRouterKey
      ? '  Bridge mode: OpenRouter (automated)'
      : '  Bridge mode: file-based (set OPENROUTER_API_KEY to automate)'
    );

    const raw = readFileSync(csvPath, 'utf8');
    const { rows } = parseCsv(raw);
    const rotator = new StatRotator();
    const rendered: Record<string, any>[] = [];

    for (const lead of rows) {
      if (!lead.person_id) continue;
      const domain = (lead.company_domain ?? '').toLowerCase().replace(/^www\./, '');
      if (excludedDomains.has(domain)) {
        console.log(`  Excluded: ${lead.company_domain}`);
        continue;
      }
      try {
        const r = await renderLead(
          {
            person_id: lead.person_id,
            first_name: lead.first_name ?? '',
            full_name: lead.full_name ?? '',
            current_job_title: lead.current_job_title ?? '',
            company_name: lead.company_name ?? '',
            company_domain: lead.company_domain ?? '',
            qual_confidence: parseFloat(lead.qual_confidence) || 0.5,
            primary_vertical: lead.primary_vertical || category,
            assigned_variant: (lead.assigned_variant as 'B' | 'C') || 'B',
            vertical_anchor: lead.vertical_anchor,
            ai_similarity_dimension: lead.ai_similarity_dimension,
            ai_brand_category: lead.ai_brand_category,
            ai_role_hook: lead.ai_role_hook || '',
          },
          aiInvoke,
          paths.signalsDir,
          rotator,
        );
        rendered.push({ ...lead, ...r });
      } catch (err: any) {
        console.error(`  Render error ${lead.person_id}: ${err?.message ?? err}`);
      }
    }

    const extraHeaders = [
      'enrichment_tier', 'signal_used', 'signal_fact', 'signal_bridge',
      'signal_freshness_days', 'signal_e2_back_reference',
      'email1_subject', 'email1_body', 'email2_subject', 'email2_body',
      'email3_subject', 'email3_body', 'email4_subject', 'email4_body',
    ];
    writeFileSync(paths.finalCsv, writeCsv(rendered, extraHeaders));
    console.log(`  Rendered ${rendered.length} leads → ${paths.finalCsv}`);
  });

  // Step 5: LeadMagic email reveal
  await step('Email reveal (LeadMagic)', async () => {
    if (dryRun) { console.log('  [dry-run] skipping email reveal'); return; }
    const lmKey = process.env.LEADMAGIC_API_KEY;
    if (!lmKey) { console.log('  No LEADMAGIC_API_KEY — skipping email reveal'); return; }
    if (!existsSync(paths.finalCsv)) { console.log('  No final CSV — skipping reveal'); return; }
    const revealedCsv = paths.finalCsv.replace('.csv', '-revealed.csv');
    execSync(`npx tsx scripts/reveal-emails-leadmagic.ts ${JSON.stringify(paths.finalCsv)} ${JSON.stringify(revealedCsv)}`, { stdio: 'inherit' });
  });

  if (dryRun) {
    console.log('\n[dry-run] Pipeline complete.\n');
    return;
  }

  // Step 6: Quality gate
  const finalRows = existsSync(paths.finalCsv)
    ? parseCsv(readFileSync(paths.finalCsv, 'utf8')).rows
    : [];

  const approved = await runQualityGate(finalRows, client, category);
  if (!approved) {
    console.log('\n  Not approved. Stopping. Fix issues and re-run.\n');
    process.exit(0);
  }

  // Step 7: Print upload command (never auto-runs)
  console.log('\n' + '═'.repeat(60));
  console.log('  APPROVED — run this to upload to Smartlead (creates DRAFT):');
  console.log('═'.repeat(60));
  console.log(`\n  npx tsx scripts/smartlead-upload.ts ${paths.finalCsv}\n`);
  console.log('  Campaign will be in DRAFT. Start it manually in the Smartlead UI.');
  console.log('═'.repeat(60) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { client, category, dryRun } = parseCliArgs(process.argv);
  runPipeline(client, category, dryRun).catch(e => {
    console.error('FATAL:', e?.message ?? e);
    process.exit(1);
  });
}
