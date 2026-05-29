#!/usr/bin/env tsx
/**
 * Upload all CSVs from a folder to Google Sheets — one tab per file.
 *
 * Usage:
 *   npx tsx scripts/_upload-to-sheets.ts \
 *     --dir data/runs/showcase-2026-05-28/final \
 *     --spreadsheet-id 1pinFMIyeoUKivJUP1ReQNOVM6_xlKTDb0CVfhGAwaeo
 */

import { readdirSync } from 'fs';
import { resolve } from 'path';
import { writeSheetFromCsv } from './_sheets_writer';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  return {
    dir: get('--dir'),
    spreadsheetId: get('--spreadsheet-id'),
  };
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

(async () => {
  const { dir, spreadsheetId } = parseArgs();
  if (!dir || !spreadsheetId) {
    console.error('Usage: npx tsx scripts/_upload-to-sheets.ts --dir <path> --spreadsheet-id <id>');
    process.exit(1);
  }

  const files = readdirSync(dir)
    .filter(f => f.endsWith('.csv'))
    .sort();

  console.error(`Found ${files.length} CSV files in ${dir}`);
  console.error('');

  let success = 0;
  let failed = 0;

  for (const file of files) {
    const sheetName = file.replace('.csv', '');
    const csvPath = resolve(dir, file);
    try {
      const result = await writeSheetFromCsv({ csvPath, spreadsheetId, sheetName });
      console.error(`✓ ${sheetName} — ${result.rowsWritten} rows`);
      success++;
    } catch (err: any) {
      console.error(`✗ ${sheetName} — ERROR: ${err?.message ?? err}`);
      failed++;
    }
    // Respect Sheets API quota (60 req/min write)
    await sleep(1200);
  }

  console.error('');
  console.error(`Done. ${success} succeeded, ${failed} failed.`);
  console.error(`Sheet: https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
})().catch(e => { console.error('FATAL:', e?.message ?? e); process.exit(1); });
