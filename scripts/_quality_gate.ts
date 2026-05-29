import * as readline from 'readline';

export interface GateSummary {
  client: string;
  category: string;
  total_leads: number;
  signal_coverage_pct: number;
  emails_revealed: number;
  fallback_count: number;
  sample_lead: Record<string, string>;
}

export function buildGateSummary(
  rows: Record<string, string>[],
  client: string,
  category: string,
): GateSummary {
  const total = rows.length;
  const withSignal = rows.filter(r => r.signal_used && r.signal_used !== 'fallback').length;
  const withEmail = rows.filter(r => r.email && r.email.trim() !== '').length;
  const fallback = total - withSignal;
  const sample = rows.find(r => r.signal_used !== 'fallback') ?? rows[0];

  return {
    client,
    category,
    total_leads: total,
    signal_coverage_pct: total > 0 ? Math.round((withSignal / total) * 1000) / 10 : 0,
    emails_revealed: withEmail,
    fallback_count: fallback,
    sample_lead: sample ?? {},
  };
}

export function printGateSummary(summary: GateSummary): void {
  console.log('\n' + '═'.repeat(60));
  console.log(`  QUALITY GATE — ${summary.client} / ${summary.category}`);
  console.log('═'.repeat(60));
  console.log(`  Total leads:       ${summary.total_leads}`);
  console.log(`  Signal coverage:   ${summary.signal_coverage_pct}% (${summary.total_leads - summary.fallback_count} with signal, ${summary.fallback_count} fallback)`);
  console.log(`  Emails revealed:   ${summary.emails_revealed} / ${summary.total_leads}`);
  console.log('\n  SAMPLE EMAIL 1 (first signal-eligible lead):');
  console.log('  ' + '─'.repeat(56));
  const body = summary.sample_lead.email1_body ?? '';
  body.split('\n').slice(0, 8).forEach(line => console.log(`  ${line}`));
  if (body.split('\n').length > 8) console.log('  [... truncated ...]');
  console.log('═'.repeat(60));
}

export async function runQualityGate(
  rows: Record<string, string>[],
  client: string,
  category: string,
): Promise<boolean> {
  const summary = buildGateSummary(rows, client, category);
  printGateSummary(summary);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question('\n  Approve and continue to upload? (yes/no): ', answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}
