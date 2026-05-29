# Pipeline Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the BW cold email pipeline with exclusion list enforcement, trusted signal sources, LeadMagic email reveal integration, and Prospeo paid-tier filter exploration.

**Architecture:** Four independent improvements layered onto the existing pipeline. Each is self-contained: exclusion list adds a pre-render filter step; trusted sources patches the Serper extractor; LeadMagic integrates into the reveal script; Prospeo exploration adds new filter options to the search script.

**Tech Stack:** TypeScript, tsx (no build step), Serper API, Prospeo API, LeadMagic API, TSV log file for API tracking.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `scripts/_exclusion_list.ts` | **Create** | Load exclusion list from CSV/JSON, expose `isExcluded(domain, companyName)` |
| `scripts/extract-signals.ts` | **Modify** | Skip excluded leads before Serper calls |
| `scripts/render-with-signals.ts` | **Modify** | Filter excluded leads before render |
| `scripts/_fact_extractor.ts` | **Modify** | Add trusted-source allowlist check per signal type |
| `scripts/_serper_client.ts` | **Already modified** | Already has `logApiCall` |
| `scripts/reveal-emails-leadmagic.ts` | **Modify** | Wire up existing `_leadmagic_client.ts` properly with logging |
| `scripts/prospeo-trial-search.ts` | **Modify** | Add new Prospeo paid-tier filters (technologies, news signals, keyword) |
| `data/exclusion-list.csv` | **Create** | Master exclusion list: domain, company_name, reason |
| `tests/_exclusion_list.test.ts` | **Create** | Unit tests for exclusion logic |
| `tests/_fact_extractor.test.ts` | **Modify** | Add tests for trusted-source filtering |

---

## Task 1: Exclusion List — data file + library

**Context:** Currently exclusion domains are hardcoded in `prospeo-trial-search.ts` lines 106–140. Avinash said this list must be updateable without code changes. We move it to a CSV file and create a shared library.

**Files:**
- Create: `data/exclusion-list.csv`
- Create: `scripts/_exclusion_list.ts`
- Create: `tests/_exclusion_list.test.ts`

- [ ] **Step 1: Create `data/exclusion-list.csv`** with headers and current known entries

```csv
domain,company_name,reason
cohereone.com,CohereOne,competitor
aim360.com,AIM360,competitor
slm.com,SLM,competitor
pebblepost.com,PebblePost,competitor
postpilot.com,PostPilot,competitor
postie.com,Postie,competitor
lsdirect.com,LS Direct,competitor
quad.com,Quad,competitor
rrd.com,RR Donnelley,competitor
bombas.com,Bombas,existing_client
verabradley.com,Vera Bradley,existing_client
serenaandlily.com,Serena & Lily,existing_client
kurufootwear.com,Kuru Footwear,existing_client
johnnywas.com,Johnny Was,existing_client
anthropologie.com,Anthropologie,existing_client
reformation.com,Reformation,existing_client
madein.cc,Made In,existing_client
crateandbarrel.com,Crate & Barrel,existing_client
landsend.com,Land's End,existing_client
naturallife.com,Natural Life,existing_client
talbots.com,Talbots,existing_client
sundancecatalog.com,Sundance,existing_client
evereve.com,Evereve,existing_client
splendid.com,Splendid,existing_client
dwr.com,Design Within Reach,existing_client
schoolhouse.com,Schoolhouse,existing_client
lillypulitzer.com,Lilly Pulitzer,existing_client
staud.clothing,STAUD,existing_client
agjeans.com,AG Jeans,existing_client
paige.com,PAIGE,existing_client
```

