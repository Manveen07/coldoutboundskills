#!/usr/bin/env tsx
/**
 * Merge 3 raw pulls (tight + widened + wider2). Dedup by person_id.
 * Identify NEW leads not in the v1 combined file. Split them into K per-batch files.
 *
 * Fixes Bug 1 from prior run (batch-boundary off-by-one): subagents read their
 * own pre-split file instead of computing row ranges. Eliminates ambiguity.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const DIR = resolve(__dirname, "..", "profiles/belardi-wong/campaigns/lookalike-anchor");
const TIGHT = resolve(DIR, "leads-raw-scale.csv");
const WIDENED = resolve(DIR, "leads-raw-widened.csv");
const WIDER2 = resolve(DIR, "leads-raw-wider2.csv");
const COMBINED_V1 = resolve(DIR, "leads-raw-combined.csv");
const COMBINED_V2 = resolve(DIR, "leads-raw-combined-v2.csv");
const NEW_LEADS = resolve(DIR, "leads-new.csv");

const NUM_BATCHES = 6;  // for the new leads dispatch

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

const tight = parseCsv(readFileSync(TIGHT, "utf8"));
const widened = parseCsv(readFileSync(WIDENED, "utf8"));
const wider2 = parseCsv(readFileSync(WIDER2, "utf8"));
const v1 = parseCsv(readFileSync(COMBINED_V1, "utf8"));

const pidIdx = tight.headers.indexOf("person_id");
const v1Pids = new Set(v1.rows.map((r) => r[pidIdx]));

// Dedup across the 3 pulls. Track which pull each lead came from.
const seen = new Set<string>();
const merged: string[][] = [];
let dupes = 0;

for (const src of [tight, widened, wider2]) {
  for (const r of src.rows) {
    const pid = r[pidIdx];
    if (!pid) continue;
    if (seen.has(pid)) { dupes++; continue; }
    seen.add(pid);
    merged.push(r);
  }
}

// Write v2 combined.
{
  const lines = [tight.headers.map(csvEscape).join(",")];
  for (const r of merged) lines.push(r.map(csvEscape).join(","));
  writeFileSync(COMBINED_V2, lines.join("\n"), "utf8");
}

// Build new-leads subset (in v2 but not in v1).
const newRows = merged.filter((r) => !v1Pids.has(r[pidIdx]));
{
  const lines = [tight.headers.map(csvEscape).join(",")];
  for (const r of newRows) lines.push(r.map(csvEscape).join(","));
  writeFileSync(NEW_LEADS, lines.join("\n"), "utf8");
}

// Pre-split new leads into per-batch files. Each subagent will read its own.
const perBatch = Math.ceil(newRows.length / NUM_BATCHES);
const batchSizes: number[] = [];
for (let b = 0; b < NUM_BATCHES; b++) {
  const slice = newRows.slice(b * perBatch, (b + 1) * perBatch);
  const path = resolve(DIR, `batch-new-${b + 1}.csv`);
  const lines = [tight.headers.map(csvEscape).join(",")];
  for (const r of slice) lines.push(r.map(csvEscape).join(","));
  writeFileSync(path, lines.join("\n"), "utf8");
  batchSizes.push(slice.length);
}

console.error(`Tight rows:               ${tight.rows.length}`);
console.error(`Widened rows:             ${widened.rows.length}`);
console.error(`Wider2 rows:              ${wider2.rows.length}`);
console.error(`Cross-set dupes dropped:  ${dupes}`);
console.error(`Combined v2 unique:       ${merged.length}`);
console.error(`Already verdicted (v1):   ${v1Pids.size}`);
console.error(`NEW leads to qualify:     ${newRows.length}`);
console.error(`Batches:                  ${NUM_BATCHES} (sizes: ${batchSizes.join(", ")})`);
console.error(`Wrote v2 combined:        ${COMBINED_V2}`);
console.error(`Wrote new leads:          ${NEW_LEADS}`);
console.error(`Wrote batch files:        batch-new-1.csv .. batch-new-${NUM_BATCHES}.csv`);
