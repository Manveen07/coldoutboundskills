#!/usr/bin/env tsx
/**
 * Post-hoc validator for the BW lookalike pipeline.
 *
 * Checks:
 *   1. All 148 raw leads have a qualifier verdict
 *   2. All qualified leads have all 4 AI variables populated (NULL is valid value)
 *   3. Routing matches v3 rules:
 *        - A: never assigned
 *        - B: ai_similarity_dimension != "NULL"
 *        - C: ai_similarity_dimension == "NULL"
 *   4. Body word counts ≤ 90 per rendered message
 *   5. No fabricated catalog observation (must be "NULL" since A is dormant)
 *   6. ai_brand_category doesn't end in "brand" (template collision)
 *   7. ai_role_hook ≤ 22 words
 *   8. ai_similarity_dimension ≤ 15 words (when not NULL)
 *   9. No em-dash in rendered body (-- or —)
 *   10. Same-company-multi-lead leads have DIFFERENT ai_role_hook
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import {
  findBannedWords,
  findBannedStarts,
  findFirstPersonObservation,
  findVagueFact,
} from "./_lib_banned";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Exported check functions (Task 13: Checks 11/11b/11c/12/13)
// ---------------------------------------------------------------------------

export interface CheckResult {
  pass: boolean;
  reason?: string;
}

export function check11_bannedWords(row: {
  signal_bridge?: string;
  signal_fact?: string;
}): CheckResult {
  const text = `${row.signal_bridge || ""} ${row.signal_fact || ""}`;

  const words = findBannedWords(text);
  if (words.length > 0) {
    return { pass: false, reason: `banned word(s): ${words.join(", ")}` };
  }

  const starts = findBannedStarts(text);
  if (starts.length > 0) {
    return {
      pass: false,
      reason: `banned sentence-start(s): ${starts.join(", ")}`,
    };
  }

  return { pass: true };
}

export function check11b_firstPersonObservation(row: {
  signal_bridge?: string;
  signal_fact?: string;
  email1_body?: string;
  email2_body?: string;
}): CheckResult {
  const text = `${row.signal_bridge || ""} ${row.signal_fact || ""} ${
    row.email1_body || ""
  } ${row.email2_body || ""}`;
  const matches = findFirstPersonObservation(text);
  if (matches.length > 0) {
    return {
      pass: false,
      reason: `first-person observation pattern(s): ${matches.join(", ")}`,
    };
  }
  return { pass: true };
}

export function check11c_vagueFact(row: { signal_fact?: string }): CheckResult {
  const fact = row.signal_fact || "";
  if (findVagueFact(fact)) {
    return {
      pass: false,
      reason: `vague-fact pattern: "${fact}" matches {season} {noun} regex without specific detail`,
    };
  }
  return { pass: true };
}

export function check12_capitalization(row: {
  email1_body?: string;
  email2_body?: string;
}): CheckResult {
  for (const field of ["email1_body", "email2_body"] as const) {
    const body = row[field] || "";
    if (!body) continue;

    const sentences = body.split(/(?<=[.!?])\s+/).filter(Boolean);
    for (const sentence of sentences) {
      const trimmed = sentence.trimStart();
      if (!trimmed) continue;
      const first = trimmed[0];
      if (!/[A-Z]/.test(first)) {
        return {
          pass: false,
          reason: `${field}: sentence-start not capitalized: "${sentence.slice(
            0,
            50
          )}..."`,
        };
      }
    }
  }
  return { pass: true };
}

export function check13_freshness(row: {
  signal_used?: string;
  signal_freshness_days?: number;
}): CheckResult {
  if (row.signal_used === "fallback" || row.signal_used === "company_snippet") {
    return { pass: true };
  }
  if ((row.signal_freshness_days ?? 0) > 90) {
    return {
      pass: false,
      reason: `signal freshness ${row.signal_freshness_days}d > 90d`,
    };
  }
  return { pass: true };
}

// ---------------------------------------------------------------------------
// CLI entry — only runs when invoked directly (not when imported by tests)
// ---------------------------------------------------------------------------

function runCli(): void {
const DIR = resolve(__dirname, "..", "profiles/belardi-wong/campaigns/lookalike-anchor");
const RAW = resolve(DIR, "leads-raw-combined-v2.csv");
const FINAL = resolve(DIR, "leads-final-v4.csv");
const ALL_QUAL = resolve(DIR, "leads-all-with-qual-v2.csv");

/**
 * Full-state CSV parser. Handles multi-line quoted fields (e.g., rendered_body
 * with embedded newlines) by tracking quote state across the whole input.
 */
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
  // Filter empty trailing rows
  const cleaned = rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].length > 0));
  return { headers: cleaned[0], rows: cleaned.slice(1) };
}
function wc(s: string): number {
  return s.split(/\s+/).filter((x) => x.length).length;
}

