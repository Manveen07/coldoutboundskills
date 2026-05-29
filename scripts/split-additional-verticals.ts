#!/usr/bin/env tsx
/**
 * Combine apparel + beauty + fnb pulls. Dedupe against already-verdicted leads
 * (leads-all-with-qual-v2.csv). Pre-split for parallel qualifier subagents.
 *
 * Tag each lead with its vertical group so the qualifier can apply vertical-aware
 * disqualifiers (e.g., apparel qualifier doesn't reject for "wrong vertical").
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const DIR = resolve(__dirname, "..", "profiles/belardi-wong/campaigns/lookalike-anchor");
const APPAREL = resolve(DIR, "leads-raw-apparel.csv");
const BEAUTY = resolve(DIR, "leads-raw-beauty.csv");
const FNB = resolve(DIR, "leads-raw-fnb.csv");
const ALREADY = resolve(DIR, "leads-all-with-qual-v2.csv");

const NUM_BATCHES = 6;  // 4 apparel + 1 beauty + 1 fnb roughly

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

const apparel = parseCsv(readFileSync(APPAREL, "utf8"));
const beauty = parseCsv(readFileSync(BEAUTY, "utf8"));
const fnb = parseCsv(readFileSync(FNB, "utf8"));
const already = parseCsv(readFileSync(ALREADY, "utf8"));

// Already-verdicted person_ids — skip them.
const alreadyPids = new Set(already.rows.map((r) => r[already.headers.indexOf("person_id")]));

// Add vertical_group column to combined output.
const headers = [...apparel.headers, "vertical_group"];
const allLeads: string[][] = [];
const seen = new Set<string>();
let crossVerticalDupes = 0;
let alreadyDupes = 0;

const addBatch = (parsed: ReturnType<typeof parseCsv>, group: string) => {
  const pidIdx = parsed.headers.indexOf("person_id");
  for (const r of parsed.rows) {
    const pid = r[pidIdx];
    if (!pid) continue;
    if (alreadyPids.has(pid)) { alreadyDupes++; continue; }
    if (seen.has(pid)) { crossVerticalDupes++; continue; }
    seen.add(pid);
    allLeads.push([...r, group]);
  }
};

addBatch(apparel, "apparel");
addBatch(beauty, "beauty");
addBatch(fnb, "fnb");

console.error(`Apparel rows:                  ${apparel.rows.length}`);
console.error(`Beauty rows:                   ${beauty.rows.length}`);
console.error(`F&B rows:                      ${fnb.rows.length}`);
console.error(`Already-verdicted dupes:       ${alreadyDupes}`);
console.error(`Cross-vertical dupes (dropped): ${crossVerticalDupes}`);
console.error(`Net new leads to qualify:      ${allLeads.length}`);

// Write combined.
{
  const lines = [headers.map(csvEscape).join(",")];
  for (const r of allLeads) lines.push(r.map(csvEscape).join(","));
  writeFileSync(resolve(DIR, "leads-additional-combined.csv"), lines.join("\n"), "utf8");
}

// Pre-split into batches.
const perBatch = Math.ceil(allLeads.length / NUM_BATCHES);
const batchSizes: number[] = [];
for (let b = 0; b < NUM_BATCHES; b++) {
  const slice = allLeads.slice(b * perBatch, (b + 1) * perBatch);
  if (slice.length === 0) { batchSizes.push(0); continue; }
  const path = resolve(DIR, `batch-additional-${b + 1}.csv`);
  const lines = [headers.map(csvEscape).join(",")];
  for (const r of slice) lines.push(r.map(csvEscape).join(","));
  writeFileSync(path, lines.join("\n"), "utf8");
  batchSizes.push(slice.length);
}
console.error(`Batches:                       ${NUM_BATCHES} (sizes: ${batchSizes.join(", ")})`);
console.error(`Wrote leads-additional-combined.csv + batch-additional-1..${NUM_BATCHES}.csv`);
