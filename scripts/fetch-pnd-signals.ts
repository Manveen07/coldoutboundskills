// ---------------------------------------------------------------------------
// Fetch person-level signals from PND (Professional Network Data via RapidAPI)
//
// Run AFTER extract-signals.ts (company signals), BEFORE render-with-signals.ts.
//
// Usage:
//   npx tsx scripts/fetch-pnd-signals.ts <leads-with-signals.csv>
//
// Input CSV must have: person_id, first_name, linkedin_url
// Reads PND_API_KEY from .env.
// Writes per-person sidecars to data/person-signals/{person_id}.json
// ---------------------------------------------------------------------------

import { readFileSync } from 'fs';
import { parseCsv } from './_csv_io';
import { fetchPersonSidecar } from './_pnd_client';

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

const RATE_LIMIT_MS = 500; // 2 req/s — PND is rate-limited

async function main() {
  const inputCsv = process.argv[2];
  if (!inputCsv) {
    console.error('Usage: npx tsx scripts/fetch-pnd-signals.ts <leads-with-signals.csv>');
    process.exit(1);
  }

  const env = { ...loadEnv(), ...process.env };
  const apiKey = env['PND_API_KEY'];
  if (!apiKey) {
    console.error('ERROR: PND_API_KEY not set in .env');
    process.exit(1);
  }

  const { rows } = parseCsv(readFileSync(inputCsv, 'utf8'));
  const sidecarDir = 'data/person-signals';

  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const { person_id, first_name, linkedin_url } = row;

    if (!linkedin_url) {
      console.error(`Skip ${person_id} — no linkedin_url`);
      skipped++;
      continue;
    }

    if (row.skipped_ineligible === 'true' || row.qualified === 'false') {
      skipped++;
      continue;
    }

    try {
      const sidecar = await fetchPersonSidecar(
        person_id,
        first_name || '',
        linkedin_url,
        apiKey,
        sidecarDir,
      );

      const signal = sidecar.new_role ? 'new_role' : sidecar.promotion ? 'promotion' : 'none';
      console.error(`✓ ${person_id} → ${signal}`);
      fetched++;
    } catch (err) {
      console.error(`✗ ${person_id}: ${err}`);
      failed++;
    }

    await sleep(RATE_LIMIT_MS);
  }

  console.error(`\nDone. Fetched: ${fetched} | Skipped: ${skipped} | Errors: ${failed}`);
  console.error(`Sidecars written to: ${sidecarDir}/`);
}

main().catch(e => { console.error(e); process.exit(1); });
