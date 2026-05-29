#!/usr/bin/env tsx
/**
 * 1. Merge 3 enrich-batch CSVs.
 * 2. Join with leads-qualified.csv on person_id.
 * 3. Render Variant B / C email body per lead using variants-v2.yaml v3 templates.
 * 4. Write leads-final.csv and messages-final.md.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const DIR = resolve(__dirname, "..", "profiles/belardi-wong/campaigns/lookalike-anchor");
const QUALIFIED = resolve(DIR, "leads-qualified.csv");
const ENRICH_BATCHES = [1, 2, 3].map((n) => resolve(DIR, `enrich-batch-${n}.csv`));
const OUT_FINAL = resolve(DIR, "leads-final.csv");
const OUT_MESSAGES = resolve(DIR, "messages-final.md");

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

// Variant templates (v3 — pulled from variants-v2.yaml manually for render stability).
const VARIANT_B = {
  subject: "serena & lily, year 11",
  // v3 BUG FIX: em-dash replaced with period-comma split. Aligns with
  // campaign-copywriting skill rule forbidding em-dashes in body copy.
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

// Load qualified leads.
const qual = parseCsv(readFileSync(QUALIFIED, "utf8"));
const qIdx = (col: string) => qual.headers.indexOf(col);

// Build enrich map.
const enrichMap: Record<string, { catObs: string; simDim: string; brandCat: string; roleHook: string; variant: string; batch: number }> = {};
for (let i = 0; i < ENRICH_BATCHES.length; i++) {
  const e = parseCsv(readFileSync(ENRICH_BATCHES[i], "utf8"));
  const map = (col: string) => e.headers.indexOf(col);
  for (const r of e.rows) {
    enrichMap[r[map("person_id")]] = {
      catObs: r[map("ai_catalog_observation")] ?? "NULL",
      simDim: r[map("ai_similarity_dimension")] ?? "NULL",
      brandCat: r[map("ai_brand_category")] ?? "NULL",
      roleHook: r[map("ai_role_hook")] ?? "NULL",
      variant: r[map("assigned_variant")] ?? "",
      batch: i + 1,
    };
  }
}

// Compose final dataset with rendered subject + body.
const finalHeaders = [
  ...qual.headers,
  "ai_catalog_observation",
  "ai_similarity_dimension",
  "ai_brand_category",
  "ai_role_hook",
  "assigned_variant",
  "enrich_batch",
  "rendered_subject",
  "rendered_body",
];
const finalRows: string[][] = [];
const messages: { row: string[]; subject: string; body: string }[] = [];
let bCount = 0;
let cCount = 0;
let missingEnrich = 0;

for (const row of qual.rows) {
  const pid = row[qIdx("person_id")];
  const e = enrichMap[pid];
  if (!e) {
    missingEnrich++;
    finalRows.push([...row, "", "", "", "", "", "", "", "MISSING_ENRICHMENT"]);
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
    String(e.batch),
    subject,
    body,
  ]);
  messages.push({ row, subject, body });
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
  md.push("# Final Rendered Messages — Belardi Wong Lookalike Campaign (Home Slice, v3)");
  md.push("");
  md.push(`Generated: ${new Date().toISOString()}`);
  md.push(`Anchor: Serena & Lily`);
  md.push(`Variants in use: B (active), C (active). A is DORMANT in v3 — never routed.`);
  md.push("");
  md.push(`## Summary`);
  md.push("");
  md.push(`- **Qualified leads rendered:** ${messages.length}`);
  md.push(`- **Variant B (anchor flex):** ${bCount}`);
  md.push(`- **Variant C (generic fallback):** ${cCount}`);
  md.push(`- **Missing enrichment:** ${missingEnrich}`);
  md.push("");
  md.push("Word count target per body: ≤ 90 words.");
  md.push("");
  md.push("---");
  md.push("");

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const r = m.row;
    const wordCount = m.body.split(/\s+/).filter((x) => x.length).length;
    const variant = enrichMap[r[qIdx("person_id")]]?.variant ?? "?";
    md.push(`## ${i + 1}. ${r[qIdx("full_name")]} — ${r[qIdx("current_job_title")]}`);
    md.push("");
    md.push(`**Company:** ${r[qIdx("company_name")]} (${r[qIdx("company_domain")]})`);
    md.push(`**Variant:** ${variant} | **Word count:** ${wordCount} | **Email (masked from Prospeo):** ${r[qIdx("email")]}`);
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

console.error(`Qualified leads:        ${qual.rows.length}`);
console.error(`Variant B rendered:     ${bCount}`);
console.error(`Variant C rendered:     ${cCount}`);
console.error(`Missing enrichment:     ${missingEnrich}`);
console.error(`Wrote: ${OUT_FINAL}`);
console.error(`Wrote: ${OUT_MESSAGES}`);