const issues: string[] = [];
const warnings: string[] = [];

const raw = parseCsv(readFileSync(RAW, "utf8"));
const final = parseCsv(readFileSync(FINAL, "utf8"));
const allQual = parseCsv(readFileSync(ALL_QUAL, "utf8"));

const rawPids = new Set(raw.rows.map((r) => r[raw.headers.indexOf("person_id")]));
const allQualPids = new Set(allQual.rows.map((r) => r[allQual.headers.indexOf("person_id")]));

// Check 1: all raw leads have a qualifier verdict.
let missing = 0;
for (const pid of rawPids) {
  if (!allQualPids.has(pid)) {
    issues.push(`CHECK 1: raw lead ${pid} missing from leads-all-with-qual.csv`);
    missing++;
  }
}
console.error(`Check 1 (verdict coverage):       ${missing === 0 ? "PASS" : "FAIL"} (${missing} missing)`);

// Helpers for final CSV.
const idx = (col: string) => final.headers.indexOf(col);
const F_PID = idx("person_id");
const F_FULL = idx("full_name");
const F_COMPANY = idx("company_name");
const F_CATOBS = idx("ai_catalog_observation");
const F_SIMDIM = idx("ai_similarity_dimension");
const F_CAT3 = idx("ai_brand_category");
const F_ROLE = idx("ai_role_hook");
const F_VARIANT = idx("assigned_variant");
const F_BODY = idx("email1_body");  // v4: column renamed

// Check 2: all qualified leads have all 4 AI vars populated (NULL or value).
let blanks = 0;
for (const r of final.rows) {
  for (const c of [F_CATOBS, F_SIMDIM, F_CAT3, F_ROLE]) {
    if (!r[c] || r[c].trim().length === 0) {
      issues.push(`CHECK 2: ${r[F_PID]} (${r[F_FULL]}) blank AI variable at index ${c}`);
      blanks++;
    }
  }
}
console.error(`Check 2 (AI vars present):        ${blanks === 0 ? "PASS" : "FAIL"} (${blanks} blanks)`);

// Check 3: routing matches v3 rules.
let routingErrors = 0;
let aRoutedCount = 0;
for (const r of final.rows) {
  const sim = r[F_SIMDIM];
  const v = r[F_VARIANT];
  if (v === "A") { aRoutedCount++; routingErrors++; issues.push(`CHECK 3: ${r[F_PID]} routed to A (DORMANT)`); }
  else if (sim === "NULL" && v !== "C") { routingErrors++; issues.push(`CHECK 3: ${r[F_PID]} sim=NULL but variant=${v} (should be C)`); }
  else if (sim !== "NULL" && v !== "B") { routingErrors++; issues.push(`CHECK 3: ${r[F_PID]} sim non-NULL but variant=${v} (should be B)`); }
}
console.error(`Check 3 (routing v3 rules):       ${routingErrors === 0 ? "PASS" : "FAIL"} (${routingErrors} errors, A-routed=${aRoutedCount})`);

// Check 4: body word counts ≤ 90.
let overWordCount = 0;
const bodyWords: number[] = [];
for (const r of final.rows) {
  const body = r[F_BODY];
  if (!body) continue;
  const n = wc(body);
  bodyWords.push(n);
  if (n > 90) {
    overWordCount++;
    issues.push(`CHECK 4: ${r[F_PID]} body word count ${n} > 90`);
  }
}
const avgWC = bodyWords.length ? (bodyWords.reduce((a, b) => a + b, 0) / bodyWords.length).toFixed(1) : "n/a";
const maxWC = bodyWords.length ? Math.max(...bodyWords) : 0;
const minWC = bodyWords.length ? Math.min(...bodyWords) : 0;
console.error(`Check 4 (body ≤90 words):         ${overWordCount === 0 ? "PASS" : "FAIL"} (${overWordCount} over, avg=${avgWC}, min=${minWC}, max=${maxWC})`);

