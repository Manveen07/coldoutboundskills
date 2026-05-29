#!/usr/bin/env tsx
/**
 * Extract athletic + footwear leads from leads-additional-qualified.csv.
 * Pre-split into a single batch file for re-enrichment with new anchors
 * (Title Nine for athletic, Birkenstock for footwear). v4 fix to lift
 * those verticals from generic Variant C to anchored Variant B.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const DIR = resolve(__dirname, "..", "profiles/belardi-wong/campaigns/lookalike-anchor");
const SRC = resolve(DIR, "leads-additional-qualified.csv");

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
const pvIdx = src.headers.indexOf("primary_vertical");
const athleticFootwear = src.rows.filter((r) => {
  const pv = r[pvIdx];
  return pv === "athletic" || pv === "footwear";
});

const out = resolve(DIR, "batch-athletic-footwear.csv");
const lines = [src.headers.map(csvEscape).join(",")];
for (const r of athleticFootwear) lines.push(r.map(csvEscape).join(","));
writeFileSync(out, lines.join("\n"), "utf8");

console.error(`Athletic + footwear leads:  ${athleticFootwear.length}`);
console.error(`  athletic: ${athleticFootwear.filter((r) => r[pvIdx] === "athletic").length}`);
console.error(`  footwear: ${athleticFootwear.filter((r) => r[pvIdx] === "footwear").length}`);
console.error(`Wrote: ${out}`);
