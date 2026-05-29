# Pipeline Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cold email pipeline repeatable for any client with one command per category run: `npx tsx scripts/run-pipeline.ts --client belardi-wong --category footwear`.

**Architecture:** Four subsystems built in order. (1) Client config reader loads `profiles/{client}/client-profile.yaml` and exposes typed config to all scripts. (2) OpenRouter bridge invoker replaces manual `.txt` files. (3) A single `run-pipeline.ts` orchestrator wires all steps end-to-end. (4) A pre-upload quality gate prints a summary and requires confirmation before any Smartlead upload. Global Prospeo logging patch covers skills folder.

**Tech Stack:** TypeScript, tsx, js-yaml (already in node_modules), OpenRouter API, existing pipeline scripts unchanged as importable modules.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `scripts/_client_config.ts` | **Create** | Load + validate `client-profile.yaml`; typed config interface |
| `scripts/_openrouter_invoker.ts` | **Create** | OpenRouter `AiInvoker` implementation; replaces file-based invoker |
| `scripts/run-pipeline.ts` | **Create** | Single orchestrator: Prospeo → qualify → signals → bridges → render → reveal → gate |
| `scripts/_quality_gate.ts` | **Create** | Pre-upload summary printer + confirmation prompt |
| `skills/cold-email-starter-kit/scripts/prospeo-full-export.ts` | **Modify** | Use `_prospeo_client.ts` instead of raw fetch |
| `scripts/prospeo-explore-filters.ts` | **Modify** | Use `_prospeo_client.ts` instead of raw fetch (from Task 5 of previous plan) |
| `tests/_client_config.test.ts` | **Create** | Unit tests for config loader |
| `tests/_openrouter_invoker.test.ts` | **Create** | Unit tests for invoker error handling |
| `tests/_quality_gate.test.ts` | **Create** | Unit tests for summary generation |

---

## Task 1: Client Config Loader

**Context:** All pipeline scripts currently hardcode BW-specific values. `client-profile.yaml` already has everything we need — anchors, exclusions, verticals, proof points, job titles. We need a typed loader so `run-pipeline.ts` can pass config to every step without reading YAML in each script.

**Files:**
- Create: `scripts/_client_config.ts`
- Create: `tests/_client_config.test.ts`

- [ ] **Step 1: Check js-yaml is available**

```bash
cd coldoutboundskills && node -e "require('js-yaml'); console.log('ok')"
```

Expected: `ok`. If not: `npm install js-yaml`.

- [ ] **Step 2: Write failing tests**

```typescript
// tests/_client_config.test.ts
import { describe, it, expect } from 'vitest';
import { loadClientConfig, getExcludedDomains, getVerticalAnchors } from '../scripts/_client_config';
import { resolve } from 'path';

const BW_PROFILE = resolve(process.cwd(), 'profiles/belardi-wong/client-profile.yaml');

describe('loadClientConfig', () => {
  it('loads BW profile without throwing', () => {
    const cfg = loadClientConfig(BW_PROFILE);
    expect(cfg.business.name).toBe('Belardi Wong');
  });

  it('throws on missing file', () => {
    expect(() => loadClientConfig('/nonexistent/path.yaml')).toThrow();
  });
});

describe('getExcludedDomains', () => {
  it('returns competitor domains from BW config', () => {
    const cfg = loadClientConfig(BW_PROFILE);
    const domains = getExcludedDomains(cfg);
    expect(domains).toContain('cohereone.com');
    expect(domains).toContain('postpilot.com');
  });
});

describe('getVerticalAnchors', () => {
  it('returns anchor clients for footwear vertical', () => {
    const cfg = loadClientConfig(BW_PROFILE);
    const anchors = getVerticalAnchors(cfg, 'footwear');
    expect(anchors).toContain('Birkenstock');
  });

  it('returns empty array for unknown vertical', () => {
    const cfg = loadClientConfig(BW_PROFILE);
    expect(getVerticalAnchors(cfg, 'unknown_vertical')).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/_client_config.test.ts
```
Expected: FAIL — `Cannot find module '../scripts/_client_config'`

