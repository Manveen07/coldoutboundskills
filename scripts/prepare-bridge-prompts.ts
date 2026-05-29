// ---------------------------------------------------------------------------
// Prepare bridge prompts (Task 17 redo) — Phase 2a of the 3-phase flow.
//
// Reads leads-with-signals.csv + per-domain sidecars, decides which leads
// need a bridge sentence, and writes bridge-tasks.json — a manifest that
// Claude Code dispatches Task subagents against.
//
// Subagents read each task's prompt, generate a sentence, and write to
// response_file. Phase 3 (render-with-signals --responses-dir) then reads
// those files.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { readSidecar } from './_lib_signals';
import { selectSignal } from './_signal_selector';
import { buildBridgePrompt, AiInvoker } from './_bridge_writer';
import { parseCsv } from './_csv_io';
import { classifyFactUniqueness } from './_uniqueness_classifier';

export interface BridgeTask {
  person_id: string;
  signal_used: string;
  signal_fact: string;
  company_name: string;
  first_name: string;
  prompt: string;
  response_file: string;
  status: 'pending' | 'completed' | 'fallback';
}

export interface BridgeTasksFile {
  schema_version: string;
  generated_at: string;
  tasks: BridgeTask[];
}

const NEEDS_BRIDGE = new Set([
  'new_role',
  'promotion',
  'acquisition',
  'funding',
  'product_launch',
  'press',
]);

/**
 * Pure function — generate bridge tasks from CSV rows.
 *
 * Skips:
 *   - ineligible / unqualified leads
 *   - leads with no sidecar
 *   - leads whose selected signal is `fallback` or `company_snippet`
 *     (snippet stands alone; fallback has no fact)
 *   - leads with no signal_fact
 *
 * Exported for testability (the CLI runner is a thin wrapper around this).
 */
export async function generateBridgeTasks(
  rows: Record<string, string>[],
  sidecarDir: string,
  responsesDir: string,
  aiInvoke?: AiInvoker,
): Promise<BridgeTask[]> {
  const tasks: BridgeTask[] = [];

  for (const lead of rows) {
    if (lead.skipped_ineligible === 'true' || lead.qualified === 'false') {
      continue;
    }
    const sidecar = readSidecar(lead.company_domain, sidecarDir);
    if (!sidecar) continue;
    const selected = selectSignal(sidecar, null);
    if (!NEEDS_BRIDGE.has(selected.signal_used)) continue;
    if (!selected.signal_fact) continue;

    // Uniqueness classification — only when aiInvoke is provided (opt-in).
    if (aiInvoke) {
      const verdict = await classifyFactUniqueness(
        {
          signal_type: selected.signal_used,
          signal_fact: selected.signal_fact,
          company_name: lead.company_name,
          primary_vertical: lead.primary_vertical ?? '',
        },
        aiInvoke,
      );
      if (verdict === 'generic_for_category') {
        continue;
      }
    }

    const ctx = {
      signal_used: selected.signal_used,
      signal_fact: selected.signal_fact,
      company_name: lead.company_name,
      first_name: lead.first_name,
    };

    tasks.push({
      person_id: lead.person_id,
      signal_used: selected.signal_used,
      signal_fact: selected.signal_fact,
      company_name: lead.company_name,
      first_name: lead.first_name,
      prompt: buildBridgePrompt(ctx),
      response_file: resolve(responsesDir, `${lead.person_id}.txt`),
      status: 'pending',
    });
  }

  return tasks;
}

async function runCli() {
  const inputCsv = process.argv[2];
  const outputJson = process.argv[3] || 'data/bridge-tasks.json';
  const responsesDir = process.argv[4] || 'data/bridge-responses';
  if (!inputCsv) {
    console.error(
      'Usage: tsx scripts/prepare-bridge-prompts.ts <leads-with-signals.csv> [bridge-tasks.json] [responses-dir] [--classify]'
    );
    process.exit(1);
  }

  const text = readFileSync(inputCsv, 'utf8');
  const { rows } = parseCsv(text);

  let aiInvoke: AiInvoker | undefined;
  if (process.argv.includes('--classify')) {
    const { makeFileBasedInvoker } = await import('./_file_based_invoker');
    aiInvoke = makeFileBasedInvoker(responsesDir);
  }

  const sidecarDir = process.argv[5] || 'data/signals';
  const tasks = await generateBridgeTasks(rows, sidecarDir, responsesDir, aiInvoke);

  const out: BridgeTasksFile = {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    tasks,
  };

  if (!existsSync(responsesDir)) mkdirSync(responsesDir, { recursive: true });
  writeFileSync(outputJson, JSON.stringify(out, null, 2));
  console.error(`Wrote ${tasks.length} bridge tasks to ${outputJson}`);
  console.error(
    `Responses dir: ${responsesDir} (Claude Code dispatches subagents to populate)`
  );
}

import { pathToFileURL } from 'url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
