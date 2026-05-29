// ---------------------------------------------------------------------------
// Prep a Smartlead-export CSV for the signal pipeline.
//
// Adds: person_id (synthetic from domain+first_name), title alias for current_job_title,
// qual_confidence default (0.75 if missing), eligible=true.
//
// Usage:
//   npx tsx scripts/prep-smartlead-for-signals.ts <smartlead.csv> <prepped.csv>
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from 'fs';
import { parseCsv, writeCsv } from './_csv_io';

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20);
}

async function main() {
  const inputCsv = process.argv[2];
  const outputCsv = process.argv[3];
  if (!inputCsv || !outputCsv) {
    console.error('Usage: npx tsx scripts/prep-smartlead-for-signals.ts <input.csv> <output.csv>');
    process.exit(1);
  }

  const { headers, rows } = parseCsv(readFileSync(inputCsv, 'utf8'));

  const seen = new Map<string, number>();
  const prepped = rows.map(row => {
    const key = `${slugify(row.company_domain || '')}_${slugify(row.first_name || '')}`;
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    const person_id = count > 1 ? `${key}_${count}` : key;

    return {
      ...row,
      person_id,
      title: row.title || row.current_job_title || '',
      qual_confidence: row.qual_confidence || '0.75',
      qualified: 'true',
      eligible: 'true',
    };
  });

  const outHeaders = ['person_id', ...headers.filter(h => h !== 'person_id'), 'title', 'qualified', 'eligible'];
  writeFileSync(outputCsv, writeCsv(prepped, outHeaders));
  console.error(`Prepped ${prepped.length} rows → ${outputCsv}`);
}

main().catch(e => { console.error(e); process.exit(1); });
