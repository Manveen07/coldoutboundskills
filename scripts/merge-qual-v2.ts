#!/usr/bin/env tsx
/**
 * Merge all qualifier verdicts (v1 batches 1-4 + new batches new-1..new-6 + fix lead)
 * into leads-all-with-qual-v2.csv. Build leads-qualified-v2.csv. Then split the
 * NEWLY-qualified-only set into per-batch files for enrichment.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const DIR = resolve(__dirname, "..", "profiles/belardi-wong/campaigns/lookalike-anchor");
const RAW_V2 = resolve(DIR, "leads-raw-combined-v2.csv");
const QUAL_V1 = resolve(DIR, "leads-all-with-qual.csv");  // already-merged v1 verdicts
const NEW_BATCHES = [1, 2, 3, 4, 5, 6].map((n) => resolve(DIR, `qual-batch-new-${n}.csv`));
const OUT_ALL = resolve(DIR, "leads-all-with-qual-v2.csv");
const OUT_QUAL = resolve(DIR, "leads-qualified-v2.csv");

const NUM_ENRICH_BATCHES = 3;  // split NEW qualified across 3 enrich subagents

function parseCsv(text: string) {
  text = text.replace(/\r\n/g, "\n");
  const rows: string[][] = [];
  let cur = "";
  let row: string[] = [];
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQ && text[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === "," && !inQ) { row.push(cur); cur = ""; }
    else if (c === "\n" && !inQ) { row.push(cur); rows.push(row); cur = ""; row = []; }
    else cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  const cleaned = rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].length > 0));
  return { headers: cleaned[0], rows: cleaned.slice(1) };
}
function csvEscape(v: string): string {
  if (v === null || v === undefined) return "";
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

// Step 1: build verdict map from v1 (already includes qual_batch column) + new batches.
const verdicts: Record<string, { qualified: string; conf: string; reason: string; batch: string }> = {};

// v1 verdicts: from leads-all-with-qual.csv (has qual columns for the 148 leads)
const v1 = parseCsv(readFileSync(QUAL_V1, "utf8"));
const v1Idx = (col: string) => v1.headers.indexOf(col);
for (const r of v1.rows) {
  const q = r[v1Idx("qualified")];
  if (!q) continue;  // not all rows have verdicts (shouldn't happen but defensive)
  verdicts[r[v1Idx("person_id")]] = {
    qualified: q,
    conf: r[v1Idx("qual_confidence")] ?? "",
    reason: r[v1Idx("qual_reason")] ?? "",
    batch: r[v1Idx("qual_batch")] ?? "v1",
  };
}

// New batches.
for (let i = 0; i < NEW_BATCHES.length; i++) {
  const bp = NEW_BATCHES[i];
  if (!existsSync(bp)) { console.error(`MISSING: ${bp}`); continue; }
  const b = parseCsv(readFileSync(bp, "utf8"));
  const pidI = b.headers.indexOf("person_id");
  const qI = b.headers.indexOf("qualified");
  const cI = b.headers.indexOf("qual_confidence");
  const rI = b.headers.indexOf("qual_reason");
  for (const row of b.rows) {
    verdicts[row[pidI]] = {
      qualified: row[qI] ?? "",
      conf: row[cI] ?? "",
      reason: row[rI] ?? "",
      batch: `new-${i + 1}`,
    };
  }
}

// Step 2: write leads-all-with-qual-v2.csv (all 412 leads, annotated).
const raw = parseCsv(readFileSync(RAW_V2, "utf8"));
const rawPidIdx = raw.headers.indexOf("person_id");
const outHeaders = [...raw.headers, "qualified", "qual_confidence", "qual_reason", "qual_batch"];
const outRows: string[][] = [];
let qualifiedCount = 0;
let missingVerdict = 0;
for (const r of raw.rows) {
  const v = verdicts[r[rawPidIdx]];
  if (!v) {
    missingVerdict++;
    outRows.push([...r, "", "", "", ""]);
    continue;
  }
  outRows.push([...r, v.qualified, v.conf, v.reason, v.batch]);
  if (v.qualified === "true") qualifiedCount++;
}
{
  const lines = [outHeaders.map(csvEscape).join(",")];
  for (const r of outRows) lines.push(r.map(csvEscape).join(","));
  writeFileSync(OUT_ALL, lines.join("\n"), "utf8");
}

// Step 3: write leads-qualified-v2.csv (qualified only).
const qIdx = outHeaders.indexOf("qualified");
const qualRows = outRows.filter((r) => r[qIdx] === "true");
{
  const lines = [outHeaders.map(csvEscape).join(",")];
  for (const r of qualRows) lines.push(r.map(csvEscape).join(","));
  writeFileSync(OUT_QUAL, lines.join("\n"), "utf8");
}

// Step 4: find the NEW qualified (those whose qual_batch starts with "new-").
const batchIdx = outHeaders.indexOf("qual_batch");
const newQualRows = outRows.filter((r) => r[qIdx] === "true" && r[batchIdx].startsWith("new-"));

// Pre-split newly-qualified into K enrichment batches.
const perBatch = Math.ceil(newQualRows.length / NUM_ENRICH_BATCHES);
const enrichBatchSizes: number[] = [];
for (let b = 0; b < NUM_ENRICH_BATCHES; b++) {
  const slice = newQualRows.slice(b * perBatch, (b + 1) * perBatch);
  const path = resolve(DIR, `enrich-new-batch-${b + 1}.csv`);
  const lines = [outHeaders.map(csvEscape).join(",")];
  for (const r of slice) lines.push(r.map(csvEscape).join(","));
  writeFileSync(path, lines.join("\n"), "utf8");
  enrichBatchSizes.push(slice.length);
}

console.error(`Raw leads (v2):              ${raw.rows.length}`);
console.error(`Verdicts collected:          ${Object.keys(verdicts).length}`);
console.error(`Missing verdicts:            ${missingVerdict}`);
console.error(`Qualified (all):             ${qualifiedCount}`);
console.error(`  from v1:                   ${qualRows.filter((r) => !r[batchIdx].startsWith("new-")).length}`);
console.error(`  from new pulls:            ${newQualRows.length}`);
console.error(`Wrote: ${OUT_ALL}`);
console.error(`Wrote: ${OUT_QUAL}`);
console.error(`Enrich batches:              ${NUM_ENRICH_BATCHES} (sizes: ${enrichBatchSizes.join(", ")})`);
console.error(`Wrote: enrich-new-batch-1.csv .. enrich-new-batch-${NUM_ENRICH_BATCHES}.csv`);
