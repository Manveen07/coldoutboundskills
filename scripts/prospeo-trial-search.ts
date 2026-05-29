#!/usr/bin/env tsx
/**
 * Prospeo trial search for Belardi Wong home-vertical lookalike campaign.
 * Single-shot search with auto-widen fallback if narrow returns <15.
 * Writes leads-raw.csv to the lookalike-anchor campaign dir.
 *
 * Credit budget: 1-2 calls maximum (1 credit each).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import { prospeoSearchPage } from './_prospeo_client';

const REPO_ROOT = resolve(__dirname, "..");
const ENV_PATH = resolve(REPO_ROOT, ".env");
// Multi-vertical pull (apparel + beauty + food/bev). Each invocation pulls one
// vertical group. Configure via env var VERTICAL_GROUP (apparel|beauty|fnb).
const VERTICAL_GROUP = process.env.VERTICAL_GROUP ?? "apparel";
const START_PAGE = parseInt(process.env.START_PAGE ?? "1", 10);
const OUTPUT_SUFFIX = process.env.OUTPUT_SUFFIX ?? "";
const OUTPUT_PATH = resolve(
  REPO_ROOT,
  `profiles/belardi-wong/campaigns/lookalike-anchor/leads-raw-${VERTICAL_GROUP}${OUTPUT_SUFFIX}.csv`
);
const RAW_JSON_PATH = resolve(
  REPO_ROOT,
  `profiles/belardi-wong/campaigns/lookalike-anchor/leads-raw-${VERTICAL_GROUP}${OUTPUT_SUFFIX}.json`
);
const MAX_PAGES = 30;       // hard cap on Prospeo pages = hard cap on credits
const MAX_CREDITS = 25;     // per-vertical-group cap; total trial budget=100

const VERTICAL_INDUSTRIES: Record<string, string[]> = {
  apparel: [
    "Retail Apparel and Fashion",
    "Apparel Manufacturing",
    "Luxury Goods and Jewelry",
    "Fashion Accessories Manufacturing",
  ],
  beauty: [
    "Cosmetics",
    "Personal Care Product Manufacturing",
    "Retail Health and Personal Care Products",
  ],
  fnb: [
    "Food and Beverage Retail",
    "Food and Beverage Manufacturing",
    "Wine and Spirits",
  ],
};
const TITLE_EXCLUDES = [
  "office", "commercial", "b2b", "trade", "wholesale",
  "industrial", "workplace", "panels", "components", "casegoods",
  "contract", "hospitality", "education", "institutional",
  "licensing",
];

function loadEnv(): Record<string, string> {
  const text = readFileSync(ENV_PATH, "utf8");
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = loadEnv();
const API_KEY = env.PROSPEO_API_KEY;
if (!API_KEY) {
  console.error("ERROR: PROSPEO_API_KEY not set in .env");
  process.exit(1);
}

const TITLES = [
  "CMO",
  "Chief Marketing Officer",
  "VP Marketing",
  "VP of Marketing",
  "Head of Marketing",
  "VP Ecommerce",
  "Head of Ecommerce",
  "VP Growth",
  "Head of Growth",
  "Director of Marketing",
  "Director of Ecommerce",
  "Director of Growth",
];

const INDUSTRIES_NARROW = [
  "Retail Furniture and Home Furnishings",
  "Furniture and Home Furnishings Manufacturing",
];

const INDUSTRIES_WIDENED = [
  ...INDUSTRIES_NARROW,
  "Textile Manufacturing",
];

const EXCLUDED_DOMAINS = [
  // Competitors
  "cohereone.com",
  "aim360.com",
  "slm.com",
  "pebblepost.com",
  "postpilot.com",
  "postie.com",
  "lsdirect.com",
  "quad.com",
  "rrd.com",
  // Existing BW clients (anchor_lookalike_customers)
  "bombas.com",
  "verabradley.com",
  "serenaandlily.com",
  "kurufootwear.com",
  "johnnywas.com",
  "anthropologie.com",
  "reformation.com",
  "madein.cc",
  "crateandbarrel.com",
  "landsend.com",
  // Existing BW clients (proof_points named_clients, core_direct_mail)
  "naturallife.com",
  "talbots.com",
  "sundancecatalog.com",
  "evereve.com",
  "splendid.com",
  "dwr.com",
  "schoolhouse.com",
  "lillypulitzer.com",
  "staud.clothing",
  "agjeans.com",
  "paige.com",
];

function buildFilters(industries: string[]) {
  return {
    person_location_search: {
      include: ["United States #US"],
    },
    person_job_title: {
      include: TITLES,
      // v3 scale-run tightening: keep loose (false) because the post-filter
      // applied in JS catches role-noise via TITLE_EXCLUDES below. Exact-match
      // would drop variant titles like "VP of Marketing & Digital" which we
      // want to keep.
      match_only_exact_job_titles: false,
    },
    company_headcount_custom: {
      min: 51,
      max: 5000,
    },
    company_industry: {
      include: industries,
    },
    person_contact_details: {
      email: ["VERIFIED"],
    },
  };
}

/**
 * Post-fetch title filter — drops B2B / commercial / industrial roles that the
 * Prospeo "Furniture and Home Furnishings Manufacturing" tag still surfaces.
 * Drives down the qualifier-rejection rate downstream.
 */
