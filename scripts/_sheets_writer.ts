// ---------------------------------------------------------------------------
// Google Sheets writer — appends or overwrites a sheet with CSV row data
//
// Auth: Service account JSON key file (path in GOOGLE_SERVICE_ACCOUNT_KEY_FILE)
// The service account must be shared as Editor on the target spreadsheet.
//
// Usage (standalone):
//   npx tsx scripts/_sheets_writer.ts \
//     --csv profiles/mythic/campaigns/growth-codes/data/leads-final-qsr.csv \
//     --spreadsheet-id 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms \
//     --sheet-name "QSR Leads"
//
// Usage (imported):
//   import { writeSheetFromCsv } from './_sheets_writer';
//   await writeSheetFromCsv({ csvPath, spreadsheetId, sheetName });
// ---------------------------------------------------------------------------

import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseCsv } from './_csv_io';

export interface SheetsWriterOptions {
  csvPath: string;
  spreadsheetId: string;
  sheetName: string;
  /** If true, clears existing sheet content before writing. Default: true */
  overwrite?: boolean;
  keyFilePath?: string; // defaults to GOOGLE_SERVICE_ACCOUNT_KEY_FILE env var
}

export interface SheetsWriterResult {
  url: string;
  rowsWritten: number;
  sheetName: string;
}

function loadEnv(): Record<string, string> {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
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

async function getAuth(keyFilePath: string) {
  const auth = new google.auth.GoogleAuth({
    keyFile: keyFilePath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth;
}

async function ensureSheetExists(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  sheetName: string,
): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets?.map(s => s.properties?.title) ?? [];
  if (existing.includes(sheetName)) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: sheetName } } }],
    },
  });
  console.error(`[Sheets] Created new sheet tab: "${sheetName}"`);
}

export async function writeSheetFromCsv(opts: SheetsWriterOptions): Promise<SheetsWriterResult> {
  const env = { ...loadEnv(), ...process.env };
  const keyFilePath = opts.keyFilePath ?? env['SERVICE_ACCOUNT_FILE'] ?? env['GOOGLE_SERVICE_ACCOUNT_KEY_FILE'];

  if (!keyFilePath) {
    throw new Error(
      'SERVICE_ACCOUNT_FILE not set in .env. ' +
      'Set it to the path of your Google service account JSON key file.'
    );
  }

  const overwrite = opts.overwrite !== false; // default true

  const csvContent = readFileSync(opts.csvPath, 'utf8');
  const { headers, rows } = parseCsv(csvContent);

  if (rows.length === 0) {
    throw new Error(`CSV at ${opts.csvPath} has no rows`);
  }

  const auth = await getAuth(keyFilePath);
  const sheets = google.sheets({ version: 'v4', auth });

  await ensureSheetExists(sheets, opts.spreadsheetId, opts.sheetName);

  const range = `'${opts.sheetName}'!A1`;

  if (overwrite) {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: opts.spreadsheetId,
      range: `'${opts.sheetName}'`,
    });
  }

  // Build 2D array: header row + data rows
  const values: string[][] = [
    headers,
    ...rows.map(row => headers.map(h => row[h] ?? '')),
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: opts.spreadsheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values },
  });

  // Get sheet ID for formatting requests
  const meta2 = await sheets.spreadsheets.get({ spreadsheetId: opts.spreadsheetId });
  const sheetMeta = meta2.data.sheets?.find(s => s.properties?.title === opts.sheetName);
  const sheetId = sheetMeta?.properties?.sheetId ?? 0;

  // Email body columns — wrap text + wider width for readability
  const emailBodyCols = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => /email\d?_body|email\d?_subject/i.test(h));

  const formatRequests: any[] = [
    // Freeze header row
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    // Bold header row
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
      },
    },
  ];

  // Wrap + widen each email body/subject column
  for (const { i } of emailBodyCols) {
    formatRequests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: 420 },
        fields: 'pixelSize',
      },
    });
    formatRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
        cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } },
        fields: 'userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment',
      },
    });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: opts.spreadsheetId,
    requestBody: { requests: formatRequests },
  });

  const url = `https://docs.google.com/spreadsheets/d/${opts.spreadsheetId}/edit`;
  console.error(`[Sheets] Wrote ${rows.length} rows + formatting to "${opts.sheetName}" → ${url}`);

  return { url, rowsWritten: rows.length, sheetName: opts.sheetName };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  return {
    csvPath: get('--csv'),
    spreadsheetId: get('--spreadsheet-id'),
    sheetName: get('--sheet-name') ?? 'Sheet1',
    overwrite: args.includes('--append') ? false : true,
  };
}

import { pathToFileURL } from 'url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { csvPath, spreadsheetId, sheetName, overwrite } = parseArgs();
  if (!csvPath || !spreadsheetId) {
    console.error('Usage: npx tsx scripts/_sheets_writer.ts --csv <path> --spreadsheet-id <id> [--sheet-name <name>] [--append]');
    process.exit(1);
  }
  writeSheetFromCsv({ csvPath, spreadsheetId, sheetName, overwrite })
    .then(r => {
      console.log(`\nDone. ${r.rowsWritten} rows written.`);
      console.log(`Sheet: ${r.url}`);
    })
    .catch(e => { console.error('FATAL:', e?.message ?? e); process.exit(1); });
}
