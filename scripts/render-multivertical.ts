#!/usr/bin/env tsx
/**
 * Multi-anchor render for the 330 multi-vertical qualified leads. Plus reuse
 * the 56 home-vertical leads already rendered. Output combined messages-final-v3.md
 * containing all 386 emails.
 *
 * Variant B is now parameterized by vertical_anchor (Serena & Lily / Bombas / AG / Sundance).
 * Variant C is parameterized by vertical retailers phrase.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const DIR = resolve(__dirname, "..", "profiles/belardi-wong/campaigns/lookalike-anchor");
const QUAL_HOME = resolve(DIR, "leads-qualified-v2.csv");
const QUAL_MV = resolve(DIR, "leads-additional-qualified.csv");

const HOME_ENRICH = [1, 2, 3].map((n) => resolve(DIR, `enrich-batch-${n}.csv`));
const HOME_ENRICH_NEW = [1, 2, 3].map((n) => resolve(DIR, `enrich-new-result-${n}.csv`));
const MV_ENRICH = [1, 2, 3, 4, 5].map((n) => resolve(DIR, `enrich-mv-result-${n}.csv`));
// v4 override: re-enriched athletic + footwear leads with Title Nine / Birkenstock
// anchors. Loaded LAST so it overrides prior C verdicts.
const ATHLETIC_FOOTWEAR_OVERRIDE = [resolve(DIR, "enrich-athletic-footwear.csv")];

const OUT_FINAL = resolve(DIR, "leads-final-v4.csv");
const OUT_MESSAGES = resolve(DIR, "messages-final-v4.md");

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

// Anchor-specific proof claims for Variant B. NO em-dashes (campaign-copywriting
// skill rule). Tightened to keep total body under 90 words.
// v4: added Title Nine (athletic) and Birkenstock (footwear) so those verticals
// lift from generic C to anchored B. Both are real BW clients (digital + Swift).
const ANCHOR_PROOF: Record<string, string> = {
  "Serena & Lily": "year 11 of running direct mail for Serena & Lily. {{company_name}} reminds me of where they were around 2017",
  "Bombas": "we run direct mail for Bombas. Scaled from a single test into their core profitable acquisition channel. {{company_name}} sits in the same lane",
  "AG": "we run direct mail for AG, built on transactional-data targeting for higher-value denim buyers. {{company_name}} is in the same bracket",
  "Paige": "we run direct mail for Paige, scaled into a profitable acquisition motion. {{company_name}} sits in the same lane",
  "Sundance": "we run direct mail for Sundance. Lifted new customer acquisition 36 points in six months. {{company_name}} reminds me of them",
  "Title Nine": "we run paid digital for Title Nine. Restructured funnel-based paid media for clean ROAS lift on prospecting. {{company_name}} sits in the same lane",
  "Birkenstock": "Birkenstock runs our Swift programmatic direct mail. Co-op transactional data lifted their ecommerce conversion. {{company_name}} could test the same play",
};

const VERTICAL_RETAILER_PHRASE: Record<string, string> = {
  home: "Serena & Lily and most of the premium home retailers you'd recognize",
  apparel: "Bombas, Vera Bradley, Anthropologie, and most of the premium apparel brands you'd recognize",
  denim: "AG, Paige, and most of the premium denim brands",
  lifestyle_apparel: "Sundance, Natural Life, and most of the premium lifestyle brands",
  athletic: "Title Nine and premium athletic brands we work with",
  footwear: "Birkenstock and premium footwear brands we work with",
  beauty: "300+ premium DTC brands across home, apparel, and adjacent categories",
  food_bev: "300+ premium DTC brands across home, apparel, and lifestyle",
};

function renderVariantB(ctx: { first_name: string; company_name: string; vertical_anchor: string; ai_similarity_dimension: string; ai_role_hook: string }): { subject: string; body: string } {
  const anchorClaim = ANCHOR_PROOF[ctx.vertical_anchor] ?? `we run direct mail for ${ctx.vertical_anchor}. {{company_name}} reminds me of them`;
  const claim = anchorClaim.replace(/\{\{company_name\}\}/g, ctx.company_name);
  const subject = ctx.vertical_anchor === "Serena & Lily" ? "serena & lily, year 11" : `the ${ctx.vertical_anchor.toLowerCase().replace(/&/g, "and")} playbook`;
  const body = `${ctx.first_name}, ${claim} on ${ctx.ai_similarity_dimension}.

What compounded for them: disciplined format and frequency testing, twice a year, every year. Less about big creative swings, more about reading the data and adjusting.

${ctx.ai_role_hook}. Worth comparing notes on what worked for them?`;
  return { subject, body };
}

// Email 2 (Day 3, threaded follow-up) — vertical-aware secondary-anchor stat.
// Same secondary anchor (DWR for home, Bombas for apparel where Bombas wasn't primary, etc.)
// to vary social proof from Email 1.
const SECONDARY_ANCHOR_PROOF: Record<string, string> = {
  home: "DWR (closest analogue in your category in our portfolio) saw 20%+ productivity improvement on their existing DM program in year one",
  apparel: "one of our women's lifestyle clients saw DM-acquired customers carry 103% higher LTV than the cohort they acquired on Meta",
  lifestyle_apparel: "Sundance lifted new customer acquisition 36 points in six months after we restructured spend across DM and digital",
  denim: "AG (in our portfolio) acquired higher-value denim customers using transactional-data DM targeting",
  athletic: "Title Nine (in our portfolio) restructured funnel-based paid media for clean ROAS lift on prospecting",
  footwear: "Birkenstock (our Swift programmatic DM client) lifted ecommerce conversion via co-op transactional data",
  beauty: "one of our women's lifestyle clients saw DM-acquired customers carry 103% higher LTV than the cohort they acquired on Meta",
  food_bev: "one of our women's lifestyle clients saw DM-acquired customers carry 103% higher LTV than digital",
};

function renderEmail2(ctx: { first_name: string; company_name: string; primary_vertical: string }): { subject: string; body: string } {
  const proof = SECONDARY_ANCHOR_PROOF[ctx.primary_vertical] ?? SECONDARY_ANCHOR_PROOF.home;
  const subject = "";  // threaded — empty subject for Smartlead thread continuation
  const body = `${ctx.first_name}, one stat worth flagging: ${proof}.

At ${ctx.company_name}'s AOV, that kind of LTV gap compounds fast. Most premium DTC brands we work with discover the gap only after they hit a wall on paid social.

Want me to send the category benchmark deck?`;
  return { subject, body };
}

function renderEmail3(ctx: { first_name: string; company_name: string }): { subject: string; body: string } {
  // Channel-risk pivot (auction volatility / iOS 14 / diversification).
  const subject = "channel risk";
  const body = `${ctx.first_name}, two years ago most premium DTC brands we work with had Meta and Google owning the majority of their acquisition mix. That share is dropping. CACs went unstable, auctions got harder to forecast, CFOs started asking why one platform owned that much of the P&L.

Direct mail isn't a Meta replacement, it's the diversification. The data behind it: co-op transactional records across 4,000+ brands. Doesn't get re-priced when Apple changes the rules.

How concentrated is ${ctx.company_name}'s acquisition mix?`;
  return { subject, body };
}

function renderEmail4(ctx: { first_name: string; company_name: string }): { subject: string; body: string } {
  // Final — free audit offer + soft redirect.
  const subject = "free audit?";
  const body = `${ctx.first_name}, last note from me. We can run a no-strings audit of ${ctx.company_name}'s current direct mail or paid acquisition program. Last 2-3 drops or last quarter of spend, annotated PDF, recommendations on segmentation, format, and frequency. Five business days, no pitch attached.

Useful, or should I close the loop with someone else on your team?`;
  return { subject, body };
}

function renderVariantC(ctx: { first_name: string; ai_brand_category: string; ai_role_hook: string; primary_vertical: string }): { subject: string; body: string } {
  // v4 strengthened C for beauty + food_bev: stat-led opener instead of generic
  // "premium end of your category" phrase. Acknowledges 25-year portfolio.
  const isBeautyOrFnb = ctx.primary_vertical === "beauty" || ctx.primary_vertical === "food_bev";

  const subject = ctx.primary_vertical === "home" ? "premium home benchmarks" :
                  ctx.primary_vertical === "apparel" || ctx.primary_vertical === "lifestyle_apparel" ? "premium apparel benchmarks" :
                  ctx.primary_vertical === "denim" ? "premium denim benchmarks" :
                  ctx.primary_vertical === "beauty" ? "DM economics for premium beauty" :
                  ctx.primary_vertical === "food_bev" ? "DM economics for specialty F&B" :
                  ctx.primary_vertical === "athletic" ? "athletic brand benchmarks" :
                  ctx.primary_vertical === "footwear" ? "footwear benchmarks" :
                  "premium DTC benchmarks";

  if (isBeautyOrFnb) {
    // Stat-led body for beauty/F&B (no BW named client). Tightened to keep <90 words.
    const verticalNoun = ctx.primary_vertical === "beauty" ? "beauty" : "specialty F&B";
    const body = `${ctx.first_name}, one stat from our portfolio: DM-acquired customers carry 103% higher LTV than digital-acquired across the 300+ premium retail and DTC brands we run. 25 years mostly in home and apparel; ${verticalNoun} is our fastest-growing category this year.

Your ${ctx.ai_brand_category} positioning makes the math favorable: economics improve as AOV rises. ${ctx.ai_role_hook}. Want me to walk you through DM economics for your AOV bracket?`;
    return { subject, body };
  }

  // Default C for verticals where BW has named clients (home, apparel, etc.).
  const retailerPhrase = VERTICAL_RETAILER_PHRASE[ctx.primary_vertical] ?? VERTICAL_RETAILER_PHRASE.home;
  const body = `${ctx.first_name}, you run a ${ctx.ai_brand_category} brand at the premium end of your category. We run direct mail for ${retailerPhrase}.

One pattern from our portfolio worth a 15-minute conversation: DM-acquired customers consistently outperform digital-acquired on LTV across the brands we work with. Economics get more interesting the higher your AOV.

${ctx.ai_role_hook}. Want me to send the benchmark deck?`;
  return { subject, body };
}

// Load enrichment maps.
type EnrichRow = { catObs: string; simDim: string; brandCat: string; roleHook: string; variant: string; anchor: string; vertical: string };
const enrichMap: Record<string, EnrichRow> = {};

const loadEnrich = (paths: string[]) => {
  for (const fp of paths) {
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
        anchor: m("vertical_anchor") !== -1 ? (r[m("vertical_anchor")] ?? "") : "Serena & Lily",
        vertical: m("primary_vertical") !== -1 ? (r[m("primary_vertical")] ?? "home") : "home",
      };
    }
  }
};
loadEnrich(HOME_ENRICH);
loadEnrich(HOME_ENRICH_NEW);
loadEnrich(MV_ENRICH);
loadEnrich(ATHLETIC_FOOTWEAR_OVERRIDE);  // v4 override: must load LAST to override prior C verdicts

// Combine qualified leads (home v2 + multi-vertical).
const homeQual = parseCsv(readFileSync(QUAL_HOME, "utf8"));
const mvQual = parseCsv(readFileSync(QUAL_MV, "utf8"));

type QualSlice = { headers: string[]; rows: string[][]; source: "home" | "mv" };
const slices: QualSlice[] = [
  { ...homeQual, source: "home" },
  { ...mvQual, source: "mv" },
];

// Compose final.
const finalHeaders = [
  "person_id", "first_name", "last_name", "full_name", "current_job_title",
  "email", "email_status", "company_name", "company_domain", "company_industry",
  "person_state", "qualified", "qual_confidence", "qual_reason", "primary_vertical",
  "vertical_anchor", "ai_catalog_observation", "ai_similarity_dimension",
  "ai_brand_category", "ai_role_hook", "assigned_variant",
  "email1_subject", "email1_body",
  "email2_subject", "email2_body",
  "email3_subject", "email3_body",
  "email4_subject", "email4_body",
  "smartlead_campaign", "source",
];

// Map vertical → Smartlead campaign name
const CAMPAIGN_MAP: Record<string, string> = {
  home: "BW-Home-SandL-2026Q2",
  apparel: "BW-Apparel-Bombas-2026Q2",
  lifestyle_apparel: "BW-Apparel-Bombas-2026Q2",
  denim: "BW-Denim-Athletic-2026Q2",
  athletic: "BW-Denim-Athletic-2026Q2",
  footwear: "BW-Footwear-Birkenstock-2026Q2",
  beauty: "BW-Beauty-FNB-2026Q2",
  food_bev: "BW-Beauty-FNB-2026Q2",
};
const finalRows: string[][] = [];
const messages: { row: any; subject: string; body: string; variant: string; vertical: string; anchor: string; source: string; e2Subject: string; e2Body: string; e3Subject: string; e3Body: string; e4Subject: string; e4Body: string; smartleadCampaign: string }[] = [];
const counts = { B: 0, C: 0, missing: 0, byVertical: {} as Record<string, number> };

for (const slice of slices) {
  const idx = (col: string) => slice.headers.indexOf(col);
  for (const r of slice.rows) {
    const pid = r[idx("person_id")];
    const enrich = enrichMap[pid];
    if (!enrich) { counts.missing++; continue; }

    // For home leads from v2, primary_vertical isn't in the row but we know it's home.
    const vertical = slice.source === "home" ? "home" : (r[idx("primary_vertical")] ?? "home");
    counts.byVertical[vertical] = (counts.byVertical[vertical] || 0) + 1;

    const ctx = {
      first_name: r[idx("first_name")],
      company_name: r[idx("company_name")],
      vertical_anchor: enrich.anchor || (vertical === "home" ? "Serena & Lily" : ""),
      ai_similarity_dimension: enrich.simDim,
      ai_brand_category: enrich.brandCat,
      ai_role_hook: enrich.roleHook,
      primary_vertical: vertical,
    };

    // Full 4-email sequence per lead.
    let e1Subject = "", e1Body = "";
    if (enrich.variant === "B") {
      const r1 = renderVariantB(ctx);
      e1Subject = r1.subject; e1Body = r1.body;
      counts.B++;
    } else if (enrich.variant === "C") {
      const r1 = renderVariantC(ctx);
      e1Subject = r1.subject; e1Body = r1.body;
      counts.C++;
    }
    const e2 = renderEmail2({ first_name: ctx.first_name, company_name: ctx.company_name, primary_vertical: vertical });
    const e3 = renderEmail3({ first_name: ctx.first_name, company_name: ctx.company_name });
    const e4 = renderEmail4({ first_name: ctx.first_name, company_name: ctx.company_name });
    const smartleadCampaign = CAMPAIGN_MAP[vertical] ?? "BW-Other-2026Q2";

    finalRows.push([
      pid,
      r[idx("first_name")] ?? "",
      r[idx("last_name")] ?? "",
      r[idx("full_name")] ?? "",
      r[idx("current_job_title")] ?? "",
      r[idx("email")] ?? "",
      r[idx("email_status")] ?? "",
      r[idx("company_name")] ?? "",
      r[idx("company_domain")] ?? "",
      r[idx("company_industry")] ?? "",
      r[idx("person_state")] ?? "",
      r[idx("qualified")] ?? "",
      r[idx("qual_confidence")] ?? "",
      r[idx("qual_reason")] ?? "",
      vertical,
      enrich.anchor,
      enrich.catObs,
      enrich.simDim,
      enrich.brandCat,
      enrich.roleHook,
      enrich.variant,
      e1Subject, e1Body,
      e2.subject, e2.body,
      e3.subject, e3.body,
      e4.subject, e4.body,
      smartleadCampaign,
      slice.source,
    ]);
    messages.push({ row: r, subject: e1Subject, body: e1Body, variant: enrich.variant, vertical, anchor: enrich.anchor, source: slice.source, e2Subject: e2.subject, e2Body: e2.body, e3Subject: e3.subject, e3Body: e3.body, e4Subject: e4.subject, e4Body: e4.body, smartleadCampaign });
  }
}

// Write CSV.
{
  const lines = [finalHeaders.map(csvEscape).join(",")];
  for (const r of finalRows) lines.push(r.map(csvEscape).join(","));
  writeFileSync(OUT_FINAL, lines.join("\n"), "utf8");
}

// Write markdown.
{
  const md: string[] = [];
  md.push("# Final Rendered Messages — Belardi Wong Multi-Vertical Pipeline (v3)");
  md.push("");
  md.push(`Generated: ${new Date().toISOString()}`);
  md.push("");
  md.push("## Summary");
  md.push("");
  md.push(`- **Total qualified rendered:** ${messages.length}`);
  md.push(`- **Variant B (anchor flex):** ${counts.B}`);
  md.push(`- **Variant C (generic fallback):** ${counts.C}`);
  md.push(`- **Missing enrichment:** ${counts.missing}`);
  md.push("");
  md.push("### Per-vertical breakdown");
  md.push("");
  md.push("| Vertical | Count |");
  md.push("|---|---|");
  for (const [v, n] of Object.entries(counts.byVertical).sort((a, b) => b[1] - a[1])) {
    md.push(`| ${v} | ${n} |`);
  }
  md.push("");
  md.push("### Anchor distribution (Variant B leads)");
  md.push("");
  const anchorCounts: Record<string, number> = {};
  for (const m of messages) {
    if (m.variant === "B") anchorCounts[m.anchor] = (anchorCounts[m.anchor] || 0) + 1;
  }
  for (const [a, n] of Object.entries(anchorCounts).sort((a, b) => b[1] - a[1])) {
    md.push(`- **${a}**: ${n}`);
  }
  md.push("");
  md.push("---");
  md.push("");

  // Group by vertical for readability.
  const groups: Record<string, typeof messages> = {};
  for (const m of messages) {
    (groups[m.vertical] ??= []).push(m);
  }

  for (const [vertical, msgs] of Object.entries(groups)) {
    md.push(`## ${vertical.toUpperCase()} (${msgs.length})`);
    md.push("");
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const r = m.row;
      const findCol = (col: string) => {
        const slice = slices.find((s) => s.headers.includes(col));
        if (!slice) return "";
        return r[slice.headers.indexOf(col)] ?? "";
      };
      const fullName = findCol("full_name");
      const title = findCol("current_job_title");
      const company = findCol("company_name");
      const domain = findCol("company_domain");
      const email = findCol("email");
      const wordCount = m.body.split(/\s+/).filter((x) => x.length).length;

      md.push(`### ${vertical}.${i + 1} ${fullName} — ${title}`);
      md.push("");
      md.push(`**Company:** ${company} (${domain})`);
      md.push(`**Variant:** ${m.variant} | **Anchor:** ${m.anchor || "(none — generic C)"} | **Campaign:** ${m.smartleadCampaign} | **Email:** ${email}`);
      md.push("");
      md.push(`**Email 1 (Day 0) — Subject:** ${m.subject}`);
      md.push("```");
      md.push(m.body);
      md.push("```");
      md.push("");
      md.push(`**Email 2 (Day 3, threaded follow-up) — Subject:** ${m.e2Subject || "(empty, threaded)"}`);
      md.push("```");
      md.push(m.e2Body);
      md.push("```");
      md.push("");
      md.push(`**Email 3 (Day 7, new thread) — Subject:** ${m.e3Subject}`);
      md.push("```");
      md.push(m.e3Body);
      md.push("```");
      md.push("");
      md.push(`**Email 4 (Day 11, final) — Subject:** ${m.e4Subject}`);
      md.push("```");
      md.push(m.e4Body);
      md.push("```");
      md.push("");
      md.push("---");
      md.push("");
    }
  }

  writeFileSync(OUT_MESSAGES, md.join("\n"), "utf8");
}

console.error(`Qualified rendered:    ${messages.length}`);
console.error(`Variant B:             ${counts.B}`);
console.error(`Variant C:             ${counts.C}`);
console.error(`Missing enrichment:    ${counts.missing}`);
console.error(`Per-vertical:`);
for (const [v, n] of Object.entries(counts.byVertical).sort((a, b) => b[1] - a[1])) {
  console.error(`  ${v.padEnd(20)} ${n}`);
}
console.error(`Wrote: ${OUT_FINAL}`);
console.error(`Wrote: ${OUT_MESSAGES}`);
