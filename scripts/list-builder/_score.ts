// ---------------------------------------------------------------------------
// _score.ts — client-agnostic ICP scorer for the list-builder.
//
// Engine = subagent (default). Builds batch prompt files that Claude Code Task
// sub-agents execute (same pattern as the showcase pipeline). The orchestrator
// dispatches them; this module only PREPARES prompts and MERGES results.
//
// --engine=api is a stub: errors until wired.
//
// ICP resolution order:
//   icpPromptPath given        -> use it
//   client slug given          -> profiles/<slug>/icp-prompt.txt (or -allverticals)
//   neither                    -> ./_generic-icp-prompt.txt with {ICP_DESCRIPTION}
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ScoreLead {
  full_name?: string;
  title?: string;
  company_name?: string;
  domain?: string;
  headcount?: string | number;
  industry?: string;
  description?: string;
}

export interface ScoreResult {
  domain: string;
  full_name: string;
  icp_qualified: boolean;
  icp_confidence: number;
  icp_reason: string;
  relevance_signal: string;
}

const root = process.cwd();

/** Resolve the ICP prompt text per the resolution order. */
export function resolveIcpPrompt(opts: {
  icpPromptPath?: string;
  client?: string;
  icpDescription?: string;
}): string {
  if (opts.icpPromptPath && existsSync(opts.icpPromptPath)) {
    return readFileSync(opts.icpPromptPath, 'utf8');
  }
  if (opts.client) {
    const all = resolve(root, `profiles/${opts.client}/icp-prompt-allverticals.txt`);
    const base = resolve(root, `profiles/${opts.client}/icp-prompt.txt`);
    if (existsSync(all)) return readFileSync(all, 'utf8');
    if (existsSync(base)) return readFileSync(base, 'utf8');
  }
  // generic fallback
  const generic = readFileSync(resolve(__dirname, '_generic-icp-prompt.txt'), 'utf8');
  return generic.replace(
    '{ICP_DESCRIPTION}',
    opts.icpDescription || '(no ICP description supplied — score on obvious fit only)'
  );
}

/** Write one prompt file per batch of `batchSize` leads. Returns prompt dir. */
export function prepScorePrompts(
  leads: ScoreLead[],
  icpPrompt: string,
  outDir: string,
  batchSize = 20
): { promptDir: string; batchCount: number } {
  const promptDir = join(outDir, 'score-prompts');
  if (!existsSync(promptDir)) mkdirSync(promptDir, { recursive: true });

  let batchN = 0;
  for (let i = 0; i < leads.length; i += batchSize) {
    batchN++;
    const slice = leads.slice(i, i + batchSize);
    const leadBlock = slice
      .map((l, k) => {
        const hc = l.headcount ? ` | headcount: ${l.headcount}` : '';
        const ind = l.industry ? ` | industry: ${l.industry}` : '';
        const desc = l.description ? `\n   desc: ${l.description.slice(0, 300)}` : '';
        return `### Lead ${k + 1}
   name: ${l.full_name || ''}
   title: ${l.title || ''}
   company: ${l.company_name || ''}
   domain: ${l.domain || ''}${hc}${ind}${desc}`;
      })
      .join('\n\n');

    const prompt = `# ICP Scoring Task — batch ${batchN}

Score these ${slice.length} leads against the ICP below. One JSON object per lead.

## ICP

${icpPrompt}

## Leads

${leadBlock}

## Output

Return ONE JSON array of ${slice.length} objects with keys:
domain, full_name, icp_qualified, icp_confidence, icp_reason, relevance_signal.
No preamble. No markdown fence. Pure JSON array only.
`;
    writeFileSync(join(promptDir, `batch-${String(batchN).padStart(2, '0')}.txt`), prompt, 'utf8');
  }
  return { promptDir, batchCount: batchN };
}

/** Merge all result JSONs from a results dir into one array. */
export function mergeScoreResults(resultsDir: string): ScoreResult[] {
  const out: ScoreResult[] = [];
  if (!existsSync(resultsDir)) return out;
  for (const f of readdirSync(resultsDir).filter((x) => x.endsWith('.json'))) {
    try {
      const arr = JSON.parse(readFileSync(join(resultsDir, f), 'utf8'));
      if (Array.isArray(arr)) out.push(...arr);
    } catch (e: any) {
      console.warn(`[score] failed to parse ${f}: ${e.message}`);
    }
  }
  return out;
}

/** Stub for the future API engine. */
export async function scoreViaApi(): Promise<never> {
  throw new Error(
    '--engine=api is not wired yet. Use the default subagent engine (omit --engine).'
  );
}
