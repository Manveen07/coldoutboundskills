// ---------------------------------------------------------------------------
// Batch email reveal via LeadMagic (post list-building, pre campaign-upload)
//
// Usage:
//   npx tsx scripts/reveal-emails-leadmagic.ts <input.csv> <output.csv>
//
// Input CSV must have: first_name, last_name, company_domain
// Optional columns:    person_id, linkedin_url, email (skips if already present)
//
// Output adds: email, email_confidence, email_source
//
// Reads LEADMAGIC_API_KEY from .env. Rate-limited to 5 req/s.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from 'fs';
import { parseCsv, writeCsv } from './_csv_io';
import { findEmail, RATE_LIMIT_MS } from './_leadmagic_client';

function loadEnv(): Record<string, string> {
  try {
    const raw = readFileSync('.env', 'utf8');
    const out: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const inputCsv = process.argv[2];
  const outputCsv = process.argv[3];
  if (!inputCsv || !outputCsv) {
    console.error('Usage: npx tsx scripts/reveal-emails-leadmagic.ts <input.csv> <output.csv>');
    process.exit(1);
  }

  const env = { ...loadEnv(), ...process.env };
  const apiKey = env['LEADMAGIC_API_KEY'];
  if (!apiKey) {
    console.error('ERROR: LEADMAGIC_API_KEY not set in .env');
    process.exit(1);
  }

  const { headers, rows } = parseCsv(readFileSync(inputCsv, 'utf8'));

  let revealed = 0;
  let skipped = 0;
  let failed = 0;
  let credits = 0;

  const outRows: Record<string, string>[] = [];

  for (const row of rows) {
    // Skip if email already present
    if (row.email && row.email.includes('@')) {
      outRows.push({ ...row, email_confidence: row.email_confidence || 'pre-existing', email_source: row.email_source || 'input' });
      skipped++;
      continue;
    }

    const first_name = row.first_name || '';
    const last_name = row.last_name || '';
    const company_domain = row.company_domain || '';

    if (!first_name || !last_name || !company_domain) {
      console.error(`Skipping ${row.person_id || '?'} — missing name or domain`);
      outRows.push({ ...row, email: '', email_confidence: 'unknown', email_source: 'none' });
      skipped++;
      continue;
    }

    try {
      const result = await findEmail(
        {
          first_name,
          last_name,
          company_domain,
          linkedin_url: row.linkedin_url || undefined,
        },
        apiKey,
      );

      outRows.push({
        ...row,
        email: result.email || '',
        email_confidence: result.confidence,
        email_source: result.source,
      });

      if (result.email) {
        revealed++;
        credits += result.credits_used;
        console.error(`✓ ${first_name} ${last_name} → ${result.email} (${result.confidence})`);
      } else {
        failed++;
        console.error(`✗ ${first_name} ${last_name} @ ${company_domain} — not found`);
      }
    } catch (err) {
      console.error(`ERROR ${first_name} ${last_name}: ${err}`);
      outRows.push({ ...row, email: '', email_confidence: 'unknown', email_source: 'none' });
      failed++;
    }

    await sleep(RATE_LIMIT_MS);
  }

  const outHeaders = [
    ...headers.filter(h => !['email', 'email_confidence', 'email_source'].includes(h)),
    'email',
    'email_confidence',
    'email_source',
  ];
  writeFileSync(outputCsv, writeCsv(outRows, outHeaders));

  console.error(`\nDone. Revealed: ${revealed} | Skipped: ${skipped} | Not found: ${failed} | Credits used: ${credits}`);
  console.error(`Output: ${outputCsv}`);
}

main().catch(e => { console.error(e); process.exit(1); });
