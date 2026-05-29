// ---------------------------------------------------------------------------
// API usage logger — appends one line per call to data/api-usage.log
//
// Format (TSV):
//   timestamp  provider  script  operation  units  unit_type
//
// Call logApiCall() from each API client after a successful request.
// ---------------------------------------------------------------------------

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';

export type ApiProvider = 'serper' | 'rapidapi-pnd' | 'leadmagic' | 'openrouter' | 'prospeo';
export type UnitType = 'credits' | 'calls';

export interface ApiCallEntry {
  provider: ApiProvider;
  script: string;    // caller filename, e.g. 'extract-signals.ts'
  operation: string; // e.g. 'serperSearch', 'fetchPersonSidecar', 'findEmail'
  units: number;     // credits consumed or calls made
  unit_type: UnitType;
}

const LOG_RELATIVE = 'data/api-usage.log';

function resolveLogPath(): string {
  // Walk up from this file to find the project root (contains package.json)
  let dir = dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
  for (let i = 0; i < 5; i++) {
    const candidate = resolve(dir, 'package.json');
    if (existsSync(candidate)) {
      return resolve(dir, LOG_RELATIVE);
    }
    dir = resolve(dir, '..');
  }
  // Fallback: relative to cwd
  return resolve(process.cwd(), LOG_RELATIVE);
}

export function logApiCall(entry: ApiCallEntry): void {
  try {
    const logPath = resolveLogPath();
    const logDir = dirname(logPath);
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

    const timestamp = new Date().toISOString();
    const line = [timestamp, entry.provider, entry.script, entry.operation, entry.units, entry.unit_type].join('\t') + '\n';
    appendFileSync(logPath, line, 'utf8');
  } catch {
    // Never throw — logging must never break callers
  }
}

// ---------------------------------------------------------------------------
// Summary helpers
// ---------------------------------------------------------------------------

export interface DaySummary {
  date: string;
  byProvider: Record<string, { units: number; calls: number }>;
  total_units: number;
  total_calls: number;
}

export function readDaySummary(date?: string): DaySummary {
  const target = date ?? new Date().toISOString().slice(0, 10);
  const logPath = resolveLogPath();

  const summary: DaySummary = { date: target, byProvider: {}, total_units: 0, total_calls: 0 };

  if (!existsSync(logPath)) return summary;

  const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    const [ts, provider, , , unitsStr, unit_type] = line.split('\t');
    if (!ts || !ts.startsWith(target)) continue;
    const units = parseFloat(unitsStr) || 0;
    if (!summary.byProvider[provider]) summary.byProvider[provider] = { units: 0, calls: 0 };
    summary.byProvider[provider].units += units;
    summary.byProvider[provider].calls += 1;
    summary.total_units += units;
    summary.total_calls += 1;
  }

  return summary;
}

// CLI: npx tsx scripts/_api_logger.ts [date]
import { pathToFileURL } from 'url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const date = process.argv[2];
  const summary = readDaySummary(date);
  console.log(`\nAPI usage — ${summary.date}`);
  console.log('─'.repeat(50));
  for (const [provider, stats] of Object.entries(summary.byProvider)) {
    console.log(`  ${provider.padEnd(20)} ${stats.units} units  (${stats.calls} log entries)`);
  }
  console.log('─'.repeat(50));
  console.log(`  ${'TOTAL'.padEnd(20)} ${summary.total_units} units  (${summary.total_calls} log entries)`);
}