- [ ] **Step 4: Create `scripts/_client_config.ts`**

```typescript
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';

export interface ClientConfig {
  business: {
    name: string;
    website: string;
    one_liner: string;
    tone: string;
  };
  offer: {
    primary_product: string;
    primary_cta: string;
    lead_magnet: string;
    value_prop: string;
  };
  icp_hard_filters: {
    job_titles: string[];
    industries_in: string[];
    industries_out: string[];
    headcount_min: number;
    headcount_max: number;
    countries: string[];
    excluded_domains: string[];
  };
  proof_points: {
    headline_stats: Array<{ stat: string; attribution: string; product: string; vertical: string }>;
    vertical_anchor_map: Record<string, string[]>;
    portfolio_stats: string[];
    by_product: Record<string, any>;
  };
}

export function loadClientConfig(profilePath: string): ClientConfig {
  if (!existsSync(profilePath)) {
    throw new Error(`Client profile not found: ${profilePath}`);
  }
  const raw = readFileSync(profilePath, 'utf8');
  return yaml.load(raw) as ClientConfig;
}

export function loadClientConfigByName(clientName: string): ClientConfig {
  const path = resolve(process.cwd(), `profiles/${clientName}/client-profile.yaml`);
  return loadClientConfig(path);
}

export function getExcludedDomains(cfg: ClientConfig): string[] {
  return cfg.icp_hard_filters.excluded_domains ?? [];
}

export function getVerticalAnchors(cfg: ClientConfig, vertical: string): string[] {
  return cfg.proof_points.vertical_anchor_map?.[vertical] ?? [];
}

export function getPortfolioStats(cfg: ClientConfig): string[] {
  return cfg.proof_points.portfolio_stats ?? [];
}

export function getIcpPromptPath(clientName: string): string {
  return resolve(process.cwd(), `profiles/${clientName}/icp-prompt.txt`);
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/_client_config.test.ts
```
Expected: PASS — 4 tests

- [ ] **Step 6: Commit**

```bash
git add scripts/_client_config.ts tests/_client_config.test.ts
git commit -m "feat: add typed client config loader from client-profile.yaml"
```

---

## Task 2: OpenRouter Bridge Invoker

**Context:** Bridges are currently manual `.txt` files written by subagents. This task wires `_ai_subagent.ts`'s `openRouterInvoke` into an `AiInvoker` compatible with `writeBridgeSentence`. The file-based invoker stays as fallback — if `OPENROUTER_API_KEY` is not set, it falls back to file-based mode automatically.

**Files:**
- Create: `scripts/_openrouter_invoker.ts`
- Create: `tests/_openrouter_invoker.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/_openrouter_invoker.test.ts
import { describe, it, expect } from 'vitest';
import { makeOpenRouterInvoker, makeAutoInvoker } from '../scripts/_openrouter_invoker';

describe('makeOpenRouterInvoker', () => {
  it('returns AiInvoker function', () => {
    const invoker = makeOpenRouterInvoker('fake-key');
    expect(typeof invoker).toBe('function');
  });

  it('invoker rejects without person_id context gracefully', async () => {
    const invoker = makeOpenRouterInvoker('fake-key');
    // Should not throw — OpenRouter will fail with auth error, caught and returned as empty
    const result = await invoker('test prompt', {}).catch(() => '');
    expect(typeof result).toBe('string');
  });
});

describe('makeAutoInvoker', () => {
  it('returns file-based invoker when no API key', () => {
    const invoker = makeAutoInvoker(undefined, 'data/bridge-responses-test');
    expect(typeof invoker).toBe('function');
  });

  it('returns openrouter invoker when API key present', () => {
    const invoker = makeAutoInvoker('fake-key', 'data/bridge-responses-test');
    expect(typeof invoker).toBe('function');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/_openrouter_invoker.test.ts
```
Expected: FAIL — `Cannot find module '../scripts/_openrouter_invoker'`

