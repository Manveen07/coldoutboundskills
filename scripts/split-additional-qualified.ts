#!/usr/bin/env tsx
/**
 * Pre-split leads-additional-qualified.csv into N batch files for parallel
 * enrichment subagents. Each subagent reads its own file (Bug 1 fix pattern).
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const DIR = resolve(__dirname, "..", "profiles/belardi-wong/campaigns/lookalike-anchor");
const SRC = resolve(DIR, "leads-additional-qualified.csv");
const NUM_BATCHES = 5;  // 330 / 5 = 66 per batch

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

const src = parseCsv(readFileSync(SRC, "utf8"));
console.error(`Source qualified rows: ${src.rows.length}`);

const perBatch = Math.ceil(src.rows.length / NUM_BATCHES);
const sizes: number[] = [];
for (let b = 0; b < NUM_BATCHES; b++) {
  const slice = src.rows.slice(b * perBatch, (b + 1) * perBatch);
  if (slice.length === 0) { sizes.push(0); continue; }
  const path = resolve(DIR, `enrich-mv-batch-${b + 1}.csv`);
  const lines = [src.headers.map(csvEscape).join(",")];
  for (const r of slice) lines.push(r.map(csvEscape).join(","));
  writeFileSync(path, lines.join("\n"), "utf8");
  sizes.push(slice.length);
}
console.error(`Wrote ${NUM_BATCHES} batches: ${sizes.join(", ")}`);