function titleSurvivesExcludes(title: string | undefined): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  return !TITLE_EXCLUDES.some((tok) => t.includes(tok));
}

function isExcludedDomain(domain: string | undefined): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase().replace(/^www\./, "");
  return EXCLUDED_DOMAINS.some((ex) => d === ex || d.endsWith(`.${ex}`));
}

/**
 * Prospeo returns `email` as a nested object on the person record, not a flat string.
 * Tolerant extractor — handles string, object with value/email/address keys, plus status field variants.
 */
function extractEmail(emailField: any): { value: string; status: string } {
  if (emailField === null || emailField === undefined) return { value: "", status: "" };
  if (typeof emailField === "string") return { value: emailField, status: "" };
  if (Array.isArray(emailField) && emailField.length > 0) return extractEmail(emailField[0]);
  if (typeof emailField === "object") {
    return {
      value: emailField.value ?? emailField.email ?? emailField.address ?? "",
      status: emailField.status ?? emailField.email_status ?? emailField.verified ?? "",
    };
  }
  return { value: "", status: "" };
}

async function callSearch(filters: any, page = 1): Promise<any> {
  return prospeoSearchPage(filters, page, API_KEY, 'prospeo-trial-search.ts');
}

function csvEscape(v: any): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function resultsToRows(results: any[]): any[] {
  return results.map((r) => {
    const p = r.person ?? {};
    const c = r.company ?? {};
    const loc = p.location ?? {};
    const emailExtracted = extractEmail(p.email);
    return {
      person_id: p.person_id ?? "",
      first_name: p.first_name ?? "",
      last_name: p.last_name ?? "",
      full_name: p.full_name ?? "",
      current_job_title: p.current_job_title ?? "",
      email: emailExtracted.value,
      email_status: emailExtracted.status || (p.email_status ?? ""),
      person_linkedin_url: p.linkedin_url ?? "",
      person_city: loc.city ?? "",
      person_state: loc.state ?? "",
      person_country: loc.country ?? "",
      company_name: c.name ?? "",
      company_domain: c.domain ?? "",
      company_industry: c.industry ?? "",
      company_headcount: c.headcount ?? "",
      company_headcount_range: c.headcount_range ?? "",
      company_linkedin_url: c.linkedin_url ?? "",
      company_city: (c.location ?? {}).city ?? "",
      company_state: (c.location ?? {}).state ?? "",
      company_country: (c.location ?? {}).country ?? "",
      company_technologies: Array.isArray(c.technologies) ? c.technologies.join("; ") : "",
    };
  });
}