// Check 5: catalog observation must be NULL (A dormant).
let catalogFabricated = 0;
for (const r of final.rows) {
  if (r[F_CATOBS] !== "NULL") {
    catalogFabricated++;
    warnings.push(`CHECK 5: ${r[F_PID]} has non-NULL ai_catalog_observation (unexpected since A dormant): ${r[F_CATOBS]}`);
  }
}
console.error(`Check 5 (catalog all NULL):       ${catalogFabricated === 0 ? "PASS" : "WARN"} (${catalogFabricated} non-NULL)`);

// Check 6: brand_category doesn't end in "brand".
let brandSuffix = 0;
for (const r of final.rows) {
  const cat = (r[F_CAT3] || "").toLowerCase().trim();
  if (cat && cat !== "null" && (cat.endsWith("brand") || cat.endsWith("brands"))) {
    brandSuffix++;
    issues.push(`CHECK 6: ${r[F_PID]} ai_brand_category="${r[F_CAT3]}" ends in brand`);
  }
}
console.error(`Check 6 (brand suffix forbidden): ${brandSuffix === 0 ? "PASS" : "FAIL"} (${brandSuffix} violations)`);

// Check 7: role_hook ≤ 22 words.
let roleOverWords = 0;
for (const r of final.rows) {
  const role = r[F_ROLE];
  if (!role || role === "NULL") continue;
  if (wc(role) > 22) {
    roleOverWords++;
    issues.push(`CHECK 7: ${r[F_PID]} ai_role_hook word count ${wc(role)} > 22: ${role}`);
  }
}
console.error(`Check 7 (role hook ≤22 words):    ${roleOverWords === 0 ? "PASS" : "FAIL"} (${roleOverWords} over)`);

// Check 8: similarity_dimension ≤ 15 words.
let simOverWords = 0;
for (const r of final.rows) {
  const sim = r[F_SIMDIM];
  if (!sim || sim === "NULL") continue;
  if (wc(sim) > 15) {
    simOverWords++;
    issues.push(`CHECK 8: ${r[F_PID]} ai_similarity_dimension word count ${wc(sim)} > 15: ${sim}`);
  }
}
console.error(`Check 8 (sim_dim ≤15 words):      ${simOverWords === 0 ? "PASS" : "FAIL"} (${simOverWords} over)`);

// Check 9: no em-dash in rendered body.
let emDashCount = 0;
for (const r of final.rows) {
  const body = r[F_BODY];
  if (!body) continue;
  if (body.includes("—") || body.includes("--")) {
    emDashCount++;
    warnings.push(`CHECK 9: ${r[F_PID]} body contains em-dash`);
  }
}
console.error(`Check 9 (no em-dash in body):     ${emDashCount === 0 ? "PASS" : "WARN"} (${emDashCount} contain dashes; note: variant B template uses em-dash intentionally)`);

// Check 10: same-company multi-lead distinct role hooks.
const sameCompany: Record<string, string[]> = {};
for (const r of final.rows) {
  const c = r[F_COMPANY];
  if (!c) continue;
  (sameCompany[c] ??= []).push(r[F_ROLE]);
}
let dupRoleHooks = 0;
for (const [co, hooks] of Object.entries(sameCompany)) {
  if (hooks.length < 2) continue;
  const set = new Set(hooks);
  if (set.size < hooks.length) {
    dupRoleHooks++;
    issues.push(`CHECK 10: company "${co}" has ${hooks.length} leads but only ${set.size} distinct role hooks`);
  }
}
console.error(`Check 10 (distinct role hooks):   ${dupRoleHooks === 0 ? "PASS" : "FAIL"} (${dupRoleHooks} companies with dup hooks)`);

// Summary.
console.error("");
console.error("=== VALIDATOR SUMMARY ===");
console.error(`Issues:    ${issues.length}`);
console.error(`Warnings:  ${warnings.length}`);
if (issues.length > 0) {
  console.error("\nISSUES:");
  for (const i of issues) console.error(`  - ${i}`);
}
if (warnings.length > 0) {
  console.error("\nWARNINGS:");
  for (const w of warnings.slice(0, 10)) console.error(`  - ${w}`);
  if (warnings.length > 10) console.error(`  ... and ${warnings.length - 10} more`);
}
process.exit(issues.length === 0 ? 0 : 1);
}

// Only run the CLI when this file is invoked directly (e.g. `npx tsx validate-final.ts`),
// not when imported by the test suite.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
