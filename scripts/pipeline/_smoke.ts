import type { ScoredLead } from './_score';
import type { Tier } from './_research';
import { decideTier } from './_research';

export interface SmokePick {
  lead: ScoredLead;
  tier: Tier;
}

export function selectSmokeLeads(
  leads: ScoredLead[],
  priorityDomains: string[],
  thresholds: { t2: number; t3: number },
): SmokePick[] {
  const byTier: Record<Tier, ScoredLead[]> = { T1: [], T2: [], T3: [] };
  for (const l of leads) {
    if (l.icp_qualified !== 'true') continue;
    const t = decideTier(l, priorityDomains, thresholds);
    byTier[t].push(l);
  }
  const picks: SmokePick[] = [];
  for (const t of ['T1', 'T2', 'T3'] as Tier[]) {
    if (byTier[t].length > 0) picks.push({ lead: byTier[t][0], tier: t });
  }
  return picks;
}

export interface SmokeReportInput {
  picks: SmokePick[];
  emails: Array<{ tier: Tier; lead_name: string; lead_title: string; lead_company: string; email1_body: string; pass: boolean; reason: string; regenerations: number }>;
  serperCredits: number;
  subagentCalls: number;
}

export function formatSmokeReport(input: SmokeReportInput): string {
  const lines: string[] = [];
  lines.push('='.repeat(60));
  lines.push('  SMOKE RESULTS -- ' + input.picks.length + ' leads');
  lines.push('='.repeat(60));
  for (const e of input.emails) {
    lines.push(`  ${e.tier} -- ${e.lead_name}, ${e.lead_title}, ${e.lead_company}`);
    lines.push(`    Validator: ${e.pass ? 'pass' : 'FAIL'} (${e.regenerations} regens) -- ${e.reason}`);
    lines.push('    ' + '-'.repeat(56));
    e.email1_body.split('\n').forEach(l => lines.push('    ' + l));
    lines.push('');
  }
  lines.push(`  Serper credits burned: ${input.serperCredits}`);
  lines.push(`  Sub-agent calls:       ${input.subagentCalls}`);
  lines.push('='.repeat(60));
  lines.push('  Proceed with the rest? (yes / no / adjust):');
  return lines.join('\n');
}
