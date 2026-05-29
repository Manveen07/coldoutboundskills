#!/usr/bin/env tsx
/**
 * Prospeo lead pull for Mythic (mythic.us) Growth Codes campaign.
 *
 * Pulls CMO/VP Marketing/Director Marketing at consumer-facing brands
 * in Mythic's target verticals. Writes leads-raw-{VERTICAL}.csv.
 *
 * Usage:
 *   npx tsx scripts/mythic-prospeo-search.ts
 *   VERTICAL=qsr npx tsx scripts/mythic-prospeo-search.ts
 *   VERTICAL=retail START_PAGE=2 npx tsx scripts/mythic-prospeo-search.ts
 *
 * Verticals: qsr | retail | financial | healthcare | hospitality | automotive | apparel | consumer
 *
 * Credit budget: MAX_PAGES per vertical (default 10 = 10 credits max per run).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { prospeoSearchPage } from './_prospeo_client';
import { extractEmail } from './_prospeo_client';

const REPO_ROOT = resolve(process.cwd());
const ENV_PATH = resolve(REPO_ROOT, '.env');
const VERTICAL = process.env.VERTICAL ?? 'qsr';
const START_PAGE = parseInt(process.env.START_PAGE ?? '1', 10);
const MAX_PAGES = parseInt(process.env.MAX_PAGES ?? '10', 10);
const MAX_CREDITS = parseInt(process.env.MAX_CREDITS ?? '10', 10);

const OUT_DIR = resolve(REPO_ROOT, 'profiles/mythic/campaigns/growth-codes/data');
const OUTPUT_PATH = resolve(OUT_DIR, `leads-raw-${VERTICAL}.csv`);
const RAW_JSON_PATH = resolve(OUT_DIR, `leads-raw-${VERTICAL}.json`);

// ---------------------------------------------------------------------------
// Vertical industry mappings (exact Prospeo industry names)
// ---------------------------------------------------------------------------
const VERTICAL_INDUSTRIES: Record<string, string[]> = {
  qsr: [
    'Restaurants',
    'Food and Beverage Retail',
    'Food and Beverage Manufacturing',  // CPG brands (Kraft, Constellation, etc.) — meaningful media budgets
  ],
  retail: [
    'General Retail',
    'Retail Apparel and Fashion',
    'Consumer Goods',
  ],
  financial: [
    'Financial Services',
    'Banking',
    'Insurance',
  ],
  healthcare: [
    'Hospitals and Health Care',
    'Wellness and Fitness Services',
  ],
  hospitality: [
    'Hospitality',
  ],
  automotive: [
    'Automotive',
    'Retail Motor Vehicles',
  ],
  apparel: [
    'Retail Apparel and Fashion',
    'Luxury Goods and Jewelry',
  ],
  consumer: [
    'Consumer Services',
    'Consumer Goods',
    'Personal Care Product Manufacturing',
  ],
  // Confirmed via Trane (existing client) -- HVAC brands with franchise/dealer networks
  hvac: [
    'HVAC and Refrigeration Equipment Manufacturing',
    'Building Equipment Contractors',
    'Facilities Services',
  ],
  // Confirmed via CAMCO (new AOR win April 2025) -- outdoor/sporting brands with media budgets
  outdoor: [
    'Sporting Goods Manufacturing',
    'Retail Sporting Goods',
    'Outdoor Recreation',
    'Recreational Facilities',
  ],
};

// ---------------------------------------------------------------------------
// Target titles — brand + media decision-makers only
// ---------------------------------------------------------------------------
const TITLES = [
  'CMO',
  'Chief Marketing Officer',
  'VP Marketing',
  'VP of Marketing',
  'Vice President of Marketing',
  'VP Brand',
  'VP of Brand',
  'VP Media',
  'VP of Media',
  'SVP Marketing',
  'Senior VP Marketing',
  'Senior Director of Marketing',
  'Director of Marketing',
  'Marketing Director',
  'Director of Brand',
  'Director of Media',
  'Head of Marketing',
  'Head of Brand',
  // Secondary persona: franchise development / growth leadership
  'VP Franchise Development',
  'Director of Franchise Development',
  'VP Growth',
  'Head of Growth',
];

// Title noise — operational/B2B roles that slip through
const TITLE_EXCLUDES = [
  'assistant',
  'coordinator',
  'program manager',
  'operations manager',
  'executive assistant',
  'clinical',
  'ecmo',
  'b2b',
  'wholesale',
  'staffing',
  'recruiting',
  'technology operations',
  'marketing operations',
  'affiliate',
  'influencer',
];

// Domains excluded per client-profile.yaml + QSR holding-co noise (confirmed via filter test 2026-05-28)
// Note: Prospeo API does NOT support company_domain.exclude — these are applied post-fetch in JS.
const EXCLUDED_DOMAINS = [
  // Existing Mythic clients
  'spectrum.com',
  'metlife.com',
  'ally.com',
  'subway.com',
  'goodwill.org',
  'meineke.com',
  'trane.com',
  'conehealth.com',
  'harley-davidson.com',
  'cottoninc.com',
  'carstar.com',
  'unitedhealthcare.com',
  'edpnc.com',
  'camco.com',           // new AOR win April 2025
  'charlotteregion.com', // Charlotte Region campaign July 2025
  // Holding company ad agency competitors
  'wpp.com',
  'publicis.com',
  'omnicomgroup.com',
  'interpublic.com',
  'dentsu.com',
  'havas.com',
  'grey.com',
  'bbdo.com',
  'ddb.com',
  'ogilvy.com',
  // QSR holding cos / parent corps (headcount >>10K, not brand operators)
  // These slip through because Prospeo tags subsidiary headcount not parent
  'yum.com',           // KFC, Taco Bell, Pizza Hut parent (~35K corp)
  'dinebrands.com',    // IHOP, Applebee's parent
  'inspire-brands.com',// Arby's, Buffalo Wild Wings, Dunkin parent
  'focusbrands.com',   // Carvel, Cinnabon, Jamba, Moe's parent
  'rkibrandsgroup.com',// Arby's / Buffalo Wild Wings parent entity
  'sphospitality.com',
  'spbhospitality.com',// SPB Hospitality ~18K employees
  'roarkfunds.com',    // PE parent of Focus Brands
  // Trade associations (no media budget)
  'restaurant.org',
  'nraef.org',
  // B2B-only restaurant equipment manufacturers
  'franke.com',        // Franke Foodservice Systems
  'welbilt.com',
  'henny-penny.com',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function loadEnv(): Record<string, string> {
  const text = readFileSync(ENV_PATH, 'utf8');
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function titleSurvives(title: string | undefined): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  return !TITLE_EXCLUDES.some(tok => t.includes(tok));
}

function isExcludedDomain(domain: string | undefined): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase().replace(/^www\./, '');
  return EXCLUDED_DOMAINS.some(ex => d === ex || d.endsWith(`.${ex}`));
}

function csvEscape(v: any): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function resultsToRows(results: any[]): Record<string, string>[] {
  return results.map(r => {
    const p = r.person ?? {};
    const c = r.company ?? {};
    const loc = p.location ?? {};
    const em = extractEmail(p.email);
    return {
      person_id:              p.person_id ?? '',
      first_name:             p.first_name ?? '',
      last_name:              p.last_name ?? '',
      full_name:              p.full_name ?? '',
      current_job_title:      p.current_job_title ?? '',
      email:                  em.value,
      email_status:           em.status || (p.email_status ?? ''),
      person_linkedin_url:    p.linkedin_url ?? '',
      person_city:            loc.city ?? '',
      person_state:           loc.state ?? '',
      person_country:         loc.country ?? '',
      company_name:           c.name ?? '',
      company_domain:         c.domain ?? '',
      company_industry:       c.industry ?? '',
      company_headcount:      c.headcount ?? '',
      company_headcount_range: c.headcount_range ?? '',
      company_linkedin_url:   c.linkedin_url ?? '',
      company_city:           (c.location ?? {}).city ?? '',
      company_state:          (c.location ?? {}).state ?? '',
      company_country:        (c.location ?? {}).country ?? '',
      vertical:               VERTICAL,
    };
  });
}

function writeCsv(rows: Record<string, string>[]): void {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  if (rows.length === 0) { writeFileSync(OUTPUT_PATH, '', 'utf8'); return; }
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => csvEscape(row[h])).join(','));
  }
  writeFileSync(OUTPUT_PATH, lines.join('\n'), 'utf8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const env = loadEnv();
const API_KEY = env.PROSPEO_API_KEY;
if (!API_KEY) { console.error('PROSPEO_API_KEY not set'); process.exit(1); }

const industries = VERTICAL_INDUSTRIES[VERTICAL];
if (!industries) {
  console.error(`Unknown VERTICAL=${VERTICAL}. Valid: ${Object.keys(VERTICAL_INDUSTRIES).join(', ')}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Subscription-tier filters
// ---------------------------------------------------------------------------

// Technologies that signal performance-over-brand imbalance (Mythic's sweet spot)
// Brands running Google Ads/Meta heavy infra but no brand measurement = audit-ready
const PERFORMANCE_TECH_SIGNALS = [
  'Google Ads',
  'Facebook Ads',
  'Meta Pixel',
  'Google Analytics 4',
  'Klaviyo',
  'Attentive',
  'Triple Whale',
  'Northbeam',
  'Rockerbox',
];

// Revenue floor: $10M+ implies meaningful media budget exists
// Revenue ceiling: $2B (above this, in-house agency or locked AOR)
const REVENUE_MIN = '10000000';   // $10M
const REVENUE_MAX = '2000000000'; // $2B

// Funding stage filter (env-controlled) -- funded brands face CAC pressure = audit timing
const USE_FUNDING_FILTER = process.env.USE_FUNDING_FILTER === 'true';
const FUNDING_STAGES = ['Series B', 'Series C', 'Series D', 'Growth', 'Private Equity'];

// Duplicate control -- skip anyone already pulled in a previous session
const SKIP_ALREADY_EXPORTED = process.env.SKIP_EXPORTED === 'true';

// QSR/restaurant verticals use a tighter 5K ceiling vs other verticals.
// Reason: QSR holding cos (Yum!, Dine Brands, Inspire, SPB) tag subsidiary headcount
// in Prospeo but actual parent is >>10K. 5K ceiling excludes them at API level.
// Other verticals (retail, financial, etc.) keep 10K — holding-co noise is lower.
const QSR_VERTICALS = new Set(['qsr']);
const HEADCOUNT_MAX = QSR_VERTICALS.has(VERTICAL) ? 5000 : 10000;

const filters = {
  person_job_title: {
    include: TITLES,
    // Title-level noise exclusions — confirmed supported by Prospeo API (tested 2026-05-28)
    exclude: [
      'associate director',
      'assistant',
      'coordinator',
      'franchise development',
      'franchise operations',
      'b2b',
      'foodservice equipment',
    ],
    match_only_exact_job_titles: false,
  },
  person_location_search: { include: ['United States #US'] },
  company_headcount_custom: { min: 200, max: HEADCOUNT_MAX },
  company_industry: { include: industries },
  // company_revenue_custom omitted -- Prospeo rejects string format on this account tier; headcount proxy used instead
  person_contact_details: { email: ['VERIFIED'] },
  person_duplicate_control: {
    hide_people_already_exported_before: SKIP_ALREADY_EXPORTED,
  },
  // Technology filter: only active when TECH_FILTER=true env var set
  // (keeps default pull broad; use for targeted sub-pulls)
  ...(process.env.TECH_FILTER === 'true' && {
    company_technology: { include: PERFORMANCE_TECH_SIGNALS },
  }),
  // Funding filter: only active when USE_FUNDING_FILTER=true
  ...(USE_FUNDING_FILTER && {
    company_funding: {
      funding_date: 365 as 365,
      stage: FUNDING_STAGES,
    },
  }),
};

(async () => {
  const startTime = Date.now();
  let creditsUsed = 0;
  const rawResponses: any[] = [];
  const allResults: any[] = [];
  const seen = new Set<string>();

  console.error(`Mythic Prospeo pull. Vertical: ${VERTICAL}`);
  console.error(`Industries: ${industries.join(', ')}`);
  console.error(`Revenue filter: $${REVENUE_MIN} - $${REVENUE_MAX}`);
  console.error(`Tech filter: ${process.env.TECH_FILTER === 'true' ? 'ON (' + PERFORMANCE_TECH_SIGNALS.join(', ') + ')' : 'OFF'}`);
  console.error(`Funding filter: ${USE_FUNDING_FILTER ? 'ON (last 365 days, stages: ' + FUNDING_STAGES.join(', ') + ')' : 'OFF'}`);
  console.error(`Skip exported: ${SKIP_ALREADY_EXPORTED}`);
  console.error(`Caps: MAX_PAGES=${MAX_PAGES}, MAX_CREDITS=${MAX_CREDITS}`);
  console.error('');

  for (let page = START_PAGE; page <= START_PAGE + MAX_PAGES - 1; page++) {
    if (creditsUsed >= MAX_CREDITS) {
      console.error(`Credit cap (${MAX_CREDITS}) hit. Stopping.`);
      break;
    }

    const t0 = Date.now();
    let resp: any;
    try {
      resp = await prospeoSearchPage(filters, page, API_KEY, 'mythic-prospeo-search.ts');
    } catch (err: any) {
      console.error(`Page ${page} ERROR: ${err.message ?? err}. Stopping.`);
      break;
    }
    const dt = Date.now() - t0;

    const results = resp.results ?? [];
    const pagination = resp.pagination ?? {};
    creditsUsed += results.length > 0 ? 1 : 0;
    rawResponses.push({ page, response: resp });

    console.error(`Page ${page}: ${results.length} results, total=${pagination.total_count}, ${dt}ms, credits=${creditsUsed}`);

    if (results.length === 0) { console.error('Empty page. Stopping.'); break; }

    let added = 0, dupes = 0, titleRej = 0, domainRej = 0;
    for (const r of results) {
      const pid = r.person?.person_id;
      if (!pid || seen.has(pid)) { dupes++; continue; }
      if (!titleSurvives(r.person?.current_job_title)) { titleRej++; seen.add(pid); continue; }
      if (isExcludedDomain(r.company?.domain)) { domainRej++; seen.add(pid); continue; }
      seen.add(pid);
      allResults.push(r);
      added++;
    }
    console.error(`  added=${added}, title_rej=${titleRej}, domain_rej=${domainRej}, dupes=${dupes}`);

    if (pagination.total_page && page >= pagination.total_page) {
      console.error(`Reached last page (${pagination.total_page}). Stopping.`);
      break;
    }
    if (results.length < 25) { console.error('Partial page. Stopping.'); break; }

    await new Promise(r => setTimeout(r, 1500));
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(RAW_JSON_PATH, JSON.stringify(rawResponses, null, 2), 'utf8');

  const rows = resultsToRows(allResults);
  writeCsv(rows);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.error('');
  console.error('=== Mythic Prospeo pull summary ===');
  console.error(`Vertical:     ${VERTICAL}`);
  console.error(`Wall-clock:   ${elapsed}s`);
  console.error(`Credits used: ${creditsUsed}`);
  console.error(`Leads:        ${rows.length}`);
  console.error(`CSV:          ${OUTPUT_PATH}`);
  console.error(`JSON:         ${RAW_JSON_PATH}`);
})().catch(e => { console.error('FATAL:', e?.message ?? e); process.exit(1); });
