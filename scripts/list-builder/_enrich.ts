// ---------------------------------------------------------------------------
// _enrich.ts — email waterfall + validation wrapper for the list-builder.
//
// Reuses skills/auto-research-public/scripts/phase-enrich.ts as a subprocess
// (email finder via Prospeo, description scrape, MillionVerifier validation).
// We shell out rather than import so we never edit the email pipeline's files.
//
// Maps list-builder lead shape <-> phase-enrich expected shape.
// ---------------------------------------------------------------------------

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { execFileSync } from 'child_process';

const root = process.cwd();
const PHASE_ENRICH = resolve(
  root,
  'skills/auto-research-public/scripts/phase-enrich.ts'
);

export interface EnrichLead {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  company_name?: string;
  domain?: string;
  email?: string;
  company_description?: string;
  [k: string]: any;
}

function splitName(full?: string): { first: string; last: string } {
  const parts = (full || '').trim().split(/\s+/);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') || '' };
}

/**
 * Enrich + validate. Returns leads that ended with a validated email.
 * tmpDir holds the intermediate JSON files for this run.
 */
export function enrichAndValidate(
  leads: EnrichLead[],
  tmpDir: string
): { withEmail: EnrichLead[]; allLeads: EnrichLead[]; stats: any } {
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  // Map to phase-enrich shape: needs first_name, last_name, company_domain, email
  const mapped = leads.map((l) => {
    const { first, last } = splitName(l.full_name);
    return {
      ...l,
      first_name: l.first_name || first,
      last_name: l.last_name || last,
      company_domain: l.domain || '',
      company_description: l.company_description || '',
      email: l.email || '',
    };
  });

  const inFile = join(tmpDir, 'enrich-in.json');
  const outFile = join(tmpDir, 'enrich-out.json');
  writeFileSync(inFile, JSON.stringify({ leads: mapped }, null, 2), 'utf8');

  // Run phase-enrich CLI as subprocess. Inherits env (PROSPEO/MV keys).
  try {
    execFileSync(
      'npx',
      ['tsx', PHASE_ENRICH, `--leads-file=${inFile}`, `--out=${outFile}`],
      { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' }
    );
  } catch (e: any) {
    throw new Error(`phase-enrich failed: ${e.message}`);
  }

  const out = JSON.parse(readFileSync(outFile, 'utf8'));
  // Map back: company_domain -> domain
  const remap = (l: any): EnrichLead => ({
    ...l,
    domain: l.domain || l.company_domain || '',
  });
  return {
    withEmail: (out.leads || []).map(remap),
    allLeads: (out.allLeads || []).map(remap),
    stats: out.stats || {},
  };
}