- [ ] **Step 2: Write failing tests in `tests/_exclusion_list.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { buildExclusionSet, isExcluded } from '../scripts/_exclusion_list';

describe('buildExclusionSet', () => {
  it('loads entries from CSV text', () => {
    const csv = 'domain,company_name,reason\nbombas.com,Bombas,existing_client\n';
    const set = buildExclusionSet(csv);
    expect(set.domains.has('bombas.com')).toBe(true);
  });
});

describe('isExcluded', () => {
  it('matches exact domain', () => {
    const set = buildExclusionSet('domain,company_name,reason\nbombas.com,Bombas,existing_client\n');
    expect(isExcluded('bombas.com', set)).toBe(true);
  });

  it('matches subdomain', () => {
    const set = buildExclusionSet('domain,company_name,reason\nbombas.com,Bombas,existing_client\n');
    expect(isExcluded('shop.bombas.com', set)).toBe(true);
  });

  it('does not match unrelated domain', () => {
    const set = buildExclusionSet('domain,company_name,reason\nbombas.com,Bombas,existing_client\n');
    expect(isExcluded('notbombas.com', set)).toBe(false);
  });

  it('matches by company name case-insensitive', () => {
    const set = buildExclusionSet('domain,company_name,reason\nbombas.com,Bombas,existing_client\n');
    expect(isExcluded('bombas.com', set, 'BOMBAS')).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd coldoutboundskills && npx vitest run tests/_exclusion_list.test.ts
```
Expected: FAIL — `Cannot find module '../scripts/_exclusion_list'`

- [ ] **Step 4: Create `scripts/_exclusion_list.ts`**

```typescript
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export interface ExclusionSet {
  domains: Set<string>;
  companyNames: Set<string>;
}

export function buildExclusionSet(csvText: string): ExclusionSet {
  const domains = new Set<string>();
  const companyNames = new Set<string>();
  const lines = csvText.split('\n').filter(Boolean);
  // skip header
  for (const line of lines.slice(1)) {
    const [domain, company_name] = line.split(',');
    if (domain?.trim()) domains.add(domain.trim().toLowerCase());
    if (company_name?.trim()) companyNames.add(company_name.trim().toLowerCase());
  }
  return { domains, companyNames };
}

export function loadExclusionSet(csvPath?: string): ExclusionSet {
  const path = csvPath ?? resolve(process.cwd(), 'data/exclusion-list.csv');
  if (!existsSync(path)) return { domains: new Set(), companyNames: new Set() };
  return buildExclusionSet(readFileSync(path, 'utf8'));
}

export function isExcluded(domain: string, exclusionSet: ExclusionSet, companyName?: string): boolean {
  const d = domain.toLowerCase();
  // exact match
  if (exclusionSet.domains.has(d)) return true;
  // subdomain match: shop.bombas.com matches bombas.com
  for (const excluded of exclusionSet.domains) {
    if (d.endsWith(`.${excluded}`)) return true;
  }
  // company name match
  if (companyName && exclusionSet.companyNames.has(companyName.toLowerCase())) return true;
  return false;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/_exclusion_list.test.ts
```
Expected: PASS — 4 tests

- [ ] **Step 6: Commit**

```bash
git add data/exclusion-list.csv scripts/_exclusion_list.ts tests/_exclusion_list.test.ts
git commit -m "feat: add exclusion list library and data file"
```

---

## Task 2: Wire Exclusion List into extract-signals.ts and render-with-signals.ts

**Context:** `extract-signals.ts` wastes Serper credits on excluded leads. `render-with-signals.ts` would render emails for excluded companies. Both need to check the exclusion list before doing any work per lead.

**Files:**
- Modify: `scripts/extract-signals.ts` (around line 44 — eligibility gate)
- Modify: `scripts/render-with-signals.ts` (around line 247 — step 2 sidecar read)

- [ ] **Step 1: Write failing test for extract-signals exclusion gate**

Add to `tests/_exclusion_list.test.ts`:

```typescript
import { loadExclusionSet, isExcluded } from '../scripts/_exclusion_list';

it('loadExclusionSet reads actual data file without throwing', () => {
  // Will return empty set if file missing — never throws
  const set = loadExclusionSet();
  expect(set.domains).toBeDefined();
});
```

