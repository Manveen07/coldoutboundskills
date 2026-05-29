#!/usr/bin/env tsx
/**
 * Join 4 qualifier-batch CSVs with the original leads-raw-combined.csv.
 * Output leads-qualified.csv (qualified=true only) and leads-all-with-qual.csv (all 148 rows annotated).
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const DIR = resolve(__dirname, "..", "profiles/belardi-wong/campaigns/lookalike-anchor");
const RAW = resolve(DIR, "leads-raw-combined.csv");
const BATCHES = [1, 2, 3, 4].map((n) => resolve(DIR, `qual-batch-${n}.csv`));
const OUT_ALL = resolve(DIR, "leads-all-with-qual.csv");
const OUT_QUAL = resolve(DIR, "leads-qualified.csv");

function parseLine(line: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === "," && !inQ) { cols.push(cur); cur = ""; }
    else cur += c;
  }
  cols.push(cur);
  return cols;
}

function parseCsv(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.length);
  return { headers: parseLine(lines[0]), rows: lines.slice(1).map(parseLine) };
}

function csvEscape(v: string): string {
  if (v === null || v === undefined) return "";
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

const raw = parseCsv(readFileSync(RAW, "utf8"));
const rawPidIdx = raw.headers.indexOf("person_id");

// Build qualifier verdict map from all batch files.
const verdicts: Record<string, { qualified: string; confidence: string; reason: string; batch: string }> = {};
for (let i = 0; i < BATCHES.length; i++) {
  const batchNum = i + 1;
  const b = parseCsv(readFileSync(BATCHES[i], "utf8"));
  const pidIdx = b.headers.indexOf("person_id");
  const qIdx = b.headers.indexOf("qualified");
  const cIdx = b.headers.indexOf("qual_confidence");
  const rIdx = b.headers.indexOf("qual_reason");
  for (const row of b.rows) {
    const pid = row[pidIdx];
    if (!pid) continue;
    verdicts[pid] = {
      qualified: row[qIdx] ?? "",
      confidence: row[cIdx] ?? "",
      reason: row[rIdx] ?? "",
      batch: String(batchNum),
    };
  }
}

// Compose annotated full set.
const allHeaders = [...raw.headers, "qualified", "qual_confidence", "qual_reason", "qual_batch"];
const allRows: string[][] = [];
let qualifiedCount = 0;
let missingVerdict = 0;
for (const row of raw.rows) {
  const pid = row[rawPidIdx];
  const v = verdicts[pid];
  if (!v) {
    missingVerdict++;
    allRows.push([...row, "", "", "", ""]);
    continue;
  }
  allRows.push([...row, v.qualified, v.confidence, v.reason, v.batch]);
  if (v.qualified === "true") qualifiedCount++;
}

// Write annotated full set.
{
  const lines = [allHeaders.map(csvEscape).join(",")];
  for (const r of allRows) lines.push(r.map(csvEscape).join(","));
  writeFileSync(OUT_ALL, lines.join("\n"), "utf8");
}

// Write qualified-only set.
{
  const qIdx = allHeaders.indexOf("qualified");
  const lines = [allHeaders.map(csvEscape).join(",")];
  for (const r of allRows) {
    if (r[qIdx] === "true") lines.push(r.map(csvEscape).join(","));
  }
  writeFileSync(OUT_QUAL, lines.join("\n"), "utf8");
}

console.error(`Raw rows:              ${raw.rows.length}`);
console.error(`Verdicts found:        ${Object.keys(verdicts).length}`);
console.error(`Missing verdicts:      ${missingVerdict}`);
console.error(`Qualified:             ${qualifiedCount}`);
console.error(`Rejected:              ${raw.rows.length - qualifiedCount - missingVerdict}`);
console.error(`Wrote: ${OUT_ALL}`);
console.error(`Wrote: ${OUT_QUAL}`);
