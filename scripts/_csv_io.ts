// ---------------------------------------------------------------------------
// Shared CSV I/O — proper quote-aware parser and writer.
//
// The naive `line.split(',')` approach used by several CLIs mangled fields
// with embedded commas, quotes, or newlines. This module centralizes a
// state-machine parser (originally from validate-final.ts) plus a matching
// writer that produces properly quoted output.
// ---------------------------------------------------------------------------

/**
 * Full-state CSV parser. Handles multi-line quoted fields (e.g., rendered_body
 * with embedded newlines) by tracking quote state across the whole input.
 *
 * Returns header row plus rows as objects keyed by header.
 */
export function parseCsv(
  text: string
): { headers: string[]; rows: Record<string, string>[] } {
  text = text.replace(/\r\n/g, '\n');
  const rawRows: string[][] = [];
  let cur = '';
  let row: string[] = [];
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQ && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (c === ',' && !inQ) {
      row.push(cur);
      cur = '';
    } else if (c === '\n' && !inQ) {
      row.push(cur);
      rawRows.push(row);
      cur = '';
      row = [];
    } else {
      cur += c;
    }
  }
  if (cur.length || row.length) {
    row.push(cur);
    rawRows.push(row);
  }

  // Filter empty trailing rows
  const cleaned = rawRows.filter(
    (r) => r.length > 1 || (r.length === 1 && r[0].length > 0)
  );

  if (cleaned.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = cleaned[0];
  const rows: Record<string, string>[] = cleaned.slice(1).map((vals) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = vals[i] ?? '';
    });
    return obj;
  });

  return { headers, rows };
}

/**
 * Quote a single CSV cell value, escaping internal quotes and wrapping in
 * double-quotes when the cell contains comma, quote, newline, or carriage
 * return.
 */
function quoteCell(value: any): string {
  const s = value == null ? '' : String(value);
  if (
    s.includes(',') ||
    s.includes('"') ||
    s.includes('\n') ||
    s.includes('\r')
  ) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Write rows to a CSV string using the provided header order. Each cell is
 * properly quoted when it contains commas, quotes, or newlines.
 *
 * Output does NOT include a trailing newline so callers can write directly
 * via fs.writeFileSync.
 */
/**
 * Write rows to CSV string.
 * headers: explicit column list. If omitted, infers from all row keys (union).
 * Extra columns in rows not in headers are silently dropped.
 * Columns in headers not in a row get empty string.
 */
export function writeCsv(
  rows: Record<string, any>[],
  headers?: string[]
): string {
  if (rows.length === 0) return headers ? headers.join(',') : '';
  const cols = headers ?? Object.keys(rows[0]);
  const lines: string[] = [cols.map(quoteCell).join(',')];
  for (const r of rows) {
    lines.push(cols.map((h) => quoteCell(r[h] ?? '')).join(','));
  }
  return lines.join('\n');
}

/**
 * Write rows preserving all original columns plus any extra columns appended at end.
 * Use this instead of writeCsv when adding enrichment columns to existing rows.
 */
export function writeCsvWithExtra(
  rows: Record<string, any>[],
  extraCols: string[]
): string {
  if (rows.length === 0) return '';
  const baseHeaders = Object.keys(rows[0]);
  const allHeaders = [...baseHeaders, ...extraCols.filter(c => !baseHeaders.includes(c))];
  return writeCsv(rows, allHeaders);
}