Run: `npx vitest run tests/_exclusion_list.test.ts`
Expected: PASS (no new failure — just validates loadExclusionSet doesn't throw)

- [ ] **Step 2: Patch `extract-signals.ts` — add exclusion check before Serper calls**

In `extractSignalsForLead`, after the eligibility gate at line 44, add:

```typescript
// Exclusion list gate — load once per process (cached in module scope)
import { loadExclusionSet, isExcluded, ExclusionSet } from './_exclusion_list';

let _exclusionSet: ExclusionSet | null = null;
function getExclusionSet(): ExclusionSet {
  if (!_exclusionSet) _exclusionSet = loadExclusionSet();
  return _exclusionSet;
}
```

Then inside `extractSignalsForLead`, after the existing `eligible === false` check:

```typescript
  // Exclusion list gate
  if (isExcluded(lead.company_domain, getExclusionSet(), lead.company_name)) {
    return {
      enrichment_tier: tier,
      sidecar_path: sidecarPath,
      fired_queries: 0,
      cache_hit: false,
      skipped_ineligible: true,
    };
  }
```

- [ ] **Step 3: Patch `render-with-signals.ts` — skip excluded leads in runCli()**

In `runCli()` inside the `for (const lead of rows)` loop, before `renderLead()`:

```typescript
import { loadExclusionSet, isExcluded } from './_exclusion_list';

// add before the for loop in runCli():
const exclusionSet = loadExclusionSet();

// inside the loop, before renderLead():
if (isExcluded(lead.company_domain, exclusionSet, lead.company_name)) {
  console.error(`Skipped excluded lead: ${lead.person_id} (${lead.company_domain})`);
  continue;
}
```

- [ ] **Step 4: Smoke test — run render on footwear with an excluded domain injected**

Add `bombas.com,Bombas,test` temporarily to `data/exclusion-list.csv`. Run:

```bash
npx tsx scripts/render-with-signals.ts \
  profiles/belardi-wong/campaigns/lookalike-anchor/data/footwear-with-signals.csv \
  /tmp/footwear-excl-test.csv \
  profiles/belardi-wong/campaigns/lookalike-anchor/data/bridge-responses-footwear \
  profiles/belardi-wong/campaigns/lookalike-anchor/data/signals-footwear
```

Expected: `Wrote 9 rendered leads` (all footwear leads are non-Bombas, so count unchanged).
Remove the test entry after confirming.

- [ ] **Step 5: Commit**

```bash
git add scripts/extract-signals.ts scripts/render-with-signals.ts tests/_exclusion_list.test.ts
git commit -m "feat: enforce exclusion list in extract-signals and render pipeline"
```

---

## Task 3: Trusted Sources for Serper Signal Facts

**Context:** `_fact_extractor.ts` currently accepts any Serper organic result. Low-quality sources (return policy pages, random blogs) pass as signal facts. Avinash raised this on the call. Add a trusted-domain allowlist that gates `funding`, `press`, and `acquisition` facts — only these source domains count as real signals.

**Files:**
- Modify: `scripts/_fact_extractor.ts`
- Create: `tests/_fact_extractor_trusted.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/_fact_extractor_trusted.test.ts
import { describe, it, expect } from 'vitest';
import { extractFundingFact } from '../scripts/_fact_extractor';

const TRUSTED_RESULT = {
  organic: [{
    title: 'Vuori raises $400M Series C',
    link: 'https://techcrunch.com/2021/10/vuori-series-c',
    snippet: 'Vuori has raised $400M in a Series C round led by SoftBank.',
  }],
};

const UNTRUSTED_RESULT = {
  organic: [{
    title: 'Vuori Return Policy',
    link: 'https://vuori.com/pages/return-policy',
    snippet: 'We accept returns within 30 days of purchase.',
  }],
};

describe('extractFundingFact trusted sources', () => {
  it('accepts fact from trusted source', () => {
    const fact = extractFundingFact(TRUSTED_RESULT, 'Vuori');
    expect(fact).not.toBeNull();
  });

  it('rejects fact from untrusted source (brand own domain)', () => {
    const fact = extractFundingFact(UNTRUSTED_RESULT, 'Vuori');
    expect(fact).toBeNull();
  });
});
```

Run: `npx vitest run tests/_fact_extractor_trusted.test.ts`
Expected: FAIL (trusted source check not yet implemented)

- [ ] **Step 2: Add trusted-source check to `_fact_extractor.ts`**

Add at top of file (after existing imports):

```typescript
const TRUSTED_FUNDING_DOMAINS = [
  'techcrunch.com', 'crunchbase.com', 'bloomberg.com', 'wsj.com',
  'businessinsider.com', 'forbes.com', 'axios.com', 'sec.gov',
  'prnewswire.com', 'businesswire.com', 'globenewswire.com',
  'venturebeat.com', 'pitchbook.com', 'reuters.com',
];

const TRUSTED_PRESS_DOMAINS = [
  ...TRUSTED_FUNDING_DOMAINS,
  'fashionnetwork.com', 'glossy.co', 'wwd.com', 'retaildive.com',
  'modernretail.co', 'businessoffashion.com', 'adweek.com',
  'marketingweek.com', 'fastcompany.com', 'inc.com',
];

function isTrustedSource(link: string, allowlist: string[]): boolean {
  try {
    const hostname = new URL(link).hostname.replace(/^www\./, '');
    return allowlist.some(trusted => hostname === trusted || hostname.endsWith(`.${trusted}`));
  } catch {
    return false;
  }
}
```

Then in `extractFundingFact`, filter organic results before scoring:

```typescript
// Inside extractFundingFact, before the existing scoring loop:
const trustedOrganic = (raw?.organic ?? []).filter((r: any) =>
  isTrustedSource(r.link ?? '', TRUSTED_FUNDING_DOMAINS)
);
// Use trustedOrganic instead of raw?.organic for the rest of the function
```

Apply same pattern to `extractPressFact` using `TRUSTED_PRESS_DOMAINS`.
`extractSnippetFact` does NOT get trusted-source filtering — snippets are intentionally scraped from any source.

- [ ] **Step 3: Run tests**

```bash
npx vitest run tests/_fact_extractor_trusted.test.ts
```
Expected: PASS

- [ ] **Step 4: Run existing fact extractor tests to catch regressions**

```bash
npx vitest run tests/
```
Expected: all previously passing tests still pass

- [ ] **Step 5: Commit**

```bash
git add scripts/_fact_extractor.ts tests/_fact_extractor_trusted.test.ts
git commit -m "feat: gate funding and press facts to trusted source domains"
```

---

## Task 4: LeadMagic Email Reveal — wire logging + caller script name

**Context:** `reveal-emails-leadmagic.ts` exists and uses `_leadmagic_client.ts`. The `_leadmagic_client.ts` logs to `_api_logger.ts` but passes `'unknown'` as `script`. Fix it to accept a `callerScript` param so logs are useful. Also confirm the reveal script handles missing emails gracefully.

**Files:**
- Modify: `scripts/_leadmagic_client.ts` (add `callerScript` param to `findEmail`)
- Modify: `scripts/reveal-emails-leadmagic.ts` (pass script name, confirm error handling)
- Modify: `tests/_leadmagic.test.ts` if it exists, otherwise create

- [ ] **Step 1: Check for existing LeadMagic tests**

```bash
ls tests/ | grep leadmagic
```

If no test file exists, write one:

```typescript
// tests/_leadmagic.test.ts
import { describe, it, expect } from 'vitest';
import { buildExclusionSet } from '../scripts/_exclusion_list';

// LeadMagic client makes real HTTP calls — only test the interface shape
describe('findEmail interface', () => {
  it('returns null email without throwing when API key is invalid', async () => {
    const { findEmail } = await import('../scripts/_leadmagic_client');
    // Should not throw — returns null email
    const result = await findEmail(
      { first_name: 'Test', last_name: 'User', company_domain: 'example.com' },
      'invalid-key'
    ).catch(() => ({ email: null, confidence: 'unknown', source: 'none', credits_used: 0 }));
    expect(result.email).toBeNull();
  });
});
```

- [ ] **Step 2: Update `_leadmagic_client.ts` — add `callerScript` param**

Change `findEmail` signature:

```typescript
export async function findEmail(
  opts: {
    first_name: string;
    last_name: string;
    company_domain: string;
    linkedin_url?: string;
  },
  apiKey: string,
  callerScript = 'reveal-emails-leadmagic.ts',
): Promise<LeadMagicResult>
```

Replace both `logApiCall` calls in `findEmail` — change `script: 'unknown'` to `script: callerScript`.

- [ ] **Step 3: Verify `reveal-emails-leadmagic.ts` passes script name**

Read the file and confirm the `findEmail` call passes `'reveal-emails-leadmagic.ts'` as third arg. If not, add it.

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/_leadmagic.test.ts
```
Expected: PASS (interface test passes; real API call gracefully degrades)

- [ ] **Step 5: Commit**

```bash
git add scripts/_leadmagic_client.ts scripts/reveal-emails-leadmagic.ts tests/_leadmagic.test.ts
git commit -m "feat: wire caller script name into LeadMagic logging"
```

---

## Task 5: Prospeo Paid-Tier Filter Exploration

**Context:** The team just got a Prospeo paid subscription. Previously `prospeo-trial-search.ts` was limited. Now we can test: (1) `technologies` filter to find Shopify-using brands, (2) `keyword` filter for DTC-specific signals, (3) news-based signals. Goal: test with ≤5 credits, log output, don't overwrite existing data.

**Files:**
- Create: `scripts/prospeo-explore-filters.ts` (new standalone exploration script — does not touch main pipeline)

- [ ] **Step 1: Create `scripts/prospeo-explore-filters.ts`**

```typescript
// Exploration script — NOT part of main pipeline
// Tests Prospeo paid-tier filters with minimal credit spend (cap: 5 pages = 5 credits)
// Output: data/prospeo-filter-tests/{filter-name}.json

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const PROSPEO_KEY = process.env.PROSPEO_API_KEY ?? '';
const OUT_DIR = resolve(process.cwd(), 'data/prospeo-filter-tests');
const MAX_CREDITS = 5;

async function prospeoSearch(filters: Record<string, any>, page = 1): Promise<any> {
  const res = await fetch('https://api.prospeo.io/linkedin-search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-KEY': PROSPEO_KEY,
    },
    body: JSON.stringify({ ...filters, limit: 25, page }),
  });
  if (!res.ok) throw new Error(`Prospeo ${res.status}: ${await res.text()}`);
  return res.json();
}

