#!/usr/bin/env tsx
/**
 * Split leads-final-v4.csv into 5 separate CSVs by smartlead_campaign column.
 * One file per Smartlead campaign. Each ready for upload.
 *
 * Strips internal-only columns (qual_reason, source, batch metadata) and keeps
 * only what Smartlead needs: lead identity + custom variables + the 4 rendered
 * emails per lead.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

const DIR = resolve(__dirname, "..", "profiles/belardi-wong/campaigns/lookalike-anchor");
const SRC = resolve(DIR, "leads-final-v4.csv");
const OUT_DIR = resolve(DIR, "smartlead-campaigns");

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

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

// Smartlead-friendly columns. Order matters for human reading.
const SMARTLEAD_COLS = [
  "email",                  // Required by Smartlead
  "first_name",             // Standard Smartlead variable
  "last_name",
  "full_name",
  "company_name",           // Standard Smartlead variable
  "current_job_title",
  "person_state",
  "company_domain",
  "company_industry",
  "primary_vertical",       // For tagging in Smartlead
  // Custom Smartlead variables (per-lead, plug into {{var}} in sequence templates):
  "vertical_anchor",        // {{vertical_anchor}}
  "ai_similarity_dimension",// {{ai_similarity_dimension}}
  "ai_brand_category",      // {{ai_brand_category}}
  "ai_role_hook",           // {{ai_role_hook}}
  // Assignment + variant routing:
  "assigned_variant",       // B or C
  // Pre-rendered emails (use if uploading bodies directly vs Smartlead templates):
  "email1_subject", "email1_body",
  "email2_subject", "email2_body",
  "email3_subject", "email3_body",
  "email4_subject", "email4_body",
  // QA metadata + selection rationale (one sentence per lead, used for team review):
  "qual_confidence",
  "qual_reason",
];

const srcIdx = (col: string) => src.headers.indexOf(col);

// Group rows by smartlead_campaign.
const campaignIdx = srcIdx("smartlead_campaign");
const groups: Record<string, string[][]> = {};
for (const r of src.rows) {
  const campaign = r[campaignIdx] || "BW-Other-2026Q2";
  (groups[campaign] ??= []).push(r);
}

console.error(`Source rows: ${src.rows.length}`);
console.error(`Campaigns:   ${Object.keys(groups).length}`);
console.error("");

for (const [campaign, rows] of Object.entries(groups)) {
  const path = resolve(OUT_DIR, `${campaign}.csv`);
  const lines = [SMARTLEAD_COLS.map(csvEscape).join(",")];
  for (const r of rows) {
    const out = SMARTLEAD_COLS.map((col) => {
      const i = srcIdx(col);
      return i === -1 ? "" : (r[i] ?? "");
    });
    lines.push(out.map(csvEscape).join(","));
  }
  writeFileSync(path, lines.join("\n"), "utf8");
  console.error(`${campaign.padEnd(40)} ${String(rows.length).padStart(3)} leads → ${path}`);
}