function writeCsv(rows: any[]) {
  const dir = dirname(OUTPUT_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (rows.length === 0) {
    writeFileSync(OUTPUT_PATH, "", "utf8");
    return;
  }
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  writeFileSync(OUTPUT_PATH, lines.join("\n"), "utf8");
}

(async () => {
  const startTime = Date.now();
  let creditsUsed = 0;
  const rawResponses: any[] = [];
  const allResults: any[] = [];
  const seen = new Set<string>();
  let totalCount = 0;

  console.error(`Scale pull. Industries: ${INDUSTRIES_NARROW.join(", ")}.`);
  console.error(`Caps: MAX_PAGES=${MAX_PAGES}, MAX_CREDITS=${MAX_CREDITS}.`);
  console.error("");

  // Multi-vertical pull. Pulls one vertical group at a time via VERTICAL_GROUP env var.
  const industries = VERTICAL_INDUSTRIES[VERTICAL_GROUP];
  if (!industries) {
    console.error(`Unknown VERTICAL_GROUP=${VERTICAL_GROUP}. Valid: ${Object.keys(VERTICAL_INDUSTRIES).join(", ")}`);
    process.exit(1);
  }
  console.error(`Vertical group: ${VERTICAL_GROUP}`);
  console.error(`Industries: ${industries.join(", ")}`);
  const filters = buildFilters(industries);

  for (let page = START_PAGE; page <= MAX_PAGES; page++) {
    if (creditsUsed >= MAX_CREDITS) {
      console.error(`Credit cap (${MAX_CREDITS}) hit. Stopping at page ${page - 1}.`);
      break;
    }

    const t0 = Date.now();
    let resp: any;
    try {
      resp = await callSearch(filters, page);
    } catch (err: any) {
      console.error(`Page ${page} ERROR: ${err.message ?? err}. Stopping.`);
      break;
    }
    const dt = Date.now() - t0;

    const results = resp.results ?? [];
    const pagination = resp.pagination ?? {};
    if (page === 1) totalCount = pagination.total_count ?? results.length;
    creditsUsed += results.length > 0 ? 1 : 0;
    rawResponses.push({ page, response: resp });

    console.error(
      `Page ${page}: ${results.length} results, total_count=${pagination.total_count}, ${dt}ms, credits_used=${creditsUsed}`
    );

    if (results.length === 0) {
      console.error(`Page ${page} empty. Stopping.`);
      break;
    }

    let added = 0;
    let dupes = 0;
    let titleRejects = 0;
    let domainRejects = 0;
    for (const r of results) {
      const pid = r.person?.person_id;
      if (!pid || seen.has(pid)) { dupes++; continue; }
      if (!titleSurvivesExcludes(r.person?.current_job_title)) { titleRejects++; seen.add(pid); continue; }
      if (isExcludedDomain(r.company?.domain)) { domainRejects++; seen.add(pid); continue; }
      seen.add(pid);
      allResults.push(r);
      added++;
    }
    console.error(`  added=${added}, title_rejected=${titleRejects}, domain_rejected=${domainRejects}, dupes=${dupes}`);

    // If we paginated past total_count, stop.
    if (pagination.total_page && page >= pagination.total_page) {
      console.error(`Reached total_page (${pagination.total_page}). Stopping.`);
      break;
    }
    if (results.length < 25) {
      console.error(`Partial page (<25). Likely end of dataset. Stopping.`);
      break;
    }

    // Polite delay between pages (was 600ms; bumped to 1500ms to dodge per-min rate limits).
    await new Promise((r) => setTimeout(r, 1500));
  }

  // Dump raw response sidecar
  const rawDir = dirname(RAW_JSON_PATH);
  if (!existsSync(rawDir)) mkdirSync(rawDir, { recursive: true });
  writeFileSync(RAW_JSON_PATH, JSON.stringify(rawResponses, null, 2), "utf8");

  const rows = resultsToRows(allResults);
  writeCsv(rows);

  const verifiedCount = rows.filter((r) => /verified/i.test(r.email_status)).length;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.error("");
  console.error("=== Prospeo SCALE search summary ===");
  console.error(`Wall-clock:           ${elapsed}s`);
  console.error(`Credits used:         ${creditsUsed}`);
  console.error(`Pages fetched:        ${rawResponses.length}`);
  console.error(`Total_count (pool):   ${totalCount}`);
  console.error(`Leads after filters:  ${rows.length}`);
  console.error(`  verified emails:    ${verifiedCount}`);
  console.error(`Output CSV:           ${OUTPUT_PATH}`);
  console.error(`Output JSON:          ${RAW_JSON_PATH}`);
  console.error("");
})().catch((err) => {
  console.error("FATAL:", err.message ?? err);
  process.exit(1);
});