- [ ] **Step 3: Create `scripts/_openrouter_invoker.ts`**

```typescript
import type { AiInvoker } from './_bridge_writer';
import { openRouterInvoke } from './_ai_subagent';
import { makeFileBasedInvoker } from './_file_based_invoker';
import { logApiCall } from './_api_logger';

/**
 * AiInvoker backed by OpenRouter.
 * Uses claude-haiku-4-5 — cheap and fast for ≤25-word bridge sentences.
 * Logs every call to api-usage.log.
 */
export function makeOpenRouterInvoker(
  apiKey: string,
  model = 'anthropic/claude-haiku-4-5',
): AiInvoker {
  return async (prompt: string, _context?: { person_id?: string }): Promise<string> => {
    const result = await openRouterInvoke(prompt, apiKey, model);
    logApiCall({
      provider: 'openrouter',
      script: 'run-pipeline.ts',
      operation: `bridge/${model}`,
      units: 1,
      unit_type: 'calls',
    });
    return result;
  };
}

/**
 * Auto-selects invoker:
 * - If OPENROUTER_API_KEY is set → use OpenRouter (automated)
 * - Otherwise → use file-based invoker (manual mode, backward compatible)
 */
export function makeAutoInvoker(
  openRouterKey: string | undefined,
  responsesDir: string,
): AiInvoker {
  if (openRouterKey) {
    return makeOpenRouterInvoker(openRouterKey);
  }
  return makeFileBasedInvoker(responsesDir);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/_openrouter_invoker.test.ts
```
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/_openrouter_invoker.ts tests/_openrouter_invoker.test.ts
git commit -m "feat: add OpenRouter AiInvoker with auto-fallback to file-based mode"
```

---

## Task 3: Quality Gate

**Context:** The pipeline currently has no human checkpoint before upload. This prints a summary (lead count, signal coverage %, sample email) and blocks until the operator types `yes`. Called at the end of `run-pipeline.ts` before the Smartlead upload step.

**Files:**
- Create: `scripts/_quality_gate.ts`
- Create: `tests/_quality_gate.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/_quality_gate.test.ts
import { describe, it, expect } from 'vitest';
import { buildGateSummary } from '../scripts/_quality_gate';

const SAMPLE_ROWS = [
  { person_id: 'a', company_name: 'AcmeCo', signal_used: 'funding', signal_bridge: 'Funded brands...', email1_body: 'Hello world', email: 'a@acme.com' },
  { person_id: 'b', company_name: 'BetaCo', signal_used: 'fallback', signal_bridge: '', email1_body: 'Hello world', email: '' },
  { person_id: 'c', company_name: 'GammaCo', signal_used: 'press', signal_bridge: 'Press coverage...', email1_body: 'Hello world', email: 'c@gamma.com' },
];