async function runTest(name: string, filters: Record<string, any>) {
  console.log(`\n--- Test: ${name} ---`);
  let credits = 0;
  const results: any[] = [];

  while (credits < MAX_CREDITS) {
    const data = await prospeoSearch(filters, credits + 1);
    credits++;
    const people = data?.response?.results ?? data?.results ?? [];
    results.push(...people);
    console.log(`  Page ${credits}: ${people.length} results (total so far: ${results.length})`);
    if (people.length < 25) break; // no more pages
  }

  const outPath = resolve(OUT_DIR, `${name}.json`);
  writeFileSync(outPath, JSON.stringify({ filters, total: results.length, credits_used: credits, results }, null, 2));
  console.log(`  Saved ${results.length} results to ${outPath} (${credits} credits used)`);
}

async function main() {
  if (!PROSPEO_KEY) { console.error('PROSPEO_API_KEY not set'); process.exit(1); }
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  // Test 1: Shopify technology filter — DTC brands using Shopify
  await runTest('shopify-dtc-apparel', {
    location: [{ name: 'United States', type: 'country' }],
    job_title: ['CMO', 'VP Marketing', 'Director of Marketing', 'Head of Marketing'],
    company_headcount: [{ min: 20, max: 5000 }],
    technologies: ['Shopify'],
    industry: ['Apparel & Fashion'],
  });

  // Test 2: Klaviyo technology filter — email-marketing-active brands
  await runTest('klaviyo-apparel', {
    location: [{ name: 'United States', type: 'country' }],
    job_title: ['CMO', 'VP Marketing', 'Director of Marketing'],
    company_headcount: [{ min: 20, max: 2000 }],
    technologies: ['Klaviyo'],
    industry: ['Retail'],
  });

  // Test 3: Keyword filter — "direct to consumer"
  await runTest('dtc-keyword', {
    location: [{ name: 'United States', type: 'country' }],
    job_title: ['CMO', 'VP Marketing', 'Director of Marketing'],
    company_headcount: [{ min: 20, max: 5000 }],
    keyword: 'direct to consumer',
  });

  console.log('\nDone. Check data/prospeo-filter-tests/ for results.');
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the exploration script with dry-run safety check first**

```bash
cd coldoutboundskills
PROSPEO_API_KEY=$(grep PROSPEO_API_KEY .env | cut -d= -f2) npx tsx scripts/prospeo-explore-filters.ts
```

Expected output: 3 test result JSON files in `data/prospeo-filter-tests/`, ≤5 credits per test, ≤15 credits total.

- [ ] **Step 3: Review results**

Check which filter combination returns the highest % of DTC-relevant leads:

```bash
python3 -c "
import json, glob
for f in glob.glob('data/prospeo-filter-tests/*.json'):
    d = json.load(open(f))
    print(f'{f}: {d[\"total\"]} leads, {d[\"credits_used\"]} credits')
"
```

- [ ] **Step 4: Document findings**

Add a `## Prospeo Filter Test Results` section to this plan file noting which filters worked and recommended settings for the main `prospeo-trial-search.ts`.

- [ ] **Step 5: Commit**

```bash
git add scripts/prospeo-explore-filters.ts data/prospeo-filter-tests/
git commit -m "feat: add Prospeo paid-tier filter exploration script + test results"
```

---

## Task 6: Update `prospeo-trial-search.ts` with Best Filters

**Context:** After Task 5 exploration, integrate the best-performing filters into the main search script. Only do this after reviewing Task 5 results — don't guess which filters work.

**Files:**
- Modify: `scripts/prospeo-trial-search.ts`

- [ ] **Step 1: Add `technologies` filter to existing vertical configs**

Based on Task 5 results, add the best-performing technology filter(s) to each vertical. Example (adjust based on actual results):

```typescript
// In the vertical config objects, add:
technologies: ['Shopify'], // or ['Klaviyo'] based on Task 5 findings
```

- [ ] **Step 2: Add exclusion list check in `prospeo-trial-search.ts`**

Replace hardcoded `EXCLUDED_DOMAINS` array + `isExcludedDomain()` function with the shared library:

```typescript
import { loadExclusionSet, isExcluded } from './_exclusion_list';

// Remove: const EXCLUDED_DOMAINS = [...] and isExcludedDomain()
// Add at top of main():
const exclusionSet = loadExclusionSet();

// Replace every isExcludedDomain(domain) call with:
isExcluded(domain, exclusionSet, companyName)
```

- [ ] **Step 3: Run a single-page test to confirm no errors**

```bash
PROSPEO_API_KEY=... npx tsx scripts/prospeo-trial-search.ts
```

Interrupt after page 1 completes (Ctrl+C). Check output CSV has results, no errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/prospeo-trial-search.ts
git commit -m "feat: integrate paid-tier filters and shared exclusion list into Prospeo search"
```

---

## Execution Order

Run tasks in this order — each is independent but Task 6 depends on Task 5 results:

1. Task 1 (exclusion library) → 2 (wire it in) → 3 (trusted sources) in parallel if using subagents
2. Task 4 (LeadMagic logging) — independent, any time
3. Task 5 (Prospeo exploration) → review results → Task 6

---

## Self-Review

**Spec coverage:**
- ✅ Exclusion list (Tasks 1 + 2)
- ✅ Trusted sources (Task 3)
- ✅ LeadMagic integration/logging (Task 4)
- ✅ Prospeo paid-tier exploration (Task 5)
- ✅ Wire exclusion list into Prospeo search (Task 6)
- ✅ API usage logging already done (previous session)

**Placeholder scan:** No TBDs. All code blocks complete. Task 6 Step 1 correctly defers to Task 5 results with an explicit note.

**Type consistency:** `ExclusionSet` defined in Task 1, used in Tasks 2 and 6. `loadExclusionSet` / `isExcluded` signatures consistent throughout.
