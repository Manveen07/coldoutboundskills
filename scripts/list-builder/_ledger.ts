// ---------------------------------------------------------------------------
// _ledger.ts — persistent "already output" suppression ledger.
//
// Every lead the list-builder emits is appended here. Future runs auto-exclude
// anyone already in the ledger. Mirrors the Clay "processed" column pattern.
//
// Storage: data/list-builder/contacted-ledger.json (gitignored).
// Keyed by normalized domain AND normalized email so either match suppresses.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

const LEDGER_PATH = resolve(
  process.cwd(),
  'data/list-builder/contacted-ledger.json'
);

export interface LedgerEntry {
  domain: string;
  email: string;
  client: string;
  added_at: string; // ISO
  source: string; // prospeo | blitz | niche:<db>
}

interface LedgerFile {
  version: 1;
  entries: LedgerEntry[];
}

export function normDomain(d: string): string {
  return (d || '')
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

export function normEmail(e: string): string {
  const raw = (e || '').toLowerCase().trim();
  if (!raw.includes('@')) return raw;
  const [local, domain] = raw.split('@');
  // strip +tags from local part for dedup (john+x@a.com == john@a.com)
  const cleanLocal = local.split('+')[0];
  return `${cleanLocal}@${domain}`;
}

function loadFile(): LedgerFile {
  if (!existsSync(LEDGER_PATH)) {
    return { version: 1, entries: [] };
  }
  try {
    const j = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
    if (!j.entries || !Array.isArray(j.entries)) return { version: 1, entries: [] };
    return j as LedgerFile;
  } catch {
    return { version: 1, entries: [] };
  }
}

/** Returns two sets for fast membership tests: suppressed domains + emails. */
export function loadLedgerSets(): { domains: Set<string>; emails: Set<string> } {
  const f = loadFile();
  const domains = new Set<string>();
  const emails = new Set<string>();
  for (const e of f.entries) {
    if (e.domain) domains.add(normDomain(e.domain));
    if (e.email) emails.add(normEmail(e.email));
  }
  return { domains, emails };
}

/** Append survivors to the ledger. Dedupes against existing entries. */
export function appendToLedger(
  leads: Array<{ domain?: string; email?: string }>,
  client: string,
  source: string
): number {
  const f = loadFile();
  const existingDomains = new Set(f.entries.map((e) => normDomain(e.domain)));
  const existingEmails = new Set(f.entries.map((e) => normEmail(e.email)));
  const now = new Date().toISOString();
  let added = 0;
  for (const l of leads) {
    const d = normDomain(l.domain || '');
    const em = normEmail(l.email || '');
    if (!d && !em) continue;
    // skip if either identifier already present
    if ((d && existingDomains.has(d)) || (em && existingEmails.has(em))) continue;
    f.entries.push({ domain: d, email: em, client, added_at: now, source });
    if (d) existingDomains.add(d);
    if (em) existingEmails.add(em);
    added++;
  }
  if (!existsSync(dirname(LEDGER_PATH))) {
    mkdirSync(dirname(LEDGER_PATH), { recursive: true });
  }
  writeFileSync(LEDGER_PATH, JSON.stringify(f, null, 2), 'utf8');
  return added;
}

export function ledgerStats(): { total: number; byClient: Record<string, number> } {
  const f = loadFile();
  const byClient: Record<string, number> = {};
  for (const e of f.entries) {
    byClient[e.client] = (byClient[e.client] || 0) + 1;
  }
  return { total: f.entries.length, byClient };
}
