#!/usr/bin/env tsx
/**
 * Merge 6 multi-vertical qualifier batch CSVs. Tally by vertical.
 * Write leads-additional-qualified.csv (qualified only) and tally per vertical.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const DIR = resolve(__dirname, "..", "profiles/belardi-wong/campaigns/lookalike-anchor");
const BATCHES = [1, 2, 3, 4, 5, 6].map((n) => resolve(DIR, `qual-additional-${n}.csv`));
const COMBINED = resolve(DIR, "leads-additional-combined.csv");
const OUT_QUAL = resolve(DIR, "leads-additional-qualified.csv");
const OUT_ALL = resolve(DIR, "leads-additional-all.csv");

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

// Load combined raw.
const raw = parseCsv(readFileSync(COMBINED, "utf8"));
const rawPidIdx = raw.headers.indexOf("person_id");

// Build verdict map.
type V = { q: string; conf: string; reason: string; pv: string; batch: number };
const verdicts: Record<string, V> = {};
for (let i = 0; i < BATCHES.length; i++) {
  const b = parseCsv(readFileSync(BATCHES[i], "utf8"));
  const pIdx = b.headers.indexOf("person_id");
  const qIdx = b.headers.indexOf("qualified");
  const cIdx = b.headers.indexOf("qual_confidence");
  const rIdx = b.headers.indexOf("qual_reason");
  const vIdx = b.headers.indexOf("primary_vertical");
  for (const r of b.rows) {
    // Normalize qualified column (subagents drifted to yes/no/YES/NO instead of true/false).
    const rawQ = (r[qIdx] ?? "").trim().toLowerCase();
    const q = rawQ === "true" || rawQ === "yes" ? "true" :
              rawQ === "false" || rawQ === "no" ? "false" :
              rawQ;
    verdicts[r[pIdx]] = {
      q,
      conf: r[cIdx] ?? "",
      reason: r[rIdx] ?? "",
      pv: r[vIdx] ?? "",
      batch: i + 1,
    };
  }
}

// Compose annotated all + qualified-only sets.
const outHeaders = [...raw.headers, "qualified", "qual_confidence", "qual_reason", "primary_vertical", "qual_batch"];
const allRows: string[][] = [];
const qualRows: string[][] = [];
let missing = 0;
for (const r of raw.rows) {
  const pid = r[rawPidIdx];
  const v = verdicts[pid];
  if (!v) {
    missing++;
    allRows.push([...r, "", "", "", "", ""]);
    continue;
  }
  const out = [...r, v.q, v.conf, v.reason, v.pv, String(v.batch)];
  allRows.push(out);
  if (v.q === "true") qualRows.push(out);
}

// Write outputs.
const lines1 = [outHeaders.map(csvEscape).join(",")];
for (const r of allRows) lines1.push(r.map(csvEscape).join(","));
writeFileSync(OUT_ALL, lines1.join("\n"), "utf8");

const lines2 = [outHeaders.map(csvEscape).join(",")];
for (const r of qualRows) lines2.push(r.map(csvEscape).join(","));
writeFileSync(OUT_QUAL, lines2.join("\n"), "utf8");

// Tally per vertical group + primary vertical.
const pvIdx = outHeaders.indexOf("primary_vertical");
const vgIdx = outHeaders.indexOf("vertical_group");

const qualByVertical: Record<string, number> = {};
const rawByVertical: Record<string, number> = {};
const qualByGroup: Record<string, number> = {};
const rawByGroup: Record<string, number> = {};

for (const r of allRows) {
  const pv = r[pvIdx] || "(no verdict)";
  const vg = r[vgIdx] || "(none)";
  rawByVertical[pv] = (rawByVertical[pv] || 0) + 1;
  rawByGroup[vg] = (rawByGroup[vg] || 0) + 1;
  if (r[outHeaders.indexOf("qualified")] === "true") {
    qualByVertical[pv] = (qualByVertical[pv] || 0) + 1;
    qualByGroup[vg] = (qualByGroup[vg] || 0) + 1;
  }
}

console.error(`Raw rows:           ${raw.rows.length}`);
console.error(`Verdicts collected: ${Object.keys(verdicts).length}`);
console.error(`Missing verdicts:   ${missing}`);
console.error(`Qualified total:    ${qualRows.length}`);
console.error(`Rejected total:     ${allRows.length - qualRows.length - missing}`);
console.error("");
console.error("Tally by Prospeo vertical_group:");
for (const [k, n] of Object.entries(rawByGroup).sort((a, b) => b[1] - a[1])) {
  const q = qualByGroup[k] || 0;
  const pct = n > 0 ? (100 * q / n).toFixed(1) : "0.0";
  console.error(`  ${k.padEnd(15)} ${q.toString().padStart(4)} / ${n.toString().padStart(4)} = ${pct}% qual rate`);
}
console.error("");
console.error("Tally by primary_vertical (qualifier-assigned):");
for (const [k, n] of Object.entries(rawByVertical).sort((a, b) => b[1] - a[1])) {
  const q = qualByVertical[k] || 0;
  console.error(`  ${k.padEnd(20)} raw=${n.toString().padStart(4)}, qual=${q.toString().padStart(4)}`);
}
console.error("");
console.error(`Wrote: ${OUT_QUAL}`);
console.error(`Wrote: ${OUT_ALL}`);
