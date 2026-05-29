#!/usr/bin/env tsx
/**
 * Merge tight + widened Prospeo pulls into one combined raw CSV.
 * Dedupe by person_id. Keep first occurrence.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const DIR = resolve(__dirname, "..", "profiles/belardi-wong/campaigns/lookalike-anchor");
const TIGHT = resolve(DIR, "leads-raw-scale.csv");
const WIDENED = resolve(DIR, "leads-raw-widened.csv");
const OUT = resolve(DIR, "leads-raw-combined.csv");

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.length);
  const parseLine = (line: string): string[] => {
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
  };
  return {
    headers: parseLine(lines[0]),
    rows: lines.slice(1).map(parseLine),
  };
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

if (JSON.stringify(tight.headers) !== JSON.stringify(widened.headers)) {
  console.error("ERROR: header mismatch between tight and widened. Cannot merge.");
  process.exit(1);
}

const pidIdx = tight.headers.indexOf("person_id");
if (pidIdx === -1) {
  console.error("ERROR: person_id column missing.");
  process.exit(1);
}

const seen = new Set<string>();
const merged: string[][] = [];
let dupesAcross = 0;
for (const r of tight.rows) {
  const pid = r[pidIdx];
  if (!pid || seen.has(pid)) continue;
  seen.add(pid);
  merged.push(r);
}
for (const r of widened.rows) {
  const pid = r[pidIdx];
  if (!pid) continue;
  if (seen.has(pid)) { dupesAcross++; continue; }
  seen.add(pid);
  merged.push(r);
}

const lines = [tight.headers.map(csvEscape).join(",")];
for (const row of merged) {
  lines.push(row.map(csvEscape).join(","));
}
writeFileSync(OUT, lines.join("\n"), "utf8");

console.error(`Tight rows:     ${tight.rows.length}`);
console.error(`Widened rows:   ${widened.rows.length}`);
console.error(`Cross-set dupes (dropped from widened): ${dupesAcross}`);
console.error(`Merged unique:  ${merged.length}`);
console.error(`Wrote:          ${OUT}`);
