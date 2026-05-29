#!/usr/bin/env tsx
/**
 * v2 of merge-enrich-and-render. Joins:
 *   - leads-qualified-v2.csv (56 qualified leads, both v1 and new)
 *   - v1 enrich batches (enrich-batch-1.csv ... enrich-batch-3.csv) for the 39 v1 leads
 *   - new enrich results (enrich-new-result-1.csv ... enrich-new-result-3.csv) for the 17 new leads
 * Renders each lead's message using the FIXED Variant B template (em-dash removed).
 * Writes leads-final-v2.csv and messages-final-v2.md.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const DIR = resolve(__dirname, "..", "profiles/belardi-wong/campaigns/lookalike-anchor");
const QUALIFIED = resolve(DIR, "leads-qualified-v2.csv");
const V1_ENRICH = [1, 2, 3].map((n) => resolve(DIR, `enrich-batch-${n}.csv`));
const NEW_ENRICH = [1, 2, 3].map((n) => resolve(DIR, `enrich-new-result-${n}.csv`));
const OUT_FINAL = resolve(DIR, "leads-final-v2.csv");
const OUT_MESSAGES = resolve(DIR, "messages-final-v2.md");

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

// Variant templates — v3 with em-dash bug fix.
const VARIANT_B = {
  subject: "serena & lily, year 11",
  body: ({ first_name, company_name, ai_role_hook }: any) =>
    `${first_name}, year 11 of running direct mail for Serena & Lily. ${company_name} reminds me of where they were around 2017. Same AOV bracket, same catalog cadence, same store-plus-DTC mix.

What compounded for them: disciplined format and frequency testing, twice a year, every year. Less about big creative swings, more about reading the data and adjusting.

${ai_role_hook}. Worth comparing notes on what worked for them?`,
};
const VARIANT_C = {
  subject: "premium home benchmarks",
  body: ({ first_name, ai_brand_category, ai_role_hook }: any) =>
    `${first_name}, you run a ${ai_brand_category} brand at the premium end of your category. We run direct mail for Serena & Lily and most of the premium home retailers you'd recognize.

One pattern from our portfolio worth a 15-minute conversation: DM-acquired customers consistently outperform digital-acquired on LTV across the brands we work with. Economics get more interesting the higher your AOV.

${ai_role_hook}. Want me to send the home-category benchmark deck?`,
};

// Load all enrichment outputs into a map by person_id.
const enrichMap: Record<string, { catObs: string; simDim: string; brandCat: string; roleHook: string; variant: string; src: string }> = {};
for (const set of [{ files: V1_ENRICH, srcPrefix: "v1-batch-" }, { files: NEW_ENRICH, srcPrefix: "new-result-" }]) {
  for (let i = 0; i < set.files.length; i++) {
    const fp = set.files[i];
    if (!existsSync(fp)) continue;
    const e = parseCsv(readFileSync(fp, "utf8"));
    const m = (col: string) => e.headers.indexOf(col);
    for (const r of e.rows) {
      enrichMap[r[m("person_id")]] = {
        catObs: r[m("ai_catalog_observation")] ?? "NULL",
        simDim: r[m("ai_similarity_dimension")] ?? "NULL",
        brandCat: r[m("ai_brand_category")] ?? "NULL",
        roleHook: r[m("ai_role_hook")] ?? "NULL",
        variant: r[m("assigned_variant")] ?? "",
        src: `${set.srcPrefix}${i + 1}`,
      };
    }
  }
}

const qual = parseCsv(readFileSync(QUALIFIED, "utf8"));
const qIdx = (col: string) => qual.headers.indexOf(col);

const finalHeaders = [
  ...qual.headers,
  "ai_catalog_observation",
  "ai_similarity_dimension",
  "ai_brand_category",
  "ai_role_hook",
  "assigned_variant",
  "enrich_source",
  "rendered_subject",
  "rendered_body",
];
const finalRows: string[][] = [];
const messages: { row: string[]; subject: string; body: string; variant: string; src: string }[] = [];
let bCount = 0;
let cCount = 0;
let missingEnrich = 0;

for (const row of qual.rows) {
  const pid = row[qIdx("person_id")];
  const e = enrichMap[pid];
  if (!e) {
    missingEnrich++;
    finalRows.push([...row, "", "", "", "", "MISSING", "", "", "MISSING_ENRICHMENT"]);
    continue;
  }
  const ctx = {
    first_name: row[qIdx("first_name")],
    company_name: row[qIdx("company_name")],
    ai_brand_category: e.brandCat,
    ai_role_hook: e.roleHook,
  };
  let subject = "";
  let body = "";
  if (e.variant === "B") {
    subject = VARIANT_B.subject;
    body = VARIANT_B.body(ctx);
    bCount++;
  } else if (e.variant === "C") {
    subject = VARIANT_C.subject;
    body = VARIANT_C.body(ctx);
    cCount++;
  } else {
    body = `[ROUTING ERROR: variant=${e.variant}]`;
  }
  finalRows.push([
    ...row,
    e.catObs,
    e.simDim,
    e.brandCat,
    e.roleHook,
    e.variant,
    e.src,
    subject,
    body,
  ]);
  messages.push({ row, subject, body, variant: e.variant, src: e.src });
}

// Write final CSV.
{
  const lines = [finalHeaders.map(csvEscape).join(",")];
  for (const r of finalRows) lines.push(r.map(csvEscape).join(","));
  writeFileSync(OUT_FINAL, lines.join("\n"), "utf8");
}

// Write messages markdown.
{
  const md: string[] = [];
  md.push("# Final Rendered Messages — Belardi Wong Lookalike Campaign (Home Slice, v3, em-dash fixed)");
  md.push("");
  md.push(`Generated: ${new Date().toISOString()}`);
  md.push("Anchor: Serena & Lily");
  md.push("Variants active: B (anchor flex), C (generic fallback). A is DORMANT.");
  md.push("");
  md.push("## Summary");
  md.push("");
  md.push(`- **Total qualified leads:** ${messages.length}`);
  md.push(`  - **Variant B:** ${bCount}`);
  md.push(`  - **Variant C:** ${cCount}`);
  md.push(`  - **Missing enrichment:** ${missingEnrich}`);
  md.push("");
  md.push("Body word-count target: ≤ 90.");
  md.push("v3 fixes applied: em-dash removed from Variant B body, Lull category fixed, ai_role_hook added.");
  md.push("");
  md.push("---");
  md.push("");
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const r = m.row;
    const wordCount = m.body.split(/\s+/).filter((x) => x.length).length;
    md.push(`## ${i + 1}. ${r[qIdx("full_name")]} — ${r[qIdx("current_job_title")]}`);
    md.push("");
    md.push(`**Company:** ${r[qIdx("company_name")]} (${r[qIdx("company_domain")]})`);
    md.push(`**Variant:** ${m.variant} | **Word count:** ${wordCount} | **Enrich source:** ${m.src} | **Email (masked):** ${r[qIdx("email")]}`);
    md.push("");
    md.push(`**Subject:** ${m.subject}`);
    md.push("");
    md.push("```");
    md.push(m.body);
    md.push("```");
    md.push("");
    md.push("---");
    md.push("");
  }
  writeFileSync(OUT_MESSAGES, md.join("\n"), "utf8");
}

console.error(`Qualified loaded:        ${qual.rows.length}`);
console.error(`Enrichment map entries:  ${Object.keys(enrichMap).length}`);
console.error(`Variant B rendered:      ${bCount}`);
console.error(`Variant C rendered:      ${cCount}`);
console.error(`Missing enrichment:      ${missingEnrich}`);
console.error(`Wrote: ${OUT_FINAL}`);
console.error(`Wrote: ${OUT_MESSAGES}`);
