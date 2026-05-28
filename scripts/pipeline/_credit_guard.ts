import * as readline from 'readline';

export interface RunEstimate {
  serper_credits: number;
  prospeo_pages: number;
  leadmagic_lookups: number;
  scrape_pages: number;
  subagent_calls: number;
}

export interface EstimateOptions {
  qualifiedLeads: number;
  tierMix: { T1: number; T2: number; T3: number };
  pagesToFetch: number;
  cachedPages: number;
  leadmagicLookups: number;
}

const QUERIES_PER_TIER = { T1: 8, T2: 5, T3: 3 } as const;
const PERSON_QUERIES_T3 = 3;
const SUBAGENT_PER_LEAD = 7; // 1 write + 4 semantic + 1 role-play + 1 misc

export function estimateRunCost(opts: EstimateOptions): RunEstimate {
  const t = opts.tierMix;
  const serperCompany = t.T1 * QUERIES_PER_TIER.T1 + t.T2 * QUERIES_PER_TIER.T2 + t.T3 * QUERIES_PER_TIER.T3;
  const serperPerson = t.T3 * PERSON_QUERIES_T3;
  return {
    serper_credits: serperCompany + serperPerson,
    prospeo_pages: opts.pagesToFetch,
    leadmagic_lookups: opts.leadmagicLookups,
    scrape_pages: opts.qualifiedLeads * 3,
    subagent_calls: opts.qualifiedLeads * SUBAGENT_PER_LEAD,
  };
}

export interface PreflightInput {
  client: string;
  category: string;
  leads: number;
  cachedLeads: number;
  estimate: RunEstimate;
}

export function formatPreflightReport(input: PreflightInput): string {
  const line = '='.repeat(60);
  return `\n${line}
  PIPELINE PRE-FLIGHT -- ${input.client} / ${input.category}
${line}
  Leads to process:        ${input.leads}
  Already in cache:        ${input.cachedLeads}   (will skip)
  New API calls planned:
    Prospeo:               ${input.estimate.prospeo_pages} pages
    Serper:                ${input.estimate.serper_credits} credits
    LeadMagic:             ${input.estimate.leadmagic_lookups} lookups (out of scope v1)
    Scrape (free):         ${input.estimate.scrape_pages} pages
  Sub-agent calls (free):  ~${input.estimate.subagent_calls}
${line}
  Proceed? (yes / no / smoke / dry-run):`;
}

export type PreflightAnswer = 'yes' | 'no' | 'smoke' | 'dry-run' | 'unknown';

export async function promptPreflight(report: string): Promise<PreflightAnswer> {
  console.log(report);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question('> ', answer => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === 'yes' || a === 'y') resolve('yes');
      else if (a === 'no' || a === 'n') resolve('no');
      else if (a === 'smoke' || a === 's') resolve('smoke');
      else if (a === 'dry-run' || a === 'dryrun' || a === 'd') resolve('dry-run');
      else resolve('unknown');
    });
  });
}
