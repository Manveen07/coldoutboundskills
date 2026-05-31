// ---------------------------------------------------------------------------
// _suppress.ts — layered suppression for list-builder.
//
// Three layers, applied in order:
//   1. Static exclude  — exclude-domains.csv + client-profile excluded_domains
//   2. Auto-ledger     — contacted-ledger.json (every past run output)
//   3. Smartlead live  — opt-in, leads already in any Smartlead campaign
//
// Returns kept leads + a per-layer drop report.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parseCsv } from '../_csv_io';
import { loadLedgerSets, normDomain, normEmail } from './_ledger';

export interface Lead {
  domain?: string;
  email?: string;
  [k: string]: any;
}

export interface SuppressReport {
  input: number;
  dropped_static: number;
  dropped_ledger: number;
  dropped_smartlead: number;
  kept: number;
}

/** Load static exclude domains from a CSV path + an inline list. */
function loadStaticExcludes(opts: {
  excludeCsvPath?: string;
  excludedDomains?: string[];
}): Set<string> {
  const set = new Set<string>();
  for (const d of opts.excludedDomains || []) {
    const n = normDomain(d);
    if (n) set.add(n);
  }
  if (opts.excludeCsvPath && existsSync(opts.excludeCsvPath)) {
    const { headers, rows } = parseCsv(readFileSync(opts.excludeCsvPath, 'utf8'));
    // accept a column named domain / company_domain / website, else first col
    const col =
      headers.find((h) => /^(domain|company_domain|website|url)$/i.test(h)) ||
      headers[0];
    for (const r of rows) {
      const n = normDomain(r[col] || '');
      if (n) set.add(n);
    }
  }
  return set;
}

/**
 * Query Smartlead for every lead already loaded into any campaign.
 * Returns a set of normalized emails. Best-effort — on API failure returns
 * empty set and logs a warning (does not block the run).
 */
async function loadSmartleadSent(apiKey: string): Promise<Set<string>> {
  const emails = new Set<string>();
  try {
    // Smartlead: GET /api/v1/leads/global?api_key=  (paginated). We page until empty.
    let offset = 0;
    const limit = 1000;
    for (let page = 0; page < 100; page++) {
      const url = `https://server.smartlead.ai/api/v1/leads/global?api_key=${apiKey}&offset=${offset}&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) break;
      const data: any = await res.json();
      const arr: any[] = Array.isArray(data) ? data : data?.data || [];
      if (!arr.length) break;
      for (const row of arr) {
        const em = normEmail(row.email || row.lead_email || '');
        if (em) emails.add(em);
      }
      if (arr.length < limit) break;
      offset += limit;
    }
  } catch (e: any) {
    console.warn(`[suppress] Smartlead query failed, skipping layer 3: ${e.message}`);
  }
  return emails;
}

export async function suppress(
  leads: Lead[],
  opts: {
    excludeCsvPath?: string;
    excludedDomains?: string[];
    suppressSmartlead?: boolean;
    smartleadApiKey?: string;
  }
): Promise<{ kept: Lead[]; report: SuppressReport }> {
  const report: SuppressReport = {
    input: leads.length,
    dropped_static: 0,
    dropped_ledger: 0,
    dropped_smartlead: 0,
    kept: 0,
  };

  // Layer 1 — static
  const staticSet = loadStaticExcludes(opts);
  let kept = leads.filter((l) => {
    const d = normDomain(l.domain || '');
    if (d && staticSet.has(d)) {
      report.dropped_static++;
      return false;
    }
    return true;
  });

  // Layer 2 — ledger
  const { domains: ledgerDomains, emails: ledgerEmails } = loadLedgerSets();
  kept = kept.filter((l) => {
    const d = normDomain(l.domain || '');
    const em = normEmail(l.email || '');
    if ((d && ledgerDomains.has(d)) || (em && ledgerEmails.has(em))) {
      report.dropped_ledger++;
      return false;
    }
    return true;
  });

  // Layer 3 — Smartlead live (opt-in)
  if (opts.suppressSmartlead && opts.smartleadApiKey) {
    const sent = await loadSmartleadSent(opts.smartleadApiKey);
    if (sent.size) {
      kept = kept.filter((l) => {
        const em = normEmail(l.email || '');
        if (em && sent.has(em)) {
          report.dropped_smartlead++;
          return false;
        }
        return true;
      });
    }
  }

  report.kept = kept.length;
  return { kept, report };
}