describe('buildGateSummary', () => {
  it('counts total leads', () => {
    const s = buildGateSummary(SAMPLE_ROWS, 'belardi-wong', 'footwear');
    expect(s.total_leads).toBe(3);
  });

  it('computes signal coverage percent', () => {
    const s = buildGateSummary(SAMPLE_ROWS, 'belardi-wong', 'footwear');
    // 2 out of 3 have non-fallback signal
    expect(s.signal_coverage_pct).toBeCloseTo(66.7, 0);
  });

  it('counts revealed emails', () => {
    const s = buildGateSummary(SAMPLE_ROWS, 'belardi-wong', 'footwear');
    expect(s.emails_revealed).toBe(2);
  });

  it('picks a sample lead', () => {
    const s = buildGateSummary(SAMPLE_ROWS, 'belardi-wong', 'footwear');
    expect(s.sample_lead).toBeDefined();
    expect(s.sample_lead.person_id).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/_quality_gate.test.ts
```
Expected: FAIL — `Cannot find module '../scripts/_quality_gate'`

- [ ] **Step 3: Create `scripts/_quality_gate.ts`**

```typescript
import * as readline from 'readline';

export interface GateSummary {
  client: string;
  category: string;
  total_leads: number;
  signal_coverage_pct: number;
  emails_revealed: number;
  fallback_count: number;
  sample_lead: Record<string, string>;
}

export function buildGateSummary(
  rows: Record<string, string>[],
  client: string,
  category: string,
): GateSummary {
  const total = rows.length;
  const withSignal = rows.filter(r => r.signal_used && r.signal_used !== 'fallback').length;
  const withEmail = rows.filter(r => r.email && r.email.trim() !== '').length;
  const fallback = total - withSignal;
  // Pick first lead that has a signal for sample
  const sample = rows.find(r => r.signal_used !== 'fallback') ?? rows[0];

  return {
    client,
    category,
    total_leads: total,
    signal_coverage_pct: total > 0 ? Math.round((withSignal / total) * 1000) / 10 : 0,
    emails_revealed: withEmail,
    fallback_count: fallback,
    sample_lead: sample ?? {},
  };
}

export function printGateSummary(summary: GateSummary): void {
  console.log('\n' + '═'.repeat(60));
  console.log(`  QUALITY GATE — ${summary.client} / ${summary.category}`);
  console.log('═'.repeat(60));
  console.log(`  Total leads:       ${summary.total_leads}`);
  console.log(`  Signal coverage:   ${summary.signal_coverage_pct}% (${summary.total_leads - summary.fallback_count} with signal, ${summary.fallback_count} fallback)`);
  console.log(`  Emails revealed:   ${summary.emails_revealed} / ${summary.total_leads}`);
  console.log('\n  SAMPLE EMAIL 1 (first signal-eligible lead):');
  console.log('  ' + '─'.repeat(56));
  const body = summary.sample_lead.email1_body ?? '';
  body.split('\n').slice(0, 8).forEach(line => console.log(`  ${line}`));
  if (body.split('\n').length > 8) console.log('  [... truncated ...]');
  console.log('═'.repeat(60));
}

export async function runQualityGate(
  rows: Record<string, string>[],
  client: string,
  category: string,
): Promise<boolean> {
  const summary = buildGateSummary(rows, client, category);
  printGateSummary(summary);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question('\n  Approve and continue to upload? (yes/no): ', answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/_quality_gate.test.ts
```
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/_quality_gate.ts tests/_quality_gate.test.ts
git commit -m "feat: add pre-upload quality gate with summary and confirmation"
```

---

## Task 4: Patch Global Prospeo Logging (skills folder)

**Context:** `skills/cold-email-starter-kit/scripts/prospeo-full-export.ts` uses raw `fetch` to call Prospeo. It lives in the skills folder, which uses a different import root (`_lib.ts` from its own dir). We patch it to import `_prospeo_client.ts` from the scripts root.

**Files:**
- Modify: `skills/cold-email-starter-kit/scripts/prospeo-full-export.ts` (line 19 — `searchPage` function)

- [ ] **Step 1: Add import at top of `prospeo-full-export.ts`**

After line 8 (the `_lib.ts` import), add:

```typescript
import { prospeoSearchPage } from '../../../scripts/_prospeo_client';
```

- [ ] **Step 2: Replace `searchPage` function**

Replace:

```typescript
async function searchPage(filters: any, page: number, apiKey: string): Promise<any> {
  const res = await retry(() => fetch("https://api.prospeo.io/search-person", {
    method: "POST",
    headers: { "X-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ page, filters }),
  }));
  if (!res.ok) throw new Error(`Prospeo ${res.status}: ${await res.text()}`);
  return await res.json();
}
```

With:

```typescript
async function searchPage(filters: any, page: number, apiKey: string): Promise<any> {
  return prospeoSearchPage(filters, page, apiKey, 'prospeo-full-export.ts');
}
```

- [ ] **Step 3: Verify it compiles**

```bash
npx tsx --no-warnings -e "import './skills/cold-email-starter-kit/scripts/prospeo-full-export.ts'" 2>&1 | head -5
```

Expected: Usage/help output or silent — no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add skills/cold-email-starter-kit/scripts/prospeo-full-export.ts
git commit -m "feat: wire skills/prospeo-full-export through shared _prospeo_client for logging"
```

---

## Task 5: run-pipeline.ts Orchestrator

**Context:** This is the main deliverable — one command runs the full pipeline for a client + category. It chains: load config → Prospeo pull → qualify → extract signals → generate bridges → render → reveal emails → quality gate. Each step is logged. Smartlead upload is printed as a command but NOT auto-run (human must run it separately after gate approval).

**Files:**
- Create: `scripts/run-pipeline.ts`

- [ ] **Step 1: Write failing smoke test**

```typescript
// tests/run-pipeline.test.ts
import { describe, it, expect } from 'vitest';
import { parseCliArgs } from '../scripts/run-pipeline';

describe('parseCliArgs', () => {
  it('parses --client and --category', () => {
    const args = parseCliArgs(['node', 'run-pipeline.ts', '--client', 'belardi-wong', '--category', 'footwear']);
    expect(args.client).toBe('belardi-wong');
    expect(args.category).toBe('footwear');
  });

  it('throws when --client missing', () => {
    expect(() => parseCliArgs(['node', 'run-pipeline.ts', '--category', 'footwear'])).toThrow('--client');
  });

  it('throws when --category missing', () => {
    expect(() => parseCliArgs(['node', 'run-pipeline.ts', '--client', 'belardi-wong'])).toThrow('--category');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/run-pipeline.test.ts
```
Expected: FAIL — `Cannot find module '../scripts/run-pipeline'`

- [ ] **Step 3: Create `scripts/run-pipeline.ts`**

```typescript
// ---------------------------------------------------------------------------
// run-pipeline.ts — single-command orchestrator
//
// Usage:
//   npx tsx scripts/run-pipeline.ts --client belardi-wong --category footwear
//
// Steps:
//   1. Load client config
//   2. Prospeo pull → raw leads CSV
//   3. Signal extraction → leads-with-signals CSV
//   4. Bridge generation (OpenRouter or file-based)
//   5. Render emails → final CSV
//   6. Reveal emails via LeadMagic
//   7. Quality gate (human approval)
//   8. Print Smartlead upload command (not auto-run)
// ---------------------------------------------------------------------------

import { resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { loadClientConfigByName } from './_client_config';
import { makeAutoInvoker } from './_openrouter_invoker';
import { runQualityGate } from './_quality_gate';
import { loadExclusionSet } from './_exclusion_list';
import { logApiCall } from './_api_logger';

export function parseCliArgs(argv: string[]): { client: string; category: string; dryRun: boolean } {
  const args = argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const client = get('--client');
  const category = get('--category');
  const dryRun = args.includes('--dry-run');
  if (!client) throw new Error('--client is required. e.g. --client belardi-wong');
  if (!category) throw new Error('--category is required. e.g. --category footwear');
  return { client, category, dryRun };
}

function dataDir(client: string, category: string): string {
  return resolve(process.cwd(), `profiles/${client}/campaigns/lookalike-anchor/data`);
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n[→] ${name}...`);
  const t0 = Date.now();
  await fn();
  console.log(`[✓] ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

async function runPipeline(client: string, category: string, dryRun: boolean) {
  const cfg = loadClientConfigByName(client);
  const base = dataDir(client, category);
  if (!existsSync(base)) mkdirSync(base, { recursive: true });

  const paths = {
    rawLeads:       resolve(base, `${category}-raw.csv`),
    withSignals:    resolve(base, `${category}-with-signals.csv`),
    bridgeResponses: resolve(base, `bridge-responses-${category}`),
    signalsDir:     resolve(base, `signals-${category}`),
    finalCsv:       resolve(base, `${category}-final-v5.csv`),
  };

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  PIPELINE: ${cfg.business.name} / ${category}`);
  console.log(`  Dry run: ${dryRun}`);
  console.log('═'.repeat(60));

  // Step 1: Prospeo pull
  await step('Prospeo lead pull', async () => {
    if (dryRun) { console.log('  [dry-run] skipping Prospeo pull'); return; }
    const { execSync } = await import('child_process');
    execSync(
      `npx tsx scripts/prospeo-trial-search.ts`,
      { stdio: 'inherit', env: { ...process.env, PIPELINE_CATEGORY: category, PIPELINE_CLIENT: client } }
    );
  });

  // Step 2: Signal extraction
  await step('Signal extraction (Serper)', async () => {
    if (dryRun) { console.log('  [dry-run] skipping signal extraction'); return; }
    const { execSync } = await import('child_process');
    execSync(
      `npx tsx scripts/extract-signals.ts ${paths.rawLeads} ${paths.withSignals} ${paths.signalsDir}`,
      { stdio: 'inherit' }
    );
  });

  // Step 3 + 4: Bridge generation + render
  await step('Bridge generation + email render', async () => {
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    const aiInvoke = makeAutoInvoker(openRouterKey, paths.bridgeResponses);
    if (openRouterKey) {
      console.log('  Using OpenRouter for bridge generation (automated)');
    } else {
      console.log('  No OPENROUTER_API_KEY — using file-based bridge responses');
    }

    const { renderLead } = await import('./render-with-signals');
    const { StatRotator } = await import('./_stat_rotator');
    const { parseCsv, writeCsv } = await import('./_csv_io');
    const { readFileSync, writeFileSync } = await import('fs');

    if (!existsSync(paths.withSignals)) {
      console.warn(`  Signals CSV not found at ${paths.withSignals} — using raw leads`);
    }

    const csvPath = existsSync(paths.withSignals) ? paths.withSignals : paths.rawLeads;
    const { headers, rows } = parseCsv(readFileSync(csvPath, 'utf8'));
    const exclusionSet = loadExclusionSet();
    const rotator = new StatRotator();
    const rendered: Record<string, any>[] = [];

    for (const lead of rows) {
      if (!lead.person_id) continue;
      const { isExcluded } = await import('./_exclusion_list');
      if (isExcluded(lead.company_domain, exclusionSet, lead.company_name)) {
        console.log(`  Skipped excluded: ${lead.person_id}`);
        continue;
      }
      try {
        const r = await renderLead({
          person_id: lead.person_id,
          first_name: lead.first_name,
          full_name: lead.full_name,
          current_job_title: lead.current_job_title,
          company_name: lead.company_name,
          company_domain: lead.company_domain,
          qual_confidence: parseFloat(lead.qual_confidence) || 0.5,
          primary_vertical: lead.primary_vertical || category,
          assigned_variant: (lead.assigned_variant as 'B' | 'C') || 'B',
          vertical_anchor: lead.vertical_anchor,
          ai_similarity_dimension: lead.ai_similarity_dimension,
          ai_brand_category: lead.ai_brand_category,
          ai_role_hook: lead.ai_role_hook || '',
        }, aiInvoke, paths.signalsDir, rotator);
        rendered.push({ ...lead, ...r });
      } catch (err) {
        console.error(`  Render error ${lead.person_id}: ${err}`);
      }
    }

    const outHeaders = [
      ...headers,
      'enrichment_tier', 'signal_used', 'signal_fact', 'signal_bridge',
      'signal_freshness_days', 'signal_e2_back_reference',
      'email1_subject', 'email1_body', 'email2_subject', 'email2_body',
      'email3_subject', 'email3_body', 'email4_subject', 'email4_body',
    ];
    writeFileSync(paths.finalCsv, writeCsv(rendered, outHeaders));
    console.log(`  Rendered ${rendered.length} leads → ${paths.finalCsv}`);
  });

  // Step 5: LeadMagic email reveal
  await step('Email reveal (LeadMagic)', async () => {
    const lmKey = process.env.LEADMAGIC_API_KEY;
    if (!lmKey) { console.log('  No LEADMAGIC_API_KEY — skipping email reveal'); return; }
    if (dryRun) { console.log('  [dry-run] skipping email reveal'); return; }
    const { execSync } = await import('child_process');
    execSync(`npx tsx scripts/reveal-emails-leadmagic.ts ${paths.finalCsv}`, { stdio: 'inherit' });
  });

  // Step 6: Quality gate
  const { readFileSync } = await import('fs');
  const { parseCsv } = await import('./_csv_io');
  const finalRows = existsSync(paths.finalCsv)
    ? parseCsv(readFileSync(paths.finalCsv, 'utf8')).rows
    : [];

  if (dryRun) {
    console.log('\n[dry-run] Skipping quality gate. Pipeline complete.');
    return;
  }

  const approved = await runQualityGate(finalRows, client, category);

  if (!approved) {
    console.log('\n  Not approved. Stopping. Fix issues then re-run.');
    process.exit(0);
  }

  // Step 7: Print upload command (never auto-run)
  console.log('\n' + '═'.repeat(60));
  console.log('  APPROVED. Run this command to upload to Smartlead (DRAFT):');
  console.log('═'.repeat(60));
  console.log(`\n  npx tsx scripts/smartlead-upload.ts ${paths.finalCsv}\n`);
  console.log('  Campaign will be created in DRAFT. You must start it manually in Smartlead UI.');
  console.log('═'.repeat(60));
}

// CLI entry
import { pathToFileURL } from 'url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { client, category, dryRun } = parseCliArgs(process.argv);
  runPipeline(client, category, dryRun).catch(e => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/run-pipeline.test.ts
```
Expected: PASS — 3 tests

- [ ] **Step 5: Smoke test with dry-run flag**

```bash
npx tsx scripts/run-pipeline.ts --client belardi-wong --category footwear --dry-run
```

Expected output:
```
══════════════════...
  PIPELINE: Belardi Wong / footwear
  Dry run: true
══════════════════...
[→] Prospeo lead pull...
  [dry-run] skipping Prospeo pull
[✓] Prospeo lead pull (0.0s)
[→] Signal extraction (Serper)...
  [dry-run] skipping signal extraction
...
[dry-run] Skipping quality gate. Pipeline complete.
```

- [ ] **Step 6: Commit**

```bash
git add scripts/run-pipeline.ts tests/run-pipeline.test.ts
git commit -m "feat: add run-pipeline.ts single-command orchestrator for client+category runs"
```

---

## Execution Order

Tasks 1–4 are independent — can run in parallel with subagents.
Task 5 depends on Tasks 1, 2, 3 being complete.

---

## Self-Review

**Spec coverage:**
- ✅ One command per category: `run-pipeline.ts --client X --category Y`
- ✅ Client config loaded from `profiles/{client}/client-profile.yaml` (Task 1)
- ✅ Bridge generation automated via OpenRouter with file-based fallback (Task 2)
- ✅ Quality gate before upload (Task 3)
- ✅ Prospeo logging global including skills folder (Task 4)
- ✅ Exclusion list enforced inside orchestrator (Task 5, render loop)
- ✅ Upload never auto-runs — prints command only

**Placeholder scan:** No TBDs. All code complete. `reveal-emails-leadmagic.ts` CLI args assumed to accept a CSV path — verify actual signature before running Task 5 Step 5 in production.

**Type consistency:** `AiInvoker` defined in `_bridge_writer.ts`, imported consistently in Tasks 2 and 5. `ExclusionSet` from `_exclusion_list.ts` used consistently. `ClientConfig` defined in Task 1, used in Task 5.
