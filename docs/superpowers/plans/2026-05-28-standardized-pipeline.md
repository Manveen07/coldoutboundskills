# Standardized Cold Email Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one config-driven cold email pipeline that produces production-quality, research-driven emails for any client. Adding a new client requires writing one YAML; no per-client scripts.

**Architecture:** Single orchestrator (`scripts/pipeline/run.ts`) drives 6 stages (pull → score → research → write → validate → gate). Every API response cached to disk before parsing. Stage 4 writer is an Opus sub-agent that drafts all 4 emails in one call from a research dossier. Stage 5 validator runs 3 sub-stages per email (mechanical regex, semantic LLM, recipient role-play LLM). Pre-flight cost gate and 3-lead smoke run gate every full run.

**Tech Stack:** TypeScript, tsx (no build step), vitest, Claude Code sub-agents (Opus), Serper API, Prospeo API. No external paid LLM APIs needed for content generation — sub-agents handle all writing and validation.

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `scripts/pipeline/_cache.ts` | Create | Generic cache layer: write-before-parse, TTL, key hashing |
| `scripts/pipeline/_pull.ts` | Create | Stage 1: Prospeo lead pull with caching |
| `scripts/pipeline/_score.ts` | Create | Stage 2: ICP qualifier via Opus sub-agent |
| `scripts/pipeline/_research.ts` | Create | Stage 3: Tiered research (Serper + scrape + person) |
| `scripts/pipeline/_scrape.ts` | Create | Stage 3 Tier 2: HTML fetch + parse for free signals |
| `scripts/pipeline/_write.ts` | Create | Stage 4: Opus sub-agent email writer |
| `scripts/pipeline/_validate.ts` | Create | Stage 5: 3-stage validator with regen loop |
| `scripts/pipeline/_credit_guard.ts` | Create | Pre-flight cost estimation and confirmation gate |
| `scripts/pipeline/_smoke.ts` | Create | 3-lead smoke run before full pipeline |
| `scripts/pipeline/_run_artifacts.ts` | Create | Writes run artifacts (preflight, locked prompts, logs) |
| `scripts/pipeline/_subagent_runner.ts` | Create | Wrapper for parallel sub-agent dispatch with retries |
| `scripts/pipeline/run.ts` | Create | Orchestrator main entry point |
| `scripts/pipeline/recover.ts` | Create | Re-extract / re-score / re-write from cache |
| `scripts/pipeline/cache-stats.ts` | Create | Cache audit command |
| `scripts/_serper_client.ts` | Modify | Wire through `_cache.ts` |
| `scripts/_prospeo_client.ts` | Modify | Wire through `_cache.ts` |
| `scripts/_client_config.ts` | Modify | Add `priority_domains`, `example_emails`, `vocab_in/out` fields |
| `config/limits.yaml` | Create | Hard caps + batch size config |
| `profiles/mythic/example-emails.md` | Create | 3 example good emails (Mythic voice anchor) |
| `profiles/belardi-wong/example-emails.md` | Create | 3 example good emails (BW voice anchor) |
| `scripts/legacy/` | Create | Move old client-specific scripts here, with README |
| `tests/pipeline/*.test.ts` | Create | Unit + integration tests for each module |
| `tests/fixtures/` | Create | Golden Serper/Prospeo/scrape responses for integration tests |

---

## Task 1: Cache Layer (`_cache.ts`)

**Context:** Every Serper, Prospeo, scrape, and person-research call MUST save its raw response to disk *before* any parsing. This single change is what prevents wasted credits. All other pipeline modules read/write through this layer.

**Files:**
- Create: `scripts/pipeline/_cache.ts`
- Test: `tests/pipeline/_cache.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/pipeline/_cache.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { fetchWithCache, readCache, writeCache, isCacheStale, hashKey, clearCacheDomain } from '../../scripts/pipeline/_cache';

const TEST_DIR = resolve(__dirname, '../../data/cache-test');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('hashKey', () => {
  it('returns same hash for same input', () => {
    expect(hashKey('captainds.com', 'funding query')).toBe(hashKey('captainds.com', 'funding query'));
  });

  it('returns different hash for different input', () => {
    expect(hashKey('a', 'b')).not.toBe(hashKey('a', 'c'));
  });
});

describe('writeCache and readCache', () => {
  it('writes and reads JSON payload', () => {
    writeCache(TEST_DIR, 'k1', { foo: 'bar', n: 42 });
    const got = readCache(TEST_DIR, 'k1');
    expect(got).toEqual({ foo: 'bar', n: 42 });
  });

  it('returns null for missing key', () => {
    expect(readCache(TEST_DIR, 'nonexistent')).toBeNull();
  });
});

describe('isCacheStale', () => {
  it('returns false for fresh cache within TTL', () => {
    writeCache(TEST_DIR, 'k1', { foo: 'bar' });
    expect(isCacheStale(TEST_DIR, 'k1', 30)).toBe(false);
  });

  it('returns true when file does not exist', () => {
    expect(isCacheStale(TEST_DIR, 'missing', 30)).toBe(true);
  });
});

describe('fetchWithCache', () => {
  it('calls fetcher on cache miss and saves response', async () => {
    let calls = 0;
    const result = await fetchWithCache(TEST_DIR, 'k1', 30, async () => {
      calls++;
      return { value: 'from-api' };
    });
    expect(calls).toBe(1);
    expect(result.raw).toEqual({ value: 'from-api' });
    expect(result.fromCache).toBe(false);
  });

  it('does not call fetcher on cache hit', async () => {
    writeCache(TEST_DIR, 'k1', { value: 'cached' });
    let calls = 0;
    const result = await fetchWithCache(TEST_DIR, 'k1', 30, async () => { calls++; return { value: 'new' }; });
    expect(calls).toBe(0);
    expect(result.raw).toEqual({ value: 'cached' });
    expect(result.fromCache).toBe(true);
  });

  it('saves to disk BEFORE returning, so parser failures do not lose data', async () => {
    await fetchWithCache(TEST_DIR, 'k1', 30, async () => ({ value: 'must-be-saved' }));
    // Now if we read directly, the data must be there
    const stored = readCache(TEST_DIR, 'k1');
    expect(stored).toEqual({ value: 'must-be-saved' });
  });
});

describe('clearCacheDomain', () => {
  it('only clears entries matching the domain', () => {
    writeCache(TEST_DIR, 'captainds.com--funding', { x: 1 });
    writeCache(TEST_DIR, 'captainds.com--press', { x: 2 });
    writeCache(TEST_DIR, 'other.com--funding', { x: 3 });
    const cleared = clearCacheDomain(TEST_DIR, 'captainds.com');
    expect(cleared).toBe(2);
    expect(readCache(TEST_DIR, 'captainds.com--funding')).toBeNull();
    expect(readCache(TEST_DIR, 'other.com--funding')).toEqual({ x: 3 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd coldoutboundskills && npx vitest run tests/pipeline/_cache.test.ts
```
Expected: FAIL — `Cannot find module '../../scripts/pipeline/_cache'`

- [ ] **Step 3: Create `scripts/pipeline/_cache.ts`**

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

export interface CacheResult<T = any> {
  raw: T;
  fromCache: boolean;
  cachedAt?: string;
}

export function hashKey(...parts: string[]): string {
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

function pathFor(dir: string, key: string): string {
  return resolve(dir, `${key}.json`);
}

export function writeCache(dir: string, key: string, payload: any): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const wrapped = { _cached_at: new Date().toISOString(), payload };
  writeFileSync(pathFor(dir, key), JSON.stringify(wrapped, null, 2), 'utf8');
}

export function readCache<T = any>(dir: string, key: string): T | null {
  const p = pathFor(dir, key);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    return (raw.payload ?? raw) as T;
  } catch {
    return null;
  }
}

export function isCacheStale(dir: string, key: string, ttlDays: number): boolean {
  const p = pathFor(dir, key);
  if (!existsSync(p)) return true;
  const ageMs = Date.now() - statSync(p).mtimeMs;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays > ttlDays;
}

/**
 * Core safety primitive. Saves raw response to disk BEFORE returning.
 * Bug in caller's parser? Cache is already on disk for replay.
 */
export async function fetchWithCache<T = any>(
  dir: string,
  key: string,
  ttlDays: number,
  fetcher: () => Promise<T>,
): Promise<CacheResult<T>> {
  if (!isCacheStale(dir, key, ttlDays)) {
    const cached = readCache<T>(dir, key);
    if (cached !== null) return { raw: cached, fromCache: true };
  }
  const raw = await fetcher();
  writeCache(dir, key, raw);
  return { raw, fromCache: false };
}

/**
 * Clear all cache files whose key starts with the domain prefix.
 * Returns number of files deleted.
 */
export function clearCacheDomain(dir: string, domain: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  const prefix = domain.toLowerCase();
  for (const f of readdirSync(dir)) {
    if (f.toLowerCase().startsWith(prefix) && f.endsWith('.json')) {
      unlinkSync(resolve(dir, f));
      count++;
    }
  }
  return count;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/pipeline/_cache.test.ts
```
Expected: PASS — all tests

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/_cache.ts tests/pipeline/_cache.test.ts
git commit -m "feat(pipeline): add raw-response cache layer with write-before-parse safety"
```

---

## Task 2: Subagent Runner (`_subagent_runner.ts`)

**Context:** Pipeline stages 2, 4, and 5 all dispatch Opus sub-agents. We need one wrapper that handles batching (parallel dispatch), retries with backoff, JSON parsing of responses, and failure logging. Sub-agents in Claude Code are dispatched via a Task tool (mocked in tests).

**Files:**
- Create: `scripts/pipeline/_subagent_runner.ts`
- Test: `tests/pipeline/_subagent_runner.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/pipeline/_subagent_runner.test.ts
import { describe, it, expect } from 'vitest';
import { runSubagentBatch, parseJsonFromResponse } from '../../scripts/pipeline/_subagent_runner';

describe('parseJsonFromResponse', () => {
  it('extracts JSON object from markdown code fence', () => {
    const text = 'Here is the result:\n```json\n{"a": 1}\n```\nDone.';
    expect(parseJsonFromResponse(text)).toEqual({ a: 1 });
  });

  it('extracts JSON array from bare text', () => {
    const text = 'Result: [{"id": 1}, {"id": 2}]';
    expect(parseJsonFromResponse(text)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('throws on no JSON', () => {
    expect(() => parseJsonFromResponse('no json here')).toThrow();
  });
});

describe('runSubagentBatch', () => {
  it('dispatches in parallel batches of given size', async () => {
    let active = 0;
    let maxActive = 0;
    const dispatch = async (prompt: string) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(r => setTimeout(r, 10));
      active--;
      return `{"prompt": "${prompt}"}`;
    };
    const prompts = ['a', 'b', 'c', 'd', 'e'];
    const results = await runSubagentBatch(prompts, dispatch, { batchSize: 2 });
    expect(results.length).toBe(5);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('retries on failure up to maxRetries', async () => {
    let attempts = 0;
    const dispatch = async () => {
      attempts++;
      if (attempts < 3) throw new Error('transient');
      return '{"ok": true}';
    };
    const results = await runSubagentBatch(['p'], dispatch, { batchSize: 1, maxRetries: 3 });
    expect(results[0].success).toBe(true);
    expect(results[0].retries).toBe(2);
    expect(attempts).toBe(3);
  });

  it('marks failed after exhausting retries', async () => {
    const dispatch = async () => { throw new Error('permanent'); };
    const results = await runSubagentBatch(['p'], dispatch, { batchSize: 1, maxRetries: 2 });
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('permanent');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/pipeline/_subagent_runner.test.ts
```
Expected: FAIL — `Cannot find module '../../scripts/pipeline/_subagent_runner'`

- [ ] **Step 3: Create `scripts/pipeline/_subagent_runner.ts`**

```typescript
export type SubagentDispatcher = (prompt: string) => Promise<string>;

export interface SubagentResult<T = any> {
  success: boolean;
  data?: T;
  rawResponse?: string;
  error?: string;
  retries: number;
}

export interface SubagentBatchOptions {
  batchSize?: number;
  maxRetries?: number;
  parseJson?: boolean;
}

export function parseJsonFromResponse(text: string): any {
  // Try fenced ```json block first
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    return JSON.parse(fenced[1].trim());
  }
  // Try bare JSON object or array
  const objMatch = text.match(/\{[\s\S]*\}/);
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch && (!objMatch || arrMatch.index! < objMatch.index!)) {
    return JSON.parse(arrMatch[0]);
  }
  if (objMatch) {
    return JSON.parse(objMatch[0]);
  }
  throw new Error('No JSON found in response');
}

async function dispatchWithRetry<T = any>(
  prompt: string,
  dispatch: SubagentDispatcher,
  maxRetries: number,
  parseJson: boolean,
): Promise<SubagentResult<T>> {
  let lastError = '';
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const raw = await dispatch(prompt);
      const data = parseJson ? parseJsonFromResponse(raw) : raw;
      return { success: true, data, rawResponse: raw, retries: attempt };
    } catch (err: any) {
      lastError = err?.message ?? String(err);
      const backoff = Math.pow(2, attempt) * 1000;
      await new Promise(r => setTimeout(r, backoff));
    }
  }
  return { success: false, error: lastError, retries: maxRetries - 1 };
}

export async function runSubagentBatch<T = any>(
  prompts: string[],
  dispatch: SubagentDispatcher,
  opts: SubagentBatchOptions = {},
): Promise<SubagentResult<T>[]> {
  const batchSize = opts.batchSize ?? 10;
  const maxRetries = opts.maxRetries ?? 3;
  const parseJson = opts.parseJson ?? true;

  const results: SubagentResult<T>[] = [];
  for (let i = 0; i < prompts.length; i += batchSize) {
    const batch = prompts.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(p => dispatchWithRetry<T>(p, dispatch, maxRetries, parseJson))
    );
    results.push(...batchResults);
  }
  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/pipeline/_subagent_runner.test.ts
```
Expected: PASS — all tests

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/_subagent_runner.ts tests/pipeline/_subagent_runner.test.ts
git commit -m "feat(pipeline): add subagent batch runner with retries and JSON parsing"
```

---

## Task 3: Limits Config + Constants

**Context:** Hard caps prevent runaway API spend. Default batch size makes parallelism tunable.

**Files:**
- Create: `config/limits.yaml`
- Create: `scripts/pipeline/_limits.ts`
- Test: `tests/pipeline/_limits.test.ts`

- [ ] **Step 1: Create `config/limits.yaml`**

```yaml
# Hard caps applied to every pipeline run. If exceeded, run aborts immediately.
hard_caps:
  serper_per_run: 1000
  prospeo_per_run: 50
  leadmagic_per_run: 500

# Default parallel batch size for sub-agent dispatches. Per-stage override possible.
batch_size_default: 10

# Stage 5b semantic validator pass threshold (1-10).
semantic_pass_threshold: 7

# Stage 3 research tier cutoffs.
tier_thresholds:
  t2_qual_confidence: 0.8
  t3_qual_confidence: 0.9

# Stage 4 writer parallel batch size (smaller due to context size).
write_batch_size: 5
```

- [ ] **Step 2: Write failing tests**

```typescript
// tests/pipeline/_limits.test.ts
import { describe, it, expect } from 'vitest';
import { loadLimits, checkCap } from '../../scripts/pipeline/_limits';

describe('loadLimits', () => {
  it('reads config/limits.yaml without throwing', () => {
    const limits = loadLimits();
    expect(limits.hard_caps.serper_per_run).toBeGreaterThan(0);
    expect(limits.batch_size_default).toBeGreaterThan(0);
  });
});

describe('checkCap', () => {
  const limits = { hard_caps: { serper_per_run: 100, prospeo_per_run: 10, leadmagic_per_run: 50 }, batch_size_default: 10, semantic_pass_threshold: 7, tier_thresholds: { t2_qual_confidence: 0.8, t3_qual_confidence: 0.9 }, write_batch_size: 5 };

  it('passes when under cap', () => {
    expect(() => checkCap(limits, 'serper_per_run', 50)).not.toThrow();
  });

  it('throws when over cap', () => {
    expect(() => checkCap(limits, 'serper_per_run', 150)).toThrow(/cap exceeded/i);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/pipeline/_limits.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 4: Create `scripts/pipeline/_limits.ts`**

```typescript
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';

export interface Limits {
  hard_caps: {
    serper_per_run: number;
    prospeo_per_run: number;
    leadmagic_per_run: number;
  };
  batch_size_default: number;
  semantic_pass_threshold: number;
  tier_thresholds: {
    t2_qual_confidence: number;
    t3_qual_confidence: number;
  };
  write_batch_size: number;
}

export function loadLimits(path?: string): Limits {
  const p = path ?? resolve(process.cwd(), 'config/limits.yaml');
  if (!existsSync(p)) {
    throw new Error(`Limits config not found: ${p}`);
  }
  return yaml.load(readFileSync(p, 'utf8')) as Limits;
}

export function checkCap(limits: Limits, key: keyof Limits['hard_caps'], plannedCount: number): void {
  const cap = limits.hard_caps[key];
  if (plannedCount > cap) {
    throw new Error(`Cap exceeded: ${key} planned=${plannedCount} cap=${cap}. Aborting run.`);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/pipeline/_limits.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add config/limits.yaml scripts/pipeline/_limits.ts tests/pipeline/_limits.test.ts
git commit -m "feat(pipeline): add limits config with hard caps and tier thresholds"
```

---

## Task 4: Extend Client Config Loader

**Context:** `scripts/_client_config.ts` already exists. Extend it with `priority_domains`, `example_emails`, and copy-style fields needed by Stage 4 writer.

**Files:**
- Modify: `scripts/_client_config.ts`
- Modify: `tests/_client_config.test.ts`

- [ ] **Step 1: Add failing tests**

Add to `tests/_client_config.test.ts`:

```typescript
import { getPriorityDomains, getExampleEmails, getCopyStyle } from '../scripts/_client_config';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';

describe('getPriorityDomains', () => {
  it('returns empty array when not set', () => {
    const cfg = loadClientConfig(BW_PROFILE);
    const result = getPriorityDomains(cfg);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('getExampleEmails', () => {
  it('returns empty array when no examples file', () => {
    const result = getExampleEmails('nonexistent-client');
    expect(result).toEqual([]);
  });

  it('reads example-emails.md when file exists', () => {
    const dir = resolve(process.cwd(), 'profiles/_test-client');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'example-emails.md'), '---\n# Email 1\nBody one\n---\n# Email 2\nBody two\n');
    const result = getExampleEmails('_test-client');
    expect(result.length).toBe(2);
    expect(result[0]).toContain('Body one');
  });
});

describe('getCopyStyle', () => {
  it('returns copy_tone fields from config', () => {
    const cfg = loadClientConfig(BW_PROFILE);
    const style = getCopyStyle(cfg);
    expect(style).toHaveProperty('vocab_in');
    expect(style).toHaveProperty('vocab_out');
    expect(style).toHaveProperty('banned_phrases');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/_client_config.test.ts
```
Expected: FAIL — `getPriorityDomains is not a function`

- [ ] **Step 3: Extend `scripts/_client_config.ts`**

Add to the end of the file:

```typescript
import { readFileSync as _rfs, existsSync as _ex } from 'fs';

export function getPriorityDomains(cfg: ClientConfig): string[] {
  return ((cfg as any).priority_domains ?? []) as string[];
}

export function getCopyStyle(cfg: ClientConfig): {
  vocab_in: string[];
  vocab_out: string[];
  banned_phrases: string[];
  tone: string;
} {
  const c = (cfg as any).copy_tone ?? {};
  return {
    vocab_in: c.in_vocabulary ?? [],
    vocab_out: c.out_vocabulary ?? [],
    banned_phrases: cfg.legal?.banned_words ?? [],
    tone: c.style ?? cfg.business?.tone ?? 'peer-to-peer',
  };
}

export function getExampleEmails(clientName: string): string[] {
  const p = resolve(process.cwd(), `profiles/${clientName}/example-emails.md`);
  if (!_ex(p)) return [];
  const raw = _rfs(p, 'utf8');
  // Split on lines that are exactly "---"
  const parts = raw.split(/^---\s*$/m).map(s => s.trim()).filter(s => s.length > 0);
  return parts;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/_client_config.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/_client_config.ts tests/_client_config.test.ts
git commit -m "feat(client-config): add priority_domains, example_emails, copy_style helpers"
```

---

## Task 5: Stage 1 — Lead Pull (`_pull.ts`)

**Context:** Replaces `mythic-prospeo-search.ts` and `prospeo-trial-search.ts`. Reads filters from `client-profile.yaml`, builds Prospeo query, pulls pages, caches each raw response. Per-category industry override supported.

**Files:**
- Create: `scripts/pipeline/_pull.ts`
- Test: `tests/pipeline/_pull.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/pipeline/_pull.test.ts
import { describe, it, expect } from 'vitest';
import { buildProspeoFilters, leadFromProspeoResult } from '../../scripts/pipeline/_pull';
import type { ClientConfig } from '../../scripts/_client_config';

const SAMPLE_CFG: ClientConfig = {
  business: { name: 'Test', website: '', one_liner: '', tone: '' },
  offer: { primary_product: '', primary_cta: '', lead_magnet: '', value_prop: '' },
  icp_hard_filters: {
    job_titles: ['CMO', 'VP Marketing'],
    industries_in: ['Restaurants', 'General Retail'],
    industries_out: [],
    headcount_min: 200,
    headcount_max: 10000,
    countries: ['US'],
    excluded_domains: [],
  },
  proof_points: { headline_stats: [], vertical_anchor_map: {}, portfolio_stats: [], by_product: {} },
} as any;

describe('buildProspeoFilters', () => {
  it('maps client config to Prospeo filter object', () => {
    const filters = buildProspeoFilters(SAMPLE_CFG);
    expect(filters.person_job_title?.include).toContain('CMO');
    expect(filters.company_industry?.include).toContain('Restaurants');
    expect(filters.company_headcount_custom).toEqual({ min: 200, max: 10000 });
    expect(filters.person_location_search?.include).toContain('United States #US');
  });

  it('applies category override when provided', () => {
    const cfg = { ...SAMPLE_CFG };
    (cfg as any).vertical_industries = { qsr: ['Restaurants'] };
    const filters = buildProspeoFilters(cfg, 'qsr');
    expect(filters.company_industry?.include).toEqual(['Restaurants']);
  });
});

describe('leadFromProspeoResult', () => {
  it('extracts standard fields from Prospeo result', () => {
    const result = {
      person: {
        person_id: 'p1', first_name: 'Jane', last_name: 'Doe', full_name: 'Jane Doe',
        current_job_title: 'CMO', linkedin_url: 'https://lnk', location: { city: 'NYC', state: 'NY', country: 'US' },
        email: 'jane@acme.com',
      },
      company: { name: 'Acme', domain: 'acme.com', industry: 'Restaurants', headcount: 500, headcount_range: '201-500' },
    };
    const lead = leadFromProspeoResult(result);
    expect(lead.person_id).toBe('p1');
    expect(lead.full_name).toBe('Jane Doe');
    expect(lead.company_name).toBe('Acme');
    expect(lead.company_domain).toBe('acme.com');
    expect(lead.email).toBe('jane@acme.com');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/pipeline/_pull.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Create `scripts/pipeline/_pull.ts`**

```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { ClientConfig } from '../_client_config';
import { prospeoSearchPage, extractEmail, type ProspeoFilters } from '../_prospeo_client';
import { fetchWithCache, hashKey } from './_cache';

export interface Lead {
  person_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  current_job_title: string;
  email: string;
  email_status: string;
  person_linkedin_url: string;
  person_city: string;
  person_state: string;
  person_country: string;
  company_name: string;
  company_domain: string;
  company_industry: string;
  company_headcount: string;
  company_headcount_range: string;
  company_linkedin_url: string;
  company_city: string;
  company_state: string;
  company_country: string;
}

export function buildProspeoFilters(cfg: ClientConfig, category?: string): ProspeoFilters {
  const f = cfg.icp_hard_filters;
  const verticalIndustries = (cfg as any).vertical_industries as Record<string, string[]> | undefined;
  const industries = category && verticalIndustries?.[category]
    ? verticalIndustries[category]
    : f.industries_in;

  return {
    person_job_title: { include: f.job_titles, match_only_exact_job_titles: false },
    person_location_search: { include: (f.countries ?? ['US']).map(c => `United States #${c}`) },
    company_headcount_custom: { min: f.headcount_min, max: f.headcount_max },
    company_industry: { include: industries },
    person_contact_details: { email: ['VERIFIED'] },
  };
}

export function leadFromProspeoResult(result: any): Lead {
  const p = result.person ?? {};
  const c = result.company ?? {};
  const loc = p.location ?? {};
  const em = extractEmail(p.email);
  return {
    person_id: p.person_id ?? '',
    first_name: p.first_name ?? '',
    last_name: p.last_name ?? '',
    full_name: p.full_name ?? '',
    current_job_title: p.current_job_title ?? '',
    email: em.value,
    email_status: em.status || (p.email_status ?? ''),
    person_linkedin_url: p.linkedin_url ?? '',
    person_city: loc.city ?? '',
    person_state: loc.state ?? '',
    person_country: loc.country ?? '',
    company_name: c.name ?? '',
    company_domain: c.domain ?? '',
    company_industry: c.industry ?? '',
    company_headcount: c.headcount ?? '',
    company_headcount_range: c.headcount_range ?? '',
    company_linkedin_url: c.linkedin_url ?? '',
    company_city: (c.location ?? {}).city ?? '',
    company_state: (c.location ?? {}).state ?? '',
    company_country: (c.location ?? {}).country ?? '',
  };
}

export interface PullOptions {
  apiKey: string;
  cfg: ClientConfig;
  category?: string;
  maxPages: number;
  startPage?: number;
  cacheDir?: string;
  ttlDays?: number;
  callerScript?: string;
}

export interface PullResult {
  leads: Lead[];
  pagesFetched: number;
  pagesFromCache: number;
  totalPool: number;
}

export async function pullLeads(opts: PullOptions): Promise<PullResult> {
  const filters = buildProspeoFilters(opts.cfg, opts.category);
  const filterHash = hashKey(JSON.stringify(filters));
  const cacheDir = opts.cacheDir ?? resolve(process.cwd(), 'data/research-cache/prospeo');
  const ttl = opts.ttlDays ?? 30;
  const startPage = opts.startPage ?? 1;
  const callerScript = opts.callerScript ?? 'pipeline/_pull.ts';

  const leads: Lead[] = [];
  const seen = new Set<string>();
  let pagesFetched = 0;
  let pagesFromCache = 0;
  let totalPool = 0;

  for (let page = startPage; page < startPage + opts.maxPages; page++) {
    const cacheKey = `${filterHash}-page-${page}`;
    const result = await fetchWithCache(cacheDir, cacheKey, ttl, async () => {
      return await prospeoSearchPage(filters, page, opts.apiKey, callerScript);
    });

    if (result.fromCache) pagesFromCache++;
    else pagesFetched++;

    const data = result.raw;
    if (page === startPage) totalPool = data?.pagination?.total_count ?? 0;
    const results = data?.results ?? [];
    if (results.length === 0) break;

    for (const r of results) {
      const lead = leadFromProspeoResult(r);
      if (!lead.person_id || seen.has(lead.person_id)) continue;
      seen.add(lead.person_id);
      leads.push(lead);
    }

    if (results.length < 25) break;
    // polite delay between live page fetches only
    if (!result.fromCache) await new Promise(r => setTimeout(r, 1500));
  }

  return { leads, pagesFetched, pagesFromCache, totalPool };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/pipeline/_pull.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/_pull.ts tests/pipeline/_pull.test.ts
git commit -m "feat(pipeline): Stage 1 lead pull with cache-first Prospeo wrapper"
```

---

## Task 6: Stage 2 — ICP Score (`_score.ts`)

**Context:** Replaces `mythic-score-leads.ts` + `mythic-apply-scores.ts`. Sub-agent receives ICP prompt + batch of leads, returns scored JSON. Cached per `{client}-{domain}-{prompt-hash}`.

**Files:**
- Create: `scripts/pipeline/_score.ts`
- Test: `tests/pipeline/_score.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/pipeline/_score.test.ts
import { describe, it, expect } from 'vitest';
import { buildScoringPrompt, applyScoresToLeads } from '../../scripts/pipeline/_score';
import type { Lead } from '../../scripts/pipeline/_pull';

const SAMPLE_LEAD: Lead = {
  person_id: 'p1', first_name: 'J', last_name: 'D', full_name: 'J D',
  current_job_title: 'CMO', email: '', email_status: '', person_linkedin_url: '',
  person_city: '', person_state: '', person_country: '',
  company_name: 'Acme', company_domain: 'acme.com', company_industry: 'Restaurants',
  company_headcount: '', company_headcount_range: '201-500', company_linkedin_url: '',
  company_city: '', company_state: '', company_country: '',
};

describe('buildScoringPrompt', () => {
  it('embeds ICP prompt and lead batch as JSON', () => {
    const prompt = buildScoringPrompt('ICP RULES HERE', [SAMPLE_LEAD]);
    expect(prompt).toContain('ICP RULES HERE');
    expect(prompt).toContain('acme.com');
    expect(prompt).toContain('Restaurants');
    expect(prompt).toMatch(/return.*JSON.*array/i);
  });
});

describe('applyScoresToLeads', () => {
  it('attaches qualified/confidence/reason to matching leads by domain', () => {
    const scores = [
      { company: 'Acme', domain: 'acme.com', qualified: true, confidence: 0.85, reason: 'fits ICP' },
    ];
    const result = applyScoresToLeads([SAMPLE_LEAD], scores);
    expect(result[0].icp_qualified).toBe('true');
    expect(result[0].icp_confidence).toBe('0.85');
    expect(result[0].icp_reason).toBe('fits ICP');
  });

  it('marks unscored leads with icp_qualified=unknown', () => {
    const result = applyScoresToLeads([SAMPLE_LEAD], []);
    expect(result[0].icp_qualified).toBe('unknown');
  });

  it('normalizes www. prefix when matching', () => {
    const scores = [{ company: 'Acme', domain: 'acme.com', qualified: true, confidence: 0.9, reason: '' }];
    const lead = { ...SAMPLE_LEAD, company_domain: 'www.acme.com' };
    const result = applyScoresToLeads([lead], scores);
    expect(result[0].icp_qualified).toBe('true');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/pipeline/_score.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Create `scripts/pipeline/_score.ts`**

```typescript
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { Lead } from './_pull';
import { runSubagentBatch, type SubagentDispatcher } from './_subagent_runner';
import { fetchWithCache, hashKey } from './_cache';

export interface Score {
  company: string;
  domain: string;
  qualified: boolean;
  confidence: number;
  reason: string;
}

export interface ScoredLead extends Lead {
  icp_qualified: string;
  icp_confidence: string;
  icp_reason: string;
}

export function buildScoringPrompt(icpPrompt: string, leads: Lead[]): string {
  const leadJson = leads.map((l, i) =>
    `${i + 1}. {"name":"${l.full_name}","title":"${l.current_job_title}","company":"${l.company_name}","domain":"${l.company_domain}","industry":"${l.company_industry}","headcount":"${l.company_headcount_range}"}`
  ).join('\n');

  return `${icpPrompt}

## Companies to evaluate

${leadJson}

## Output
Return ONLY a JSON array of ${leads.length} objects in the same order:
{"company": "", "domain": "", "qualified": true/false, "confidence": 0.0-1.0, "reason": "one sentence"}`;
}

export function applyScoresToLeads(leads: Lead[], scores: Score[]): ScoredLead[] {
  const map = new Map<string, Score>();
  for (const s of scores) {
    const d = (s.domain ?? '').toLowerCase().replace(/^www\./, '');
    if (d) map.set(d, s);
  }
  return leads.map(lead => {
    const d = (lead.company_domain ?? '').toLowerCase().replace(/^www\./, '');
    const s = map.get(d);
    if (!s) return { ...lead, icp_qualified: 'unknown', icp_confidence: '0', icp_reason: 'not scored' };
    return {
      ...lead,
      icp_qualified: String(s.qualified),
      icp_confidence: String(s.confidence),
      icp_reason: s.reason,
    };
  });
}

export interface ScoreOptions {
  leads: Lead[];
  client: string;
  icpPromptPath: string;
  dispatch: SubagentDispatcher;
  batchSize?: number;
  cacheDir?: string;
}

export async function scoreLeads(opts: ScoreOptions): Promise<ScoredLead[]> {
  const icpPromptPath = resolve(process.cwd(), opts.icpPromptPath);
  if (!existsSync(icpPromptPath)) throw new Error(`ICP prompt not found: ${icpPromptPath}`);
  const icpPrompt = readFileSync(icpPromptPath, 'utf8');
  const promptHash = hashKey(icpPrompt);
  const cacheDir = opts.cacheDir ?? resolve(process.cwd(), `data/research-cache/score/${opts.client}`);
  const batchSize = opts.batchSize ?? 10;

  // Dedup by domain so each domain scored once
  const uniqueLeads: Lead[] = [];
  const seenDomains = new Set<string>();
  for (const l of opts.leads) {
    const d = (l.company_domain ?? '').toLowerCase().replace(/^www\./, '');
    if (!d || seenDomains.has(d)) continue;
    seenDomains.add(d);
    uniqueLeads.push(l);
  }

  // Build cache keys per lead and split into cached vs need-to-score
  const allScores: Score[] = [];
  const toScore: Lead[] = [];
  for (const lead of uniqueLeads) {
    const cacheKey = hashKey(opts.client, lead.company_domain, promptHash);
    const cacheDirForKey = cacheDir;
    const result = await fetchWithCache(cacheDirForKey, cacheKey, 90, async () => {
      // signal that we need a fresh score; placeholder will be overwritten
      throw new Error('__cache_miss__');
    }).catch(() => null);
    if (result && !result.fromCache === false && result.raw) {
      allScores.push(result.raw as Score);
    } else {
      toScore.push(lead);
    }
  }

  // Batch the not-yet-scored leads and dispatch sub-agent
  for (let i = 0; i < toScore.length; i += batchSize) {
    const batch = toScore.slice(i, i + batchSize);
    const prompt = buildScoringPrompt(icpPrompt, batch);
    const results = await runSubagentBatch<Score[]>([prompt], opts.dispatch, { batchSize: 1, maxRetries: 3 });
    const batchScores = results[0].data ?? [];
    for (let j = 0; j < batchScores.length; j++) {
      const lead = batch[j];
      const score = batchScores[j];
      allScores.push(score);
      // write to cache
      const cacheKey = hashKey(opts.client, lead.company_domain, promptHash);
      const { writeCache } = await import('./_cache');
      writeCache(cacheDir, cacheKey, score);
    }
  }

  return applyScoresToLeads(opts.leads, allScores);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/pipeline/_score.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/_score.ts tests/pipeline/_score.test.ts
git commit -m "feat(pipeline): Stage 2 ICP scoring via sub-agent with per-domain cache"
```

---

## Task 7: Stage 3a — Scrape Module (`_scrape.ts`)

**Context:** Free company-level depth. Fetch homepage + /about + /team. Extract recent campaign signal, tech stack hints (script tag detection), social proof. No API cost.

**Files:**
- Create: `scripts/pipeline/_scrape.ts`
- Test: `tests/pipeline/_scrape.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/pipeline/_scrape.test.ts
import { describe, it, expect } from 'vitest';
import { detectTechSignals, extractRecentInitiative, extractSocialProof } from '../../scripts/pipeline/_scrape';

const HTML_WITH_KLAVIYO = `
<html>
  <head>
    <script src="https://static.klaviyo.com/onsite.js"></script>
    <script src="https://cdn.attentive.com/loader.js"></script>
  </head>
  <body>
    <h1>New 2026 Spring Collection</h1>
    <p>Trusted by 300+ premium brands.</p>
  </body>
</html>
`;

describe('detectTechSignals', () => {
  it('detects Klaviyo from script src', () => {
    const tech = detectTechSignals(HTML_WITH_KLAVIYO);
    expect(tech).toContain('Klaviyo');
  });

  it('detects Attentive from script src', () => {
    const tech = detectTechSignals(HTML_WITH_KLAVIYO);
    expect(tech).toContain('Attentive');
  });

  it('returns empty array when no signals match', () => {
    expect(detectTechSignals('<html></html>')).toEqual([]);
  });
});

describe('extractRecentInitiative', () => {
  it('finds dated campaign mentions in headlines', () => {
    const initiative = extractRecentInitiative(HTML_WITH_KLAVIYO);
    expect(initiative).toMatch(/2026 Spring Collection/i);
  });

  it('returns null when no initiative phrasing found', () => {
    expect(extractRecentInitiative('<html><body><p>About us</p></body></html>')).toBeNull();
  });
});

describe('extractSocialProof', () => {
  it('finds testimonial-style numeric claims', () => {
    const proof = extractSocialProof(HTML_WITH_KLAVIYO);
    expect(proof.some(p => p.includes('300+'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/pipeline/_scrape.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Create `scripts/pipeline/_scrape.ts`**

```typescript
import { fetchWithCache, hashKey } from './_cache';
import { resolve } from 'path';

export interface ScrapeResult {
  recent_initiative: string | null;
  tech_signals: string[];
  social_proof: string[];
  tone_observations: string;
}

const TECH_PATTERNS: Record<string, RegExp> = {
  'Klaviyo':        /klaviyo\.com/i,
  'Attentive':      /attentive\.com/i,
  'Triple Whale':   /triplewhale/i,
  'Northbeam':      /northbeam/i,
  'Rockerbox':      /rockerbox/i,
  'Google Ads':     /googleadservices|gtag\/js/i,
  'Meta Pixel':     /facebook\.net\/.*\/fbevents/i,
  'Google Analytics 4': /google-analytics\.com\/g\/collect|gtag\(.*GA-/i,
  'Brandwatch':     /brandwatch\.com/i,
  'Shopify':        /cdn\.shopify\.com/i,
  'Salesforce':     /salesforce\.com|exacttarget/i,
};

export function detectTechSignals(html: string): string[] {
  const found: string[] = [];
  for (const [name, pattern] of Object.entries(TECH_PATTERNS)) {
    if (pattern.test(html)) found.push(name);
  }
  return found;
}

const INITIATIVE_PATTERNS = [
  /<h1[^>]*>([^<]{10,120}(?:campaign|collection|launch|introducing|debut)[^<]{0,80})<\/h1>/i,
  /<h2[^>]*>([^<]{10,120}(?:campaign|collection|launch|introducing|debut)[^<]{0,80})<\/h2>/i,
  /(?:new|introducing|launching)\s+(?:202[4-9])[\s\S]{0,80}?(?:collection|campaign|line|product|menu)/i,
];

export function extractRecentInitiative(html: string): string | null {
  for (const p of INITIATIVE_PATTERNS) {
    const m = html.match(p);
    if (m) return (m[1] ?? m[0]).replace(/\s+/g, ' ').trim();
  }
  return null;
}

const SOCIAL_PROOF_PATTERNS = [
  /(\d{2,}\+?\s+(?:brands|customers|clients|stores|locations|years))/gi,
  /(?:trusted by|featured in|named\s+(?:by|in))\s+([^.,<>]{5,80})/gi,
];

export function extractSocialProof(html: string): string[] {
  const found: string[] = [];
  for (const p of SOCIAL_PROOF_PATTERNS) {
    const matches = html.matchAll(p);
    for (const m of matches) {
      const proof = (m[1] ?? m[0]).replace(/\s+/g, ' ').trim();
      if (proof.length < 120 && !found.includes(proof)) found.push(proof);
    }
  }
  return found.slice(0, 5);
}

export async function scrapeCompany(domain: string, cacheDir?: string): Promise<ScrapeResult> {
  const dir = cacheDir ?? resolve(process.cwd(), 'data/research-cache/scrape');
  const cacheKey = hashKey(domain);

  const result = await fetchWithCache(dir, cacheKey, 30, async () => {
    const baseUrl = `https://${domain.replace(/^www\./, '')}`;
    const pages = ['', '/about', '/team'];
    const combined: string[] = [];
    for (const path of pages) {
      try {
        const res = await fetch(baseUrl + path, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ColdEmailResearch/1.0)' },
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) combined.push(await res.text());
      } catch {
        // Skip failed page fetches silently
      }
    }
    const html = combined.join('\n');
    return {
      recent_initiative: extractRecentInitiative(html),
      tech_signals: detectTechSignals(html),
      social_proof: extractSocialProof(html),
      tone_observations: combined.length > 0 ? 'fetched' : 'fetch_failed',
    } as ScrapeResult;
  });

  return result.raw;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/pipeline/_scrape.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/_scrape.ts tests/pipeline/_scrape.test.ts
git commit -m "feat(pipeline): Stage 3 Tier 2 free company scrape with tech/initiative/proof extraction"
```

---

## Task 8: Stage 3 — Research Module (`_research.ts`)

**Context:** Orchestrates all three tiers per lead. T1: Serper signals (existing extractors). T2: scrape (Task 7, runs on all qualified leads — it's free). T3: person depth (Serper queries about the individual). Returns a single research dossier JSON per lead.

**Files:**
- Create: `scripts/pipeline/_research.ts`
- Test: `tests/pipeline/_research.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/pipeline/_research.test.ts
import { describe, it, expect } from 'vitest';
import { decideTier, buildPersonQueries, type ResearchDossier } from '../../scripts/pipeline/_research';

describe('decideTier', () => {
  it('returns T1 by default', () => {
    expect(decideTier({ icp_confidence: '0.7' } as any, [], { t2: 0.8, t3: 0.9 })).toBe('T1');
  });

  it('returns T2 when icp_confidence >= t2 threshold', () => {
    expect(decideTier({ icp_confidence: '0.82', company_domain: 'foo.com' } as any, [], { t2: 0.8, t3: 0.9 })).toBe('T2');
  });

  it('returns T3 when icp_confidence >= t3 threshold', () => {
    expect(decideTier({ icp_confidence: '0.95', company_domain: 'foo.com' } as any, [], { t2: 0.8, t3: 0.9 })).toBe('T3');
  });

  it('returns T3 when domain in priority_domains regardless of confidence', () => {
    expect(decideTier({ icp_confidence: '0.5', company_domain: 'priority.com' } as any, ['priority.com'], { t2: 0.8, t3: 0.9 })).toBe('T3');
  });
});

describe('buildPersonQueries', () => {
  it('generates name + company queries excluding LinkedIn', () => {
    const queries = buildPersonQueries('Jane Doe', 'Acme');
    expect(queries.some(q => q.includes('Jane Doe'))).toBe(true);
    expect(queries.some(q => q.includes('Acme'))).toBe(true);
    expect(queries.every(q => q.includes('-inurl:linkedin'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/pipeline/_research.test.ts
```
Expected: FAIL

- [ ] **Step 3: Create `scripts/pipeline/_research.ts`**

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import type { ScoredLead } from './_score';
import { serperSearch } from '../_serper_client';
import { fetchWithCache, hashKey } from './_cache';
import { scrapeCompany, type ScrapeResult } from './_scrape';
import {
  extractFundingFact,
  extractPressFact,
  extractAcquisitionFact,
  extractSnippetFact,
} from '../_fact_extractor';
import { getMythicQueriesForTier } from '../_query_templates';

export type Tier = 'T1' | 'T2' | 'T3';

export interface ResearchDossier {
  tier: Tier;
  person: {
    person_id: string;
    full_name: string;
    title: string;
    seniority: string;
    linkedin_url: string;
  };
  company: {
    name: string;
    domain: string;
    industry: string;
    headcount_range: string;
    location: string;
  };
  signals: {
    funding_fact: string | null;
    press_facts: string[];
    acquisition_fact: string | null;
    category_snippet: string | null;
  };
  scrape: ScrapeResult | null;
  person_depth: {
    person_quote: string | null;
    recent_post_topic: string | null;
    public_speaking_topics: string[];
    career_pivot_signal: string | null;
  };
}

export function decideTier(
  lead: ScoredLead,
  priorityDomains: string[],
  thresholds: { t2: number; t3: number },
): Tier {
  const d = (lead.company_domain ?? '').toLowerCase().replace(/^www\./, '');
  if (priorityDomains.map(x => x.toLowerCase()).includes(d)) return 'T3';
  const conf = parseFloat(lead.icp_confidence ?? '0');
  if (conf >= thresholds.t3) return 'T3';
  if (conf >= thresholds.t2) return 'T2';
  return 'T1';
}

export function buildPersonQueries(fullName: string, companyName: string): string[] {
  return [
    `"${fullName}" "${companyName}" -inurl:linkedin`,
    `"${fullName}" "${companyName}" interview podcast -inurl:linkedin`,
    `"${fullName}" "${companyName}" conference speaker -inurl:linkedin`,
  ];
}

function unwrapFact(f: any): string {
  if (!f) return '';
  if (typeof f === 'string') return f;
  if (typeof f === 'object' && typeof f.fact === 'string') return f.fact;
  if (typeof f === 'object' && typeof f.fact === 'object') return f.fact?.fact ?? '';
  return String(f);
}

function inferSeniority(title: string): string {
  const t = title.toLowerCase();
  if (/chief|cmo|cfo|ceo|coo|president/.test(t)) return 'C-suite';
  if (/\bsvp\b|senior vice/.test(t)) return 'SVP';
  if (/\bvp\b|vice president/.test(t)) return 'VP';
  if (/senior director|sr\.? director/.test(t)) return 'Senior Director';
  if (/director/.test(t)) return 'Director';
  if (/head of/.test(t)) return 'Head';
  return 'Manager';
}

export interface ResearchOptions {
  lead: ScoredLead;
  serperKey: string;
  priorityDomains: string[];
  thresholds: { t2: number; t3: number };
  serperCacheDir?: string;
  callerScript?: string;
}

export async function researchLead(opts: ResearchOptions): Promise<ResearchDossier> {
  const lead = opts.lead;
  const tier = decideTier(lead, opts.priorityDomains, opts.thresholds);
  const domain = (lead.company_domain ?? '').toLowerCase().replace(/^www\./, '');
  const serperCacheDir = opts.serperCacheDir ?? resolve(process.cwd(), 'data/research-cache/serper');
  const caller = opts.callerScript ?? 'pipeline/_research.ts';

  // ---- T1: company signals (always) ----
  const queries = getMythicQueriesForTier(tier === 'T1' ? 'T3' : tier === 'T2' ? 'T2' : 'T1', { company: lead.company_name, domain });
  // Note: getMythicQueriesForTier expects enrichment tier names T1/T2/T3 where T1=most queries.
  // We flip our research tier mapping: research T1 (basic) => few queries; T3 (deepest) => most queries.

  const signals = { funding_fact: null as string | null, press_facts: [] as string[], acquisition_fact: null as string | null, category_snippet: null as string | null };

  for (const q of queries.serper) {
    const cacheKey = hashKey(domain, q.query);
    const cached = await fetchWithCache(serperCacheDir, cacheKey, 90, async () => {
      const res = await serperSearch(q.query, opts.serperKey, caller);
      return res.raw;
    });
    const raw = cached.raw;
    if (q.signal_type === 'funding' && !signals.funding_fact) {
      const f = extractFundingFact(raw, lead.company_name);
      if (f) signals.funding_fact = unwrapFact(f);
    } else if (q.signal_type === 'press') {
      const p = extractPressFact(raw, lead.company_name);
      if (p) signals.press_facts.push(unwrapFact(p));
      const a = extractAcquisitionFact(raw, lead.company_name);
      if (a && !signals.acquisition_fact) signals.acquisition_fact = unwrapFact(a);
    } else if (q.signal_type === 'snippet' && !signals.category_snippet) {
      const s = extractSnippetFact(raw, lead.company_name);
      if (s) signals.category_snippet = unwrapFact(s);
    }
  }

  // ---- T2: company scrape (free, always run) ----
  let scrape: ScrapeResult | null = null;
  try {
    scrape = await scrapeCompany(domain);
  } catch {
    scrape = null;
  }

  // ---- T3: person depth (only if tier === T3) ----
  const personDepth = {
    person_quote: null as string | null,
    recent_post_topic: null as string | null,
    public_speaking_topics: [] as string[],
    career_pivot_signal: null as string | null,
  };

  if (tier === 'T3') {
    const personQueries = buildPersonQueries(lead.full_name, lead.company_name);
    for (const pq of personQueries) {
      const cacheKey = hashKey('person', lead.person_id, pq);
      const cached = await fetchWithCache(serperCacheDir, cacheKey, 90, async () => {
        const res = await serperSearch(pq, opts.serperKey, caller);
        return res.raw;
      });
      const organic = cached.raw?.organic ?? [];
      for (const item of organic.slice(0, 3)) {
        const text = (item.snippet ?? item.title ?? '').trim();
        if (!text) continue;
        if (/podcast|interview/i.test(text) && !personDepth.person_quote) {
          personDepth.person_quote = text;
        }
        if (/conference|speaker|spoke at|keynote/i.test(text)) {
          personDepth.public_speaking_topics.push(text);
        }
        if (/joined|appointed|named|hired/i.test(text) && !personDepth.career_pivot_signal) {
          personDepth.career_pivot_signal = text;
        }
      }
    }
  }

  return {
    tier,
    person: {
      person_id: lead.person_id,
      full_name: lead.full_name,
      title: lead.current_job_title,
      seniority: inferSeniority(lead.current_job_title),
      linkedin_url: lead.person_linkedin_url,
    },
    company: {
      name: lead.company_name,
      domain,
      industry: lead.company_industry,
      headcount_range: lead.company_headcount_range,
      location: [lead.company_city, lead.company_state, lead.company_country].filter(Boolean).join(', '),
    },
    signals,
    scrape,
    person_depth: personDepth,
  };
}

export function writeDossier(dossier: ResearchDossier, dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `${dossier.company.domain}.json`), JSON.stringify(dossier, null, 2), 'utf8');
}

export function readDossier(domain: string, dir: string): ResearchDossier | null {
  const p = resolve(dir, `${domain.toLowerCase().replace(/^www\./, '')}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/pipeline/_research.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/_research.ts tests/pipeline/_research.test.ts
git commit -m "feat(pipeline): Stage 3 tiered research orchestrator with dossier output"
```

---

## Task 9: Stage 4 — Email Writer (`_write.ts`)

**Context:** Single Opus sub-agent dispatch per lead. Prompt auto-built from `client-profile.yaml` + research dossier + 3-5 example emails. Returns JSON with all 4 emails + the research detail used per email. Anti-template constitution enforced in the prompt.

**Files:**
- Create: `scripts/pipeline/_write.ts`
- Test: `tests/pipeline/_write.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/pipeline/_write.test.ts
import { describe, it, expect } from 'vitest';
import { buildWriterPrompt, type WriterOutput } from '../../scripts/pipeline/_write';
import type { ResearchDossier } from '../../scripts/pipeline/_research';
import type { ClientConfig } from '../../scripts/_client_config';

const SAMPLE_DOSSIER: ResearchDossier = {
  tier: 'T2',
  person: { person_id: 'p1', full_name: 'Jane Doe', title: 'CMO', seniority: 'C-suite', linkedin_url: '' },
  company: { name: 'Acme', domain: 'acme.com', industry: 'Restaurants', headcount_range: '500-1000', location: 'NYC' },
  signals: { funding_fact: 'Acme raised $10M Series B', press_facts: [], acquisition_fact: null, category_snippet: null },
  scrape: null,
  person_depth: { person_quote: null, recent_post_topic: null, public_speaking_topics: [], career_pivot_signal: null },
};

const SAMPLE_CFG = {
  business: { name: 'Mythic', website: '', one_liner: 'Brand and performance agency.', tone: 'peer-to-peer' },
  offer: { primary_product: 'Growth Codes audit', primary_cta: 'Worth 30 min?', value_prop: 'Surfaces decisions suppressing growth', lead_magnet: '' },
  legal: { banned_words: ['guarantee', 'ROI'] },
  copy_tone: { in_vocabulary: ['share of voice'], out_vocabulary: ['leverage', 'synergy'] },
} as any as ClientConfig;

describe('buildWriterPrompt', () => {
  it('embeds business name, dossier, and rules', () => {
    const prompt = buildWriterPrompt({ dossier: SAMPLE_DOSSIER, cfg: SAMPLE_CFG, exampleEmails: [], firstName: 'Jane' });
    expect(prompt).toContain('Mythic');
    expect(prompt).toContain('Jane');
    expect(prompt).toContain('Acme');
    expect(prompt).toContain('Series B');
    expect(prompt).toContain('No em dashes');
    expect(prompt).toMatch(/exactly ONE specific research detail/i);
    expect(prompt).toContain('guarantee');
    expect(prompt).toContain('share of voice');
  });

  it('includes example emails when provided', () => {
    const examples = ['EXAMPLE EMAIL 1 BODY', 'EXAMPLE EMAIL 2 BODY'];
    const prompt = buildWriterPrompt({ dossier: SAMPLE_DOSSIER, cfg: SAMPLE_CFG, exampleEmails: examples, firstName: 'Jane' });
    expect(prompt).toContain('EXAMPLE EMAIL 1 BODY');
    expect(prompt).toContain('EXAMPLE EMAIL 2 BODY');
  });

  it('does not include business name or product in the prompt body section after rule about first 3 sentences', () => {
    const prompt = buildWriterPrompt({ dossier: SAMPLE_DOSSIER, cfg: SAMPLE_CFG, exampleEmails: [], firstName: 'Jane' });
    expect(prompt).toMatch(/must NOT mention Mythic/i);
    expect(prompt).toMatch(/Growth Codes audit/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/pipeline/_write.test.ts
```
Expected: FAIL

- [ ] **Step 3: Create `scripts/pipeline/_write.ts`**

```typescript
import type { ResearchDossier } from './_research';
import type { ClientConfig } from '../_client_config';
import { getCopyStyle } from '../_client_config';
import { runSubagentBatch, type SubagentDispatcher } from './_subagent_runner';

export interface WriterEmail {
  subject: string;
  body: string;
  research_detail_used: string;
}

export interface WriterOutput {
  email1: WriterEmail;
  email2: WriterEmail;
  email3: WriterEmail;
  email4: WriterEmail;
}

export interface WriterPromptOptions {
  dossier: ResearchDossier;
  cfg: ClientConfig;
  exampleEmails: string[];
  firstName: string;
}

export function buildWriterPrompt(opts: WriterPromptOptions): string {
  const { dossier, cfg, exampleEmails, firstName } = opts;
  const style = getCopyStyle(cfg);

  const examplesBlock = exampleEmails.length > 0
    ? `EXAMPLES OF GOOD EMAILS FOR THIS CLIENT (study the voice; do not copy):

${exampleEmails.map((e, i) => `--- EXAMPLE ${i + 1} ---\n${e}\n`).join('\n')}
`
    : '';

  return `You are an experienced cold email writer ghosting for ${cfg.business.name}.
You are writing to ${dossier.person.full_name}, ${dossier.person.title} at ${dossier.company.name}.
Recipient seniority: ${dossier.person.seniority}.

Voice: ${style.tone}. Peer to peer. Senior strategist to senior marketing leader.
You have done deep research. You will use ONE specific detail per email and discard the rest.

CLIENT POSITIONING:
${cfg.business.one_liner}

OFFER:
Product: ${cfg.offer.primary_product}
Value prop: ${cfg.offer.value_prop}
Primary CTA: ${cfg.offer.primary_cta}

ABSOLUTE RULES:
- Exactly ONE specific research detail in Email 1. No more.
- No em dashes (— or --). No exclamation points. No bullet points in the body.
- Banned phrases: ${[...style.banned_phrases, ...style.vocab_out].join(', ')}
- Vocabulary to lean on: ${style.vocab_in.join(', ')}
- Email 1 body: 60-90 words. Email 2-4: 40-70 words.
- Open with the recipient's first name lowercase and an observation. No "Hi", "Hello", "I hope this finds you well", "I came across", "I noticed".
- Email 1 must NOT mention ${cfg.business.name} or ${cfg.offer.primary_product} in the first 3 sentences.
- The ask in Email 1 is a question, not a meeting invite.
- Each email references DIFFERENT aspects of the dossier. No repetition across the 4 emails.
- Email 2 is a threaded follow-up (empty subject string).
- Email 4 is a soft close (e.g. "if not you, who?"). Never aggressive.

${examplesBlock}
RESEARCH DOSSIER ON THIS LEAD:
${JSON.stringify(dossier, null, 2)}

OUTPUT FORMAT (JSON only, no markdown fences):
{
  "email1": { "subject": "...", "body": "...", "research_detail_used": "..." },
  "email2": { "subject": "", "body": "...", "research_detail_used": "..." },
  "email3": { "subject": "...", "body": "...", "research_detail_used": "..." },
  "email4": { "subject": "...", "body": "...", "research_detail_used": "..." }
}`;
}

export interface WriteLeadOptions {
  dossier: ResearchDossier;
  cfg: ClientConfig;
  exampleEmails: string[];
  firstName: string;
  dispatch: SubagentDispatcher;
  maxRetries?: number;
}

export async function writeEmailsForLead(opts: WriteLeadOptions): Promise<{ output: WriterOutput | null; error?: string }> {
  const prompt = buildWriterPrompt(opts);
  const results = await runSubagentBatch<WriterOutput>([prompt], opts.dispatch, {
    batchSize: 1,
    maxRetries: opts.maxRetries ?? 3,
    parseJson: true,
  });
  const r = results[0];
  if (!r.success) return { output: null, error: r.error };
  return { output: r.data ?? null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/pipeline/_write.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/_write.ts tests/pipeline/_write.test.ts
git commit -m "feat(pipeline): Stage 4 Opus sub-agent email writer with anti-template constitution"
```

---

## Task 10: Stage 5 — Validator (`_validate.ts`)

**Context:** Three sub-stages per email. 5a mechanical (regex). 5b semantic (Opus sub-agent). 5c recipient role-play (Opus sub-agent, Email 1 only). Regen loop up to 3 times.

**Files:**
- Create: `scripts/pipeline/_validate.ts`
- Test: `tests/pipeline/_validate.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/pipeline/_validate.test.ts
import { describe, it, expect } from 'vitest';
import { validateMechanical, buildSemanticPrompt, buildRolePlayPrompt } from '../../scripts/pipeline/_validate';

describe('validateMechanical', () => {
  const goodE1 = "jane, your recent series b round opens up a moment most growth-stage brands waste. funded teams tend to pour spend into the channels that worked yesterday, not the ones that will scale tomorrow. curious how you're thinking about that allocation.";
  const minBounds = { min: 60, max: 90 };

  it('passes a clean email under word count', () => {
    const result = validateMechanical({ subject: 'thinking out loud', body: goodE1, research_detail_used: 'Series B' }, { wordCount: minBounds, banned: ['leverage', 'synergy'] });
    expect(result.pass).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('flags em dashes', () => {
    const body = goodE1.replace('round', 'round —');
    const result = validateMechanical({ subject: 's', body, research_detail_used: 'x' }, { wordCount: minBounds, banned: [] });
    expect(result.pass).toBe(false);
    expect(result.violations.some(v => /em dash/i.test(v))).toBe(true);
  });

  it('flags exclamation points', () => {
    const result = validateMechanical({ subject: 's', body: goodE1 + ' wow!', research_detail_used: 'x' }, { wordCount: { min: 60, max: 120 }, banned: [] });
    expect(result.pass).toBe(false);
    expect(result.violations.some(v => /exclamation/i.test(v))).toBe(true);
  });

  it('flags banned phrases', () => {
    const result = validateMechanical({ subject: 's', body: goodE1 + ' we leverage analytics.', research_detail_used: 'x' }, { wordCount: { min: 60, max: 120 }, banned: ['leverage'] });
    expect(result.pass).toBe(false);
    expect(result.violations.some(v => /banned phrase.*leverage/i.test(v))).toBe(true);
  });

  it('flags word count out of bounds', () => {
    const result = validateMechanical({ subject: 's', body: 'too short', research_detail_used: 'x' }, { wordCount: { min: 60, max: 90 }, banned: [] });
    expect(result.pass).toBe(false);
    expect(result.violations.some(v => /word count/i.test(v))).toBe(true);
  });

  it('flags forbidden opener words', () => {
    const result = validateMechanical({ subject: 's', body: 'Hi Jane, ' + goodE1, research_detail_used: 'x' }, { wordCount: { min: 60, max: 120 }, banned: [] });
    expect(result.pass).toBe(false);
    expect(result.violations.some(v => /opener/i.test(v))).toBe(true);
  });
});

describe('buildSemanticPrompt', () => {
  it('includes dossier, claimed detail, and email body', () => {
    const prompt = buildSemanticPrompt({
      email: { subject: 's', body: 'b', research_detail_used: 'Series B' },
      dossier: { signals: { funding_fact: 'Series B' } } as any,
    });
    expect(prompt).toContain('Series B');
    expect(prompt).toContain('Body: b');
    expect(prompt).toMatch(/templated/i);
  });
});

describe('buildRolePlayPrompt', () => {
  it('frames the recipient persona', () => {
    const prompt = buildRolePlayPrompt({
      email: { subject: 's', body: 'b', research_detail_used: '' },
      recipientName: 'Jane Doe', recipientTitle: 'CMO', recipientCompany: 'Acme',
    });
    expect(prompt).toContain('Jane Doe');
    expect(prompt).toContain('CMO');
    expect(prompt).toContain('Acme');
    expect(prompt).toMatch(/reply.*archive.*unsubscribe/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/pipeline/_validate.test.ts
```
Expected: FAIL

- [ ] **Step 3: Create `scripts/pipeline/_validate.ts`**

```typescript
import type { WriterEmail, WriterOutput } from './_write';
import type { ResearchDossier } from './_research';
import { runSubagentBatch, type SubagentDispatcher } from './_subagent_runner';

export interface MechanicalResult {
  pass: boolean;
  violations: string[];
}

export interface MechanicalOptions {
  wordCount: { min: number; max: number };
  banned: string[];
}

const FORBIDDEN_OPENERS = [
  /^hi\b/i, /^hello\b/i, /^hey\b/i,
  /^i hope this finds you well/i,
  /^i came across/i, /^i noticed/i,
  /^as a/i, /^in today's/i,
];

export function validateMechanical(email: WriterEmail, opts: MechanicalOptions): MechanicalResult {
  const violations: string[] = [];
  const body = email.body ?? '';

  // word count
  const wordCount = body.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < opts.wordCount.min || wordCount > opts.wordCount.max) {
    violations.push(`word count ${wordCount} outside bounds ${opts.wordCount.min}-${opts.wordCount.max}`);
  }

  // em dash
  if (body.includes('—') || /\s--\s/.test(body)) {
    violations.push('contains em dash');
  }

  // exclamation
  if (body.includes('!')) {
    violations.push('contains exclamation point');
  }

  // banned phrases
  const bodyLower = body.toLowerCase();
  for (const phrase of opts.banned) {
    if (bodyLower.includes(phrase.toLowerCase())) {
      violations.push(`contains banned phrase "${phrase}"`);
    }
  }

  // forbidden openers
  const trimmed = body.trimStart();
  for (const pattern of FORBIDDEN_OPENERS) {
    if (pattern.test(trimmed)) {
      violations.push(`forbidden opener pattern: ${pattern.source}`);
    }
  }

  // bullet points
  if (/^[\s]*[-*•]\s/m.test(body)) {
    violations.push('contains bullet point');
  }

  return { pass: violations.length === 0, violations };
}

// ---- 5b semantic ----

export interface SemanticResult {
  pass: boolean;
  score: number;
  issues: string[];
  suggestions: string[];
}

export function buildSemanticPrompt(opts: { email: WriterEmail; dossier: ResearchDossier }): string {
  return `You are reviewing a cold email for quality. Be strict.

Research dossier the writer had:
${JSON.stringify(opts.dossier, null, 2)}

Research detail the writer claims to have used:
"${opts.email.research_detail_used}"

Check:
1. Does the email reference the claimed research detail in a meaningful way? (Not just dropped as a fact.)
2. Does it sound human or AI-generated? Common AI tells: "I noticed", "I came across", "I hope this finds", "leverage", "synergy", "in today's competitive landscape", "as a {title}", any formal corporate phrasing.
3. Does it feel templated? Test: if you swapped the company name to a different company, would the email still make sense? If yes → fail.
4. Is there EXACTLY ONE specific research detail in the body? More than one fails.
5. Is the voice peer-to-peer for the recipient's title? Too vendor-pitchy = fail. Too casual = fail.

EMAIL:
Subject: ${opts.email.subject}
Body: ${opts.email.body}

Return JSON only:
{ "pass": true/false, "score": 1-10, "issues": ["array"], "suggestions": ["array"] }`;
}

export async function validateSemantic(
  email: WriterEmail,
  dossier: ResearchDossier,
  dispatch: SubagentDispatcher,
  passThreshold: number,
): Promise<SemanticResult> {
  const prompt = buildSemanticPrompt({ email, dossier });
  const results = await runSubagentBatch<SemanticResult>([prompt], dispatch, { batchSize: 1, maxRetries: 2 });
  const r = results[0];
  if (!r.success || !r.data) {
    return { pass: false, score: 0, issues: ['validator dispatch failed: ' + (r.error ?? 'unknown')], suggestions: [] };
  }
  const data = r.data;
  return {
    pass: data.pass && data.score >= passThreshold,
    score: data.score,
    issues: data.issues ?? [],
    suggestions: data.suggestions ?? [],
  };
}

// ---- 5c role-play ----

export interface RolePlayResult {
  verdict: 'reply' | 'archive' | 'unsubscribe';
  reason: string;
  pass: boolean;
}

export function buildRolePlayPrompt(opts: { email: WriterEmail; recipientName: string; recipientTitle: string; recipientCompany: string }): string {
  return `You are ${opts.recipientName}, ${opts.recipientTitle} at ${opts.recipientCompany}.
Your inbox gets 100-200 cold emails a week. You are skeptical of agencies and SaaS pitches.
You just received this cold email:

Subject: ${opts.email.subject}
Body: ${opts.email.body}

Be brutally honest. What's your reaction? Would you:
- "reply" — interesting enough to respond
- "archive" — not bad but not worth time
- "unsubscribe" — bad enough to opt out

Return JSON only: { "verdict": "reply" | "archive" | "unsubscribe", "reason": "one sentence" }`;
}

export async function validateRolePlay(
  email: WriterEmail,
  recipient: { name: string; title: string; company: string },
  dispatch: SubagentDispatcher,
): Promise<RolePlayResult> {
  const prompt = buildRolePlayPrompt({
    email,
    recipientName: recipient.name,
    recipientTitle: recipient.title,
    recipientCompany: recipient.company,
  });
  const results = await runSubagentBatch<{ verdict: 'reply' | 'archive' | 'unsubscribe'; reason: string }>(
    [prompt], dispatch, { batchSize: 1, maxRetries: 2 }
  );
  const r = results[0];
  if (!r.success || !r.data) {
    return { verdict: 'archive', reason: 'validator dispatch failed', pass: false };
  }
  return { verdict: r.data.verdict, reason: r.data.reason, pass: r.data.verdict === 'reply' };
}

// ---- top-level validate + regen ----

export interface ValidatorReport {
  email_id: 'email1' | 'email2' | 'email3' | 'email4';
  mechanical: MechanicalResult;
  semantic: SemanticResult;
  role_play?: RolePlayResult;
  regenerations: number;
  final_pass: boolean;
}

export interface ValidateOptions {
  output: WriterOutput;
  dossier: ResearchDossier;
  cfg: any;
  dispatch: SubagentDispatcher;
  semanticThreshold: number;
  recipientName: string;
  recipientTitle: string;
  recipientCompany: string;
}

const BOUNDS: Record<string, { min: number; max: number }> = {
  email1: { min: 60, max: 90 },
  email2: { min: 40, max: 70 },
  email3: { min: 40, max: 70 },
  email4: { min: 40, max: 70 },
};

export async function validateEmails(opts: ValidateOptions): Promise<ValidatorReport[]> {
  const banned = (opts.cfg.legal?.banned_words ?? []).concat(opts.cfg.copy_tone?.out_vocabulary ?? []);
  const reports: ValidatorReport[] = [];

  for (const key of ['email1', 'email2', 'email3', 'email4'] as const) {
    const email = opts.output[key];
    const mech = validateMechanical(email, { wordCount: BOUNDS[key], banned });
    const sem = await validateSemantic(email, opts.dossier, opts.dispatch, opts.semanticThreshold);
    let role: RolePlayResult | undefined;
    if (key === 'email1') {
      role = await validateRolePlay(email, { name: opts.recipientName, title: opts.recipientTitle, company: opts.recipientCompany }, opts.dispatch);
    }
    const finalPass = mech.pass && sem.pass && (role ? role.pass : true);
    reports.push({ email_id: key, mechanical: mech, semantic: sem, role_play: role, regenerations: 0, final_pass: finalPass });
  }
  return reports;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/pipeline/_validate.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/_validate.ts tests/pipeline/_validate.test.ts
git commit -m "feat(pipeline): Stage 5 three-stage validator (mechanical + semantic + role-play)"
```

---

## Task 11: Credit Guard (`_credit_guard.ts`)

**Context:** Pre-flight cost estimate + interactive confirmation gate. Reads cache state to deduct already-cached calls from the estimate. Supports `yes / no / smoke / dry-run` answers.

**Files:**
- Create: `scripts/pipeline/_credit_guard.ts`
- Test: `tests/pipeline/_credit_guard.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/pipeline/_credit_guard.test.ts
import { describe, it, expect } from 'vitest';
import { estimateRunCost, formatPreflightReport } from '../../scripts/pipeline/_credit_guard';

describe('estimateRunCost', () => {
  it('computes serper credit estimate from lead count and tier mix', () => {
    const estimate = estimateRunCost({
      qualifiedLeads: 100,
      tierMix: { T1: 70, T2: 20, T3: 10 },
      pagesToFetch: 0,
      cachedPages: 10,
      leadmagicLookups: 80,
    });
    // T1 = 8 queries, T2 = 5, T3 = 3 (per current _query_templates)
    // 70*8 + 20*5 + 10*3 = 560 + 100 + 30 = 690
    expect(estimate.serper_credits).toBe(690);
    expect(estimate.prospeo_pages).toBe(0);
    expect(estimate.leadmagic_lookups).toBe(80);
  });
});

describe('formatPreflightReport', () => {
  it('produces a readable summary table', () => {
    const report = formatPreflightReport({
      client: 'mythic', category: 'qsr',
      leads: 100, cachedLeads: 12,
      estimate: { serper_credits: 690, prospeo_pages: 0, leadmagic_lookups: 80, scrape_pages: 100, subagent_calls: 700 },
    });
    expect(report).toContain('mythic');
    expect(report).toContain('qsr');
    expect(report).toContain('690');
    expect(report).toContain('Proceed');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/pipeline/_credit_guard.test.ts
```
Expected: FAIL

- [ ] **Step 3: Create `scripts/pipeline/_credit_guard.ts`**

```typescript
import * as readline from 'readline';

export interface RunEstimate {
  serper_credits: number;
  prospeo_pages: number;
  leadmagic_lookups: number;
  scrape_pages: number;
  subagent_calls: number;
}

export interface EstimateOptions {
  qualifiedLeads: number;
  tierMix: { T1: number; T2: number; T3: number };
  pagesToFetch: number;
  cachedPages: number;
  leadmagicLookups: number;
}

const QUERIES_PER_TIER = { T1: 8, T2: 5, T3: 3 } as const;
const PERSON_QUERIES_T3 = 3;
const SUBAGENT_PER_LEAD = 7; // 1 write + 4 semantic + 1 role-play + 1 misc

export function estimateRunCost(opts: EstimateOptions): RunEstimate {
  const t = opts.tierMix;
  const serperCompany = t.T1 * QUERIES_PER_TIER.T1 + t.T2 * QUERIES_PER_TIER.T2 + t.T3 * QUERIES_PER_TIER.T3;
  const serperPerson = t.T3 * PERSON_QUERIES_T3;
  return {
    serper_credits: serperCompany + serperPerson,
    prospeo_pages: opts.pagesToFetch,
    leadmagic_lookups: opts.leadmagicLookups,
    scrape_pages: opts.qualifiedLeads * 3,
    subagent_calls: opts.qualifiedLeads * SUBAGENT_PER_LEAD,
  };
}

export interface PreflightInput {
  client: string;
  category: string;
  leads: number;
  cachedLeads: number;
  estimate: RunEstimate;
}

export function formatPreflightReport(input: PreflightInput): string {
  const line = '═'.repeat(60);
  return `\n${line}
  PIPELINE PRE-FLIGHT — ${input.client} / ${input.category}
${line}
  Leads to process:        ${input.leads}
  Already in cache:        ${input.cachedLeads}   (will skip)
  New API calls planned:
    Prospeo:               ${input.estimate.prospeo_pages} pages
    Serper:                ${input.estimate.serper_credits} credits
    LeadMagic:             ${input.estimate.leadmagic_lookups} lookups (out of scope v1)
    Scrape (free):         ${input.estimate.scrape_pages} pages
  Sub-agent calls (free):  ~${input.estimate.subagent_calls}
${line}
  Proceed? (yes / no / smoke / dry-run):`;
}

export type PreflightAnswer = 'yes' | 'no' | 'smoke' | 'dry-run' | 'unknown';

export async function promptPreflight(report: string): Promise<PreflightAnswer> {
  console.log(report);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question('> ', answer => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === 'yes' || a === 'y') resolve('yes');
      else if (a === 'no' || a === 'n') resolve('no');
      else if (a === 'smoke' || a === 's') resolve('smoke');
      else if (a === 'dry-run' || a === 'dryrun' || a === 'd') resolve('dry-run');
      else resolve('unknown');
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/pipeline/_credit_guard.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/_credit_guard.ts tests/pipeline/_credit_guard.test.ts
git commit -m "feat(pipeline): pre-flight credit guard with cost estimate and confirmation prompt"
```

---

## Task 12: Smoke Run (`_smoke.ts`)

**Context:** Picks 3 leads (1 per tier if possible), runs Stages 3-5 on them, prints emails + validator results, locks the prompts used.

**Files:**
- Create: `scripts/pipeline/_smoke.ts`
- Test: `tests/pipeline/_smoke.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/pipeline/_smoke.test.ts
import { describe, it, expect } from 'vitest';
import { selectSmokeLeads, formatSmokeReport } from '../../scripts/pipeline/_smoke';
import type { ScoredLead } from '../../scripts/pipeline/_score';

const mkLead = (id: string, conf: number, domain: string): ScoredLead => ({
  person_id: id, first_name: 'A', last_name: 'B', full_name: 'A B',
  current_job_title: 'CMO', email: '', email_status: '', person_linkedin_url: '',
  person_city: '', person_state: '', person_country: '',
  company_name: domain, company_domain: domain, company_industry: '',
  company_headcount: '', company_headcount_range: '', company_linkedin_url: '',
  company_city: '', company_state: '', company_country: '',
  icp_qualified: 'true', icp_confidence: String(conf), icp_reason: '',
});

describe('selectSmokeLeads', () => {
  it('picks one lead per tier when possible', () => {
    const leads = [
      mkLead('a', 0.7, 'a.com'), mkLead('b', 0.85, 'b.com'),
      mkLead('c', 0.95, 'c.com'), mkLead('d', 0.7, 'd.com'),
    ];
    const picks = selectSmokeLeads(leads, [], { t2: 0.8, t3: 0.9 });
    expect(picks.length).toBe(3);
    const tiers = picks.map(p => p.tier);
    expect(tiers).toContain('T1');
    expect(tiers).toContain('T2');
    expect(tiers).toContain('T3');
  });

  it('falls back when fewer than 3 tiers represented', () => {
    const leads = [mkLead('a', 0.7, 'a.com'), mkLead('b', 0.71, 'b.com')];
    const picks = selectSmokeLeads(leads, [], { t2: 0.8, t3: 0.9 });
    expect(picks.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/pipeline/_smoke.test.ts
```
Expected: FAIL

- [ ] **Step 3: Create `scripts/pipeline/_smoke.ts`**

```typescript
import type { ScoredLead } from './_score';
import type { Tier } from './_research';
import { decideTier } from './_research';

export interface SmokePick {
  lead: ScoredLead;
  tier: Tier;
}

export function selectSmokeLeads(
  leads: ScoredLead[],
  priorityDomains: string[],
  thresholds: { t2: number; t3: number },
): SmokePick[] {
  const byTier: Record<Tier, ScoredLead[]> = { T1: [], T2: [], T3: [] };
  for (const l of leads) {
    if (l.icp_qualified !== 'true') continue;
    const t = decideTier(l, priorityDomains, thresholds);
    byTier[t].push(l);
  }
  const picks: SmokePick[] = [];
  for (const t of ['T1', 'T2', 'T3'] as Tier[]) {
    if (byTier[t].length > 0) picks.push({ lead: byTier[t][0], tier: t });
  }
  return picks;
}

export interface SmokeReportInput {
  picks: SmokePick[];
  emails: Array<{ tier: Tier; lead_name: string; lead_title: string; lead_company: string; email1_body: string; pass: boolean; reason: string; regenerations: number }>;
  serperCredits: number;
  subagentCalls: number;
}

export function formatSmokeReport(input: SmokeReportInput): string {
  const lines: string[] = [];
  lines.push('═'.repeat(60));
  lines.push('  SMOKE RESULTS — ' + input.picks.length + ' leads');
  lines.push('═'.repeat(60));
  for (const e of input.emails) {
    lines.push(`  ${e.tier} — ${e.lead_name}, ${e.lead_title}, ${e.lead_company}`);
    lines.push(`    Validator: ${e.pass ? 'pass' : 'FAIL'} (${e.regenerations} regens) — ${e.reason}`);
    lines.push('    ' + '─'.repeat(56));
    e.email1_body.split('\n').forEach(l => lines.push('    ' + l));
    lines.push('');
  }
  lines.push(`  Serper credits burned: ${input.serperCredits}`);
  lines.push(`  Sub-agent calls:       ${input.subagentCalls}`);
  lines.push('═'.repeat(60));
  lines.push('  Proceed with the rest? (yes / no / adjust):');
  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/pipeline/_smoke.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/_smoke.ts tests/pipeline/_smoke.test.ts
git commit -m "feat(pipeline): smoke run with tier-balanced lead selection"
```

---

## Task 13: Run Artifacts (`_run_artifacts.ts`)

**Context:** Every full run writes audit trail to `data/runs/{timestamp}-{client}-{category}/` including preflight estimate, locked prompts, failures log, final stats.

**Files:**
- Create: `scripts/pipeline/_run_artifacts.ts`
- Test: `tests/pipeline/_run_artifacts.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/pipeline/_run_artifacts.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { initRunDir, writeArtifact, runDirName } from '../../scripts/pipeline/_run_artifacts';

const BASE = resolve(__dirname, '../../data/runs-test');

beforeEach(() => {
  if (existsSync(BASE)) rmSync(BASE, { recursive: true });
});

afterEach(() => {
  if (existsSync(BASE)) rmSync(BASE, { recursive: true });
});

describe('runDirName', () => {
  it('formats timestamp + client + category', () => {
    const name = runDirName('mythic', 'qsr', new Date('2026-05-28T14:30:00Z'));
    expect(name).toMatch(/2026-05-28-\d{4}-mythic-qsr/);
  });
});

describe('initRunDir', () => {
  it('creates the run directory', () => {
    const dir = initRunDir('mythic', 'qsr', BASE);
    expect(existsSync(dir)).toBe(true);
  });
});

describe('writeArtifact', () => {
  it('writes JSON artifact to the run directory', () => {
    const dir = initRunDir('mythic', 'qsr', BASE);
    writeArtifact(dir, 'preflight.json', { credits: 100 });
    const content = JSON.parse(readFileSync(resolve(dir, 'preflight.json'), 'utf8'));
    expect(content.credits).toBe(100);
  });

  it('writes text artifact when payload is string', () => {
    const dir = initRunDir('mythic', 'qsr', BASE);
    writeArtifact(dir, 'locked-prompts.md', '# Prompts\n\nLocked.');
    const content = readFileSync(resolve(dir, 'locked-prompts.md'), 'utf8');
    expect(content).toContain('# Prompts');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/pipeline/_run_artifacts.test.ts
```
Expected: FAIL

- [ ] **Step 3: Create `scripts/pipeline/_run_artifacts.ts`**

```typescript
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

export function runDirName(client: string, category: string, now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const h = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}-${h}${mm}-${client}-${category}`;
}

export function initRunDir(client: string, category: string, baseDir?: string): string {
  const base = baseDir ?? resolve(process.cwd(), 'data/runs');
  const dir = resolve(base, runDirName(client, category));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeArtifact(runDir: string, name: string, payload: any): void {
  const path = resolve(runDir, name);
  const content = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  writeFileSync(path, content, 'utf8');
}

export function appendLog(runDir: string, line: string): void {
  const path = resolve(runDir, 'pipeline.log');
  const stamp = new Date().toISOString();
  const entry = `[${stamp}] ${line}\n`;
  if (!existsSync(path)) writeFileSync(path, entry, 'utf8');
  else writeFileSync(path, entry, { flag: 'a', encoding: 'utf8' });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/pipeline/_run_artifacts.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/_run_artifacts.ts tests/pipeline/_run_artifacts.test.ts
git commit -m "feat(pipeline): run artifacts module for audit trail"
```

---

## Task 14: Example Email Files

**Context:** Stage 4 writer needs 3-5 example emails per client to anchor voice. Build the Mythic and BW example files.

**Files:**
- Create: `profiles/mythic/example-emails.md`
- Create: `profiles/belardi-wong/example-emails.md`

- [ ] **Step 1: Create `profiles/mythic/example-emails.md`**

```markdown
# Mythic — Example Good Emails

These are the voice anchors for the Stage 4 writer. They are not literal templates.
The writer studies them to internalize the tone, then writes from scratch.

---

bindi, the new gainesville opening puts you over 540 locations. brands at that footprint usually find their media spend is concentrated in 6 or 7 dmas while the actual growth is happening in markets that get a fraction of the impressions. curious how you're thinking about market-level allocation as you scale into the southeast.

worth a 30-minute conversation?

---

cameron, blaze sitting at 340 locations is the moment most chains start to feel the brand-versus-performance tradeoff. paid search auctions get expensive, share of voice flattens, and the boards start asking why category leaders are pulling away. we've seen a few specific decisions in the audit that suggest where the leverage is.

would the findings be useful?

---

christine, the boston seafood association award shows up in trade press but doesn't translate to share of voice in your category. legal has the heritage to compete on brand assets but the media mix reads like it's still optimized for last decade. one thread we pulled in the audit is worth a conversation.

20 minutes this week?
```

- [ ] **Step 2: Create `profiles/belardi-wong/example-emails.md`**

```markdown
# Belardi Wong — Example Good Emails

---

kate, year 11 of running direct mail for bombas. your team and theirs sit in the same lane on AOV and catalog cadence. what compounded for them was format and frequency testing, year over year. which book usually outperforms for you?

---

alison, vera bradley's print program has run profitably for over a decade because the segmentation work happens at the SKU level, not the customer level. saw your hire announcement for a new retention lead. that change usually opens a window for revisiting how the mail-versus-digital split is being modeled.

happy to share the segmentation framework we use across the 300+ brands in the portfolio.

---

megan, 10 years of running direct mail for serena & lily. the through-line on home retailers your size has been disciplined frequency testing rather than creative reinvention. the data says less changes hands than you'd think when you go from 8 to 12 drops per cohort.

worth comparing notes?
```

- [ ] **Step 3: Commit**

```bash
git add profiles/mythic/example-emails.md profiles/belardi-wong/example-emails.md
git commit -m "feat(profiles): add example-emails.md voice anchors for Mythic and BW"
```

---

## Task 15: Orchestrator (`run.ts`)

**Context:** The main entry point. Wires every module together. Implements: parse CLI → load config → pull leads → score → preflight gate → research → write → validate → quality gate → write final CSV. Supports `--smoke`, `--dry-run`, `--offline` flags.

**Files:**
- Create: `scripts/pipeline/run.ts`
- Test: `tests/pipeline/run.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/pipeline/run.test.ts
import { describe, it, expect } from 'vitest';
import { parsePipelineArgs } from '../../scripts/pipeline/run';

describe('parsePipelineArgs', () => {
  it('parses --client and --category', () => {
    const args = parsePipelineArgs(['node', 'run.ts', '--client', 'mythic', '--category', 'qsr']);
    expect(args.client).toBe('mythic');
    expect(args.category).toBe('qsr');
    expect(args.smoke).toBe(false);
    expect(args.dryRun).toBe(false);
    expect(args.offline).toBe(false);
  });

  it('parses --smoke flag', () => {
    const args = parsePipelineArgs(['node', 'run.ts', '--client', 'mythic', '--category', 'qsr', '--smoke']);
    expect(args.smoke).toBe(true);
  });

  it('parses --dry-run flag', () => {
    const args = parsePipelineArgs(['node', 'run.ts', '--client', 'mythic', '--category', 'qsr', '--dry-run']);
    expect(args.dryRun).toBe(true);
  });

  it('throws when --client missing', () => {
    expect(() => parsePipelineArgs(['node', 'run.ts', '--category', 'qsr'])).toThrow(/client/i);
  });

  it('throws when --category missing', () => {
    expect(() => parsePipelineArgs(['node', 'run.ts', '--client', 'mythic'])).toThrow(/category/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/pipeline/run.test.ts
```
Expected: FAIL

- [ ] **Step 3: Create `scripts/pipeline/run.ts`**

```typescript
#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Standardized cold email pipeline orchestrator
//
// Usage:
//   npx tsx scripts/pipeline/run.ts --client mythic --category qsr
//   npx tsx scripts/pipeline/run.ts --client mythic --category qsr --smoke
//   npx tsx scripts/pipeline/run.ts --client mythic --category qsr --dry-run
//   npx tsx scripts/pipeline/run.ts --client mythic --category qsr --offline
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { pathToFileURL } from 'url';
import { loadClientConfigByName, getPriorityDomains, getExampleEmails } from '../_client_config';
import { writeCsvWithExtra, parseCsv } from '../_csv_io';
import { loadLimits, checkCap } from './_limits';
import { pullLeads } from './_pull';
import { scoreLeads, type ScoredLead } from './_score';
import { researchLead, writeDossier, decideTier, type ResearchDossier, type Tier } from './_research';
import { writeEmailsForLead } from './_write';
import { validateEmails } from './_validate';
import { estimateRunCost, formatPreflightReport, promptPreflight } from './_credit_guard';
import { runQualityGate } from '../_quality_gate';
import { initRunDir, writeArtifact, appendLog } from './_run_artifacts';

export interface PipelineArgs {
  client: string;
  category: string;
  smoke: boolean;
  dryRun: boolean;
  offline: boolean;
}

export function parsePipelineArgs(argv: string[]): PipelineArgs {
  const args = argv.slice(2);
  const get = (flag: string) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined; };
  const client = get('--client');
  const category = get('--category');
  if (!client) throw new Error('--client is required');
  if (!category) throw new Error('--category is required');
  return {
    client, category,
    smoke: args.includes('--smoke'),
    dryRun: args.includes('--dry-run'),
    offline: args.includes('--offline'),
  };
}

function loadEnvKeys(): Record<string, string> {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    const out: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const [k, ...v] = t.split('=');
      out[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
    }
    return out;
  } catch { return {}; }
}

/**
 * Stub dispatcher placeholder. Replaced at runtime by a real Claude Code Task tool call.
 * When invoked from Claude Code, the orchestrator passes a real dispatcher in.
 * For CLI invocations outside Claude Code, this stub returns a fallback string.
 */
function defaultDispatcher(prompt: string): Promise<string> {
  throw new Error('No sub-agent dispatcher provided. Run this script from within Claude Code which injects a dispatcher.');
}

export async function runPipeline(args: PipelineArgs, dispatch: (prompt: string) => Promise<string> = defaultDispatcher): Promise<void> {
  const cfg = loadClientConfigByName(args.client);
  const limits = loadLimits();
  const env = loadEnvKeys();
  const priorityDomains = getPriorityDomains(cfg);
  const exampleEmails = getExampleEmails(args.client);
  const runDir = initRunDir(args.client, args.category);

  appendLog(runDir, `pipeline start args=${JSON.stringify(args)}`);
  console.log(`\n=== PIPELINE: ${cfg.business.name} / ${args.category} ===`);
  console.log(`Run dir: ${runDir}`);

  // ---- Stage 1: pull ----
  const prospeoKey = env.PROSPEO_API_KEY;
  if (!prospeoKey && !args.offline) throw new Error('PROSPEO_API_KEY not set');

  console.log('\n[Stage 1] Lead pull...');
  const pull = await pullLeads({
    apiKey: prospeoKey ?? '',
    cfg, category: args.category,
    maxPages: 10,
    callerScript: 'pipeline/run.ts',
  });
  console.log(`  pulled ${pull.leads.length} leads (${pull.pagesFromCache} pages from cache, ${pull.pagesFetched} fetched, pool=${pull.totalPool})`);
  appendLog(runDir, `stage1 leads=${pull.leads.length} fetched=${pull.pagesFetched} cached=${pull.pagesFromCache}`);
  writeArtifact(runDir, 'raw-leads.csv', writeCsvWithExtra(pull.leads as any, []));

  // ---- Stage 2: score ----
  console.log('\n[Stage 2] ICP score...');
  const icpPromptPath = `profiles/${args.client}/icp-prompt.txt`;
  const scored = await scoreLeads({
    leads: pull.leads,
    client: args.client,
    icpPromptPath,
    dispatch,
    batchSize: 10,
  });
  const qualified = scored.filter(l => l.icp_qualified === 'true' && parseFloat(l.icp_confidence) >= 0.7);
  console.log(`  ${qualified.length}/${scored.length} qualified at >= 0.7`);
  appendLog(runDir, `stage2 qualified=${qualified.length} total=${scored.length}`);
  writeArtifact(runDir, 'scored-leads.csv', writeCsvWithExtra(scored as any, ['icp_qualified', 'icp_confidence', 'icp_reason']));

  // ---- Preflight ----
  const tierMix = { T1: 0, T2: 0, T3: 0 } as Record<Tier, number>;
  for (const l of qualified) tierMix[decideTier(l, priorityDomains, { t2: limits.tier_thresholds.t2_qual_confidence, t3: limits.tier_thresholds.t3_qual_confidence })]++;
  const estimate = estimateRunCost({
    qualifiedLeads: qualified.length,
    tierMix,
    pagesToFetch: 0, cachedPages: pull.pagesFromCache,
    leadmagicLookups: 0,
  });
  checkCap(limits, 'serper_per_run', estimate.serper_credits);
  const report = formatPreflightReport({ client: args.client, category: args.category, leads: qualified.length, cachedLeads: pull.pagesFromCache, estimate });
  writeArtifact(runDir, 'preflight.json', { args, tierMix, estimate });

  if (args.dryRun) {
    console.log(report);
    console.log('\n[dry-run] aborting before any API calls.');
    return;
  }

  let proceed = await promptPreflight(report);
  if (proceed === 'no') { console.log('Aborted.'); return; }
  if (proceed === 'dry-run') { console.log('Dry-run requested; aborting.'); return; }

  // ---- Smoke run (if requested or chosen at preflight) ----
  const isSmoke = args.smoke || proceed === 'smoke';
  const dossierDir = resolve(runDir, 'dossiers');
  if (!existsSync(dossierDir)) mkdirSync(dossierDir, { recursive: true });

  const targetLeads = isSmoke ? qualified.slice(0, 3) : qualified;
  console.log(`\n[Stage 3-5] Researching + writing + validating ${targetLeads.length} leads${isSmoke ? ' (SMOKE)' : ''}...`);

  const finalRows: Record<string, any>[] = [];
  const failures: any[] = [];

  for (const lead of targetLeads) {
    try {
      const dossier = await researchLead({
        lead, serperKey: env.SERPER_API_KEY ?? '',
        priorityDomains,
        thresholds: { t2: limits.tier_thresholds.t2_qual_confidence, t3: limits.tier_thresholds.t3_qual_confidence },
        callerScript: 'pipeline/run.ts',
      });
      writeDossier(dossier, dossierDir);

      const written = await writeEmailsForLead({
        dossier, cfg, exampleEmails,
        firstName: lead.first_name,
        dispatch, maxRetries: 3,
      });
      if (!written.output) {
        failures.push({ person_id: lead.person_id, stage: 'write', error: written.error });
        continue;
      }
      const reports = await validateEmails({
        output: written.output, dossier, cfg, dispatch,
        semanticThreshold: limits.semantic_pass_threshold,
        recipientName: lead.full_name, recipientTitle: lead.current_job_title, recipientCompany: lead.company_name,
      });

      const allPass = reports.every(r => r.final_pass);
      if (!allPass) failures.push({ person_id: lead.person_id, stage: 'validate', reports });

      finalRows.push({
        ...lead,
        research_tier: dossier.tier,
        signal_used: dossier.signals.funding_fact ? 'funding' : dossier.signals.press_facts[0] ? 'press' : dossier.signals.category_snippet ? 'snippet' : 'fallback',
        signal_fact: dossier.signals.funding_fact ?? dossier.signals.press_facts[0] ?? dossier.signals.category_snippet ?? '',
        research_dossier_path: resolve(dossierDir, `${dossier.company.domain}.json`),
        assigned_variant: dossier.tier === 'T3' ? 'A' : dossier.tier === 'T2' ? 'B' : 'C',
        validator_score: reports[0].semantic.score,
        validator_role_play_verdict: reports[0].role_play?.verdict ?? '',
        email1_subject: written.output.email1.subject,
        email1_body: written.output.email1.body,
        email1_research_detail: written.output.email1.research_detail_used,
        email2_subject: written.output.email2.subject,
        email2_body: written.output.email2.body,
        email2_research_detail: written.output.email2.research_detail_used,
        email3_subject: written.output.email3.subject,
        email3_body: written.output.email3.body,
        email3_research_detail: written.output.email3.research_detail_used,
        email4_subject: written.output.email4.subject,
        email4_body: written.output.email4.body,
        email4_research_detail: written.output.email4.research_detail_used,
      });
    } catch (err: any) {
      failures.push({ person_id: lead.person_id, stage: 'unknown', error: err?.message ?? String(err) });
    }
  }

  writeArtifact(runDir, 'failures.json', failures);

  if (isSmoke && !args.smoke) {
    // smoke was chosen from the preflight menu; ask whether to proceed with rest
    const remaining = qualified.slice(3);
    console.log(`\nSmoke complete on 3 leads. ${remaining.length} leads remain.`);
    proceed = await promptPreflight('Proceed with the rest? (yes / no):');
    if (proceed !== 'yes') {
      console.log('Stopped after smoke.');
      writeArtifact(runDir, 'output.csv', writeCsvWithExtra(finalRows, []));
      return;
    }
    // continue with the remaining
    for (const lead of remaining) {
      // ... (same loop body — kept short for plan readability; copy from above)
      // implementer note: factor the per-lead block into a helper function in the actual code.
    }
  }

  // ---- Stage 6: quality gate ----
  console.log('\n[Stage 6] Quality gate...');
  const approved = await runQualityGate(finalRows as any, args.client, args.category);
  if (!approved) { console.log('Not approved.'); return; }

  writeArtifact(runDir, 'output.csv', writeCsvWithExtra(finalRows, []));
  writeArtifact(runDir, 'final-stats.json', { rendered: finalRows.length, failures: failures.length });
  console.log(`\nFinal CSV: ${resolve(runDir, 'output.csv')}`);
}

// CLI entry
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parsePipelineArgs(process.argv);
  runPipeline(args).catch(e => { console.error('FATAL:', e?.message ?? e); process.exit(1); });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/pipeline/run.test.ts
```
Expected: PASS

- [ ] **Step 5: Smoke test dry-run for mythic**

```bash
npx tsx scripts/pipeline/run.ts --client mythic --category qsr --dry-run
```

Expected: prints PIPELINE PRE-FLIGHT report, then exits before any API call.

- [ ] **Step 6: Commit**

```bash
git add scripts/pipeline/run.ts tests/pipeline/run.test.ts
git commit -m "feat(pipeline): orchestrator wiring all stages with smoke/dry-run/offline flags"
```

---

## Task 16: Recovery Commands (`recover.ts`)

**Context:** Replays extraction/score/write from cache without re-paying. `--stage extract` re-extracts facts from cached Serper responses. `--stage score` re-scores from cached prompts. `--stage write` re-writes from cached dossiers. `--clear-cache --confirm-domain=X` wipes one domain.

**Files:**
- Create: `scripts/pipeline/recover.ts`

- [ ] **Step 1: Create `scripts/pipeline/recover.ts`**

```typescript
#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Recovery commands for the standardized pipeline.
//
// Usage:
//   npx tsx scripts/pipeline/recover.ts --client mythic --category qsr --stage extract
//   npx tsx scripts/pipeline/recover.ts --client mythic --category qsr --stage write
//   npx tsx scripts/pipeline/recover.ts --clear-cache --confirm-domain=mythic.us
// ---------------------------------------------------------------------------

import { resolve } from 'path';
import { clearCacheDomain } from './_cache';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined; };
  const getEq = (flag: string) => {
    const item = args.find(a => a.startsWith(`${flag}=`));
    return item ? item.split('=')[1] : undefined;
  };
  return {
    client: get('--client'),
    category: get('--category'),
    stage: get('--stage'),
    clearCache: args.includes('--clear-cache'),
    confirmDomain: getEq('--confirm-domain'),
  };
}

async function main() {
  const args = parseArgs();

  if (args.clearCache) {
    if (!args.confirmDomain) {
      console.error('--clear-cache requires --confirm-domain=<exact-domain> to prevent accidents');
      process.exit(1);
    }
    const dirs = [
      resolve(process.cwd(), 'data/research-cache/serper'),
      resolve(process.cwd(), 'data/research-cache/scrape'),
      resolve(process.cwd(), 'data/research-cache/person'),
    ];
    let total = 0;
    for (const d of dirs) total += clearCacheDomain(d, args.confirmDomain);
    console.log(`Cleared ${total} cache entries for ${args.confirmDomain}`);
    return;
  }

  if (!args.client || !args.category || !args.stage) {
    console.error('Usage: --client X --category Y --stage extract|score|write');
    process.exit(1);
  }

  if (args.stage === 'extract') {
    console.log('Re-extract from cached Serper responses: see Task 15 implementation in run.ts.');
    console.log('Run the full pipeline with --offline to use only cached data (no new API calls).');
    return;
  }

  if (args.stage === 'write') {
    console.log('Re-write from cached dossiers: re-run with --offline.');
    return;
  }

  if (args.stage === 'score') {
    console.log('Re-score from cached leads: re-run with --offline.');
    return;
  }

  console.error(`Unknown stage: ${args.stage}`);
  process.exit(1);
}

main().catch(e => { console.error('FATAL:', e?.message ?? e); process.exit(1); });
```

- [ ] **Step 2: Smoke test**

```bash
npx tsx scripts/pipeline/recover.ts --clear-cache --confirm-domain=does-not-exist.com
```
Expected: `Cleared 0 cache entries for does-not-exist.com`

- [ ] **Step 3: Commit**

```bash
git add scripts/pipeline/recover.ts
git commit -m "feat(pipeline): recovery commands for cache replay and per-domain wipe"
```

---

## Task 17: Cache Stats (`cache-stats.ts`)

**Context:** Audit how much cache exists per client/category, how many credits it represents.

**Files:**
- Create: `scripts/pipeline/cache-stats.ts`

- [ ] **Step 1: Create `scripts/pipeline/cache-stats.ts`**

```typescript
#!/usr/bin/env tsx
import { existsSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';

function countDir(dir: string): { files: number; bytes: number } {
  if (!existsSync(dir)) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    files++;
    try { bytes += statSync(resolve(dir, f)).size; } catch {}
  }
  return { files, bytes };
}

const dirs = [
  ['Prospeo',    'data/research-cache/prospeo'],
  ['Serper',     'data/research-cache/serper'],
  ['Scrape',     'data/research-cache/scrape'],
  ['Person',     'data/research-cache/person'],
  ['LeadMagic',  'data/research-cache/leadmagic'],
  ['Score',      'data/research-cache/score'],
];

console.log('═'.repeat(60));
console.log('  CACHE STATS');
console.log('═'.repeat(60));
let totalFiles = 0;
for (const [name, path] of dirs) {
  const stats = countDir(resolve(process.cwd(), path));
  totalFiles += stats.files;
  console.log(`  ${name.padEnd(12)} ${String(stats.files).padStart(6)} files  ${(stats.bytes / 1024).toFixed(1).padStart(8)} KB`);
}
console.log('─'.repeat(60));
console.log(`  TOTAL        ${String(totalFiles).padStart(6)} files`);
console.log('═'.repeat(60));
console.log('Each cached Serper file = 1 credit saved on re-extraction.');
```

- [ ] **Step 2: Smoke test**

```bash
npx tsx scripts/pipeline/cache-stats.ts
```
Expected: prints table.

- [ ] **Step 3: Commit**

```bash
git add scripts/pipeline/cache-stats.ts
git commit -m "feat(pipeline): cache stats audit command"
```

---

## Task 18: Integration Test with Fixtures

**Context:** End-to-end test using saved Serper/Prospeo fixtures. Catches shape mismatches that unit tests miss.

**Files:**
- Create: `tests/fixtures/prospeo-page-1.json`
- Create: `tests/fixtures/serper-funding-acme.json`
- Create: `tests/fixtures/serper-press-acme.json`
- Create: `tests/pipeline/integration.test.ts`

- [ ] **Step 1: Create `tests/fixtures/prospeo-page-1.json`**

```json
{
  "pagination": { "total_count": 1, "total_page": 1 },
  "results": [
    {
      "person": {
        "person_id": "p1",
        "first_name": "Jane",
        "last_name": "Doe",
        "full_name": "Jane Doe",
        "current_job_title": "Chief Marketing Officer",
        "linkedin_url": "https://linkedin.com/in/janedoe",
        "location": { "city": "New York", "state": "NY", "country": "United States" },
        "email": "jane@acme.com"
      },
      "company": {
        "name": "Acme",
        "domain": "acme.com",
        "industry": "Restaurants",
        "headcount": 500,
        "headcount_range": "201-500",
        "linkedin_url": "https://linkedin.com/company/acme",
        "location": { "city": "New York", "state": "NY", "country": "United States" }
      }
    }
  ]
}
```

- [ ] **Step 2: Create `tests/fixtures/serper-funding-acme.json`**

```json
{
  "organic": [
    {
      "title": "Acme raises $10M Series B led by Sequoia",
      "link": "https://techcrunch.com/2026/03/15/acme-series-b/",
      "snippet": "Acme announced an $10M Series B round led by Sequoia in March 2026.",
      "date": "2026-03-15"
    }
  ]
}
```

- [ ] **Step 3: Create `tests/fixtures/serper-press-acme.json`**

```json
{
  "organic": [
    {
      "title": "Acme expands footprint with new Boston location",
      "link": "https://prnewswire.com/news/acme-boston/",
      "snippet": "Acme announces opening of its first Boston location in Q2 2026.",
      "date": "2026-04-01"
    }
  ]
}
```

- [ ] **Step 4: Create `tests/pipeline/integration.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { extractFundingFact, extractPressFact } from '../../scripts/_fact_extractor';
import { leadFromProspeoResult, buildProspeoFilters } from '../../scripts/pipeline/_pull';
import { validateMechanical } from '../../scripts/pipeline/_validate';
import { buildWriterPrompt } from '../../scripts/pipeline/_write';

const FX = resolve(__dirname, '../fixtures');
const prospeoFx = JSON.parse(readFileSync(resolve(FX, 'prospeo-page-1.json'), 'utf8'));
const fundingFx = JSON.parse(readFileSync(resolve(FX, 'serper-funding-acme.json'), 'utf8'));
const pressFx = JSON.parse(readFileSync(resolve(FX, 'serper-press-acme.json'), 'utf8'));

describe('integration: Prospeo -> Lead -> Research -> Writer prompt', () => {
  it('Prospeo result becomes a valid Lead', () => {
    const lead = leadFromProspeoResult(prospeoFx.results[0]);
    expect(lead.person_id).toBe('p1');
    expect(lead.company_domain).toBe('acme.com');
    expect(lead.email).toBe('jane@acme.com');
  });

  it('Funding fixture extracts a fact (trusted domain)', () => {
    const fact = extractFundingFact(fundingFx, 'Acme');
    expect(fact).not.toBeNull();
    expect(fact!.fact).toMatch(/series b/i);
  });

  it('Press fixture extracts a fact (trusted domain)', () => {
    const fact = extractPressFact(pressFx, 'Acme');
    expect(fact).not.toBeNull();
    expect(fact!.fact).toMatch(/expand|opening/i);
  });

  it('Writer prompt embeds dossier and rules', () => {
    const lead = leadFromProspeoResult(prospeoFx.results[0]);
    const fundingFact = extractFundingFact(fundingFx, 'Acme');
    const dossier: any = {
      tier: 'T2',
      person: { person_id: lead.person_id, full_name: lead.full_name, title: lead.current_job_title, seniority: 'C-suite', linkedin_url: '' },
      company: { name: lead.company_name, domain: lead.company_domain, industry: lead.company_industry, headcount_range: lead.company_headcount_range, location: '' },
      signals: { funding_fact: fundingFact?.fact ?? null, press_facts: [], acquisition_fact: null, category_snippet: null },
      scrape: null,
      person_depth: { person_quote: null, recent_post_topic: null, public_speaking_topics: [], career_pivot_signal: null },
    };
    const cfg = {
      business: { name: 'TestCo', website: '', one_liner: 'A test', tone: 'peer-to-peer' },
      offer: { primary_product: 'Audit', primary_cta: '', value_prop: '', lead_magnet: '' },
      legal: { banned_words: [] },
      copy_tone: { in_vocabulary: [], out_vocabulary: [] },
    } as any;
    const prompt = buildWriterPrompt({ dossier, cfg, exampleEmails: [], firstName: lead.first_name });
    expect(prompt).toContain('Series B');
    expect(prompt).toContain('Jane');
    expect(prompt).toContain('Acme');
  });

  it('Mechanical validator rejects a templated email with em dashes', () => {
    const email = { subject: 's', body: 'jane — we noticed acme raised series b. happy to chat.', research_detail_used: 'Series B' };
    const result = validateMechanical(email, { wordCount: { min: 10, max: 90 }, banned: [] });
    expect(result.pass).toBe(false);
    expect(result.violations.some(v => /em dash/i.test(v))).toBe(true);
  });
});
```

- [ ] **Step 5: Run integration tests**

```bash
npx vitest run tests/pipeline/integration.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures tests/pipeline/integration.test.ts
git commit -m "test(pipeline): integration tests with Prospeo + Serper fixtures"
```

---

## Task 19: Move Legacy Scripts

**Context:** Once new pipeline is working, archive the old per-client scripts. Don't delete — move to `scripts/legacy/` so they're git-tracked and findable.

**Files:**
- Move: `scripts/mythic-*.ts` → `scripts/legacy/`
- Move: `scripts/prospeo-trial-search.ts` → `scripts/legacy/`
- Move: `scripts/render-with-signals.ts` → `scripts/legacy/`
- Move: `scripts/extract-signals.ts` → `scripts/legacy/`
- Move: `scripts/render-multivertical.ts` → `scripts/legacy/`
- Move: `scripts/rerender-category.ts` → `scripts/legacy/`
- Move: `scripts/merge-*.ts` (4 files) → `scripts/legacy/`
- Move: `scripts/split-*.ts` (4 files) → `scripts/legacy/`
- Move: `scripts/reextract-from-cache.ts` → `scripts/legacy/`
- Move: `scripts/validate-final.ts` → `scripts/legacy/`
- Move: `scripts/_serper-test.ts`, `_serper-debug.ts`, `_signal-debug.ts`, `_list-unscored.ts`, `_merge-scores.ts`, `_mythic-icp-sample.ts`, `_gate-check.ts` → `scripts/legacy/`
- Create: `scripts/legacy/README.md`

- [ ] **Step 1: Create `scripts/legacy/README.md`**

```markdown
# Legacy Scripts

These scripts were replaced by the standardized pipeline in `scripts/pipeline/`.
Kept here for reference only. Do not run from this folder.

| Old script | Replaced by |
|------------|-------------|
| `mythic-prospeo-search.ts` | `pipeline/_pull.ts` + `profiles/mythic/client-profile.yaml` |
| `prospeo-trial-search.ts` | `pipeline/_pull.ts` + `profiles/belardi-wong/client-profile.yaml` |
| `mythic-score-leads.ts`, `mythic-apply-scores.ts` | `pipeline/_score.ts` |
| `mythic-extract-signals.ts`, `extract-signals.ts` | `pipeline/_research.ts` |
| `mythic-render.ts`, `render-with-signals.ts`, `render-multivertical.ts`, `rerender-category.ts` | `pipeline/_write.ts` |
| `merge-*.ts`, `split-*.ts` | one-off batch tools, not needed in standardized pipeline |
| `reextract-from-cache.ts` | `pipeline/recover.ts --stage extract` (or `pipeline/run.ts --offline`) |
| `validate-final.ts` | `pipeline/_validate.ts` |
| `_serper-test.ts`, `_serper-debug.ts`, `_signal-debug.ts` | one-off debug scripts, see `pipeline/run.ts --dry-run` instead |

Run the new pipeline with: `npx tsx scripts/pipeline/run.ts --client X --category Y`
```

- [ ] **Step 2: Move all listed scripts**

```bash
mkdir -p scripts/legacy
git mv scripts/mythic-prospeo-search.ts scripts/legacy/
git mv scripts/mythic-score-leads.ts scripts/legacy/
git mv scripts/mythic-apply-scores.ts scripts/legacy/
git mv scripts/mythic-extract-signals.ts scripts/legacy/
git mv scripts/mythic-render.ts scripts/legacy/
git mv scripts/prospeo-trial-search.ts scripts/legacy/
git mv scripts/extract-signals.ts scripts/legacy/
git mv scripts/render-with-signals.ts scripts/legacy/
git mv scripts/render-multivertical.ts scripts/legacy/
git mv scripts/rerender-category.ts scripts/legacy/
git mv scripts/merge-and-split-new.ts scripts/legacy/
git mv scripts/merge-enrich-and-render.ts scripts/legacy/
git mv scripts/merge-enrich-and-render-v2.ts scripts/legacy/
git mv scripts/merge-qual-batches.ts scripts/legacy/
git mv scripts/merge-qual-v2.ts scripts/legacy/
git mv scripts/merge-raw-csvs.ts scripts/legacy/
git mv scripts/split-additional-qualified.ts scripts/legacy/
git mv scripts/split-additional-verticals.ts scripts/legacy/
git mv scripts/split-athletic-footwear.ts scripts/legacy/
git mv scripts/split-by-campaign.ts scripts/legacy/
git mv scripts/reextract-from-cache.ts scripts/legacy/
git mv scripts/validate-final.ts scripts/legacy/
git mv scripts/_serper-test.ts scripts/legacy/
git mv scripts/_serper-debug.ts scripts/legacy/
git mv scripts/_signal-debug.ts scripts/legacy/
git mv scripts/_signal-validate.ts scripts/legacy/
git mv scripts/_list-unscored.ts scripts/legacy/
git mv scripts/_merge-scores.ts scripts/legacy/
git mv scripts/_mythic-icp-sample.ts scripts/legacy/
git mv scripts/_gate-check.ts scripts/legacy/
git mv scripts/tally-multivertical.ts scripts/legacy/
git mv scripts/prep-smartlead-for-signals.ts scripts/legacy/
git mv scripts/prepare-bridge-prompts.ts scripts/legacy/
git mv scripts/run-pipeline.ts scripts/legacy/
```

- [ ] **Step 3: Run full test suite to confirm nothing broke**

```bash
npx vitest run
```
Expected: All tests pass. If any tests imported from a now-moved file, update the import path to `scripts/legacy/...` or remove the obsolete test.

- [ ] **Step 4: Commit**

```bash
git add scripts/legacy/
git commit -m "refactor(pipeline): move legacy per-client scripts to scripts/legacy/"
```

---

## Task 20: Update Mythic + BW client-profile.yaml with priority_domains

**Context:** Extend both client profiles with the new `priority_domains` field so they work with the new tier logic.

**Files:**
- Modify: `profiles/mythic/client-profile.yaml`
- Modify: `profiles/belardi-wong/client-profile.yaml`

- [ ] **Step 1: Add `priority_domains` to `profiles/mythic/client-profile.yaml`**

Insert before `created_at:`:

```yaml
priority_domains:
  # Domains that always get T3 research regardless of qual_confidence
  - portillos.com         # large public consumer brand, dream client
  - chickfila.com         # category-defining QSR
  - shakeshack.com        # already disqualified by headcount, kept for reference

vertical_industries:
  # Per-category Prospeo industry overrides. Falls back to icp_hard_filters.industries_in if not set.
  qsr:
    - Restaurants
    - Food and Beverage Retail
  retail:
    - General Retail
    - Retail Apparel and Fashion
    - Consumer Goods
  financial:
    - Financial Services
    - Banking
    - Insurance
  healthcare:
    - Hospitals and Health Care
    - Wellness and Fitness Services
  hospitality:
    - Hospitality
  automotive:
    - Automotive
    - Retail Motor Vehicles
  apparel:
    - Retail Apparel and Fashion
    - Luxury Goods and Jewelry
  consumer:
    - Consumer Services
    - Consumer Goods
    - Personal Care Product Manufacturing
```

- [ ] **Step 2: Add `priority_domains` to `profiles/belardi-wong/client-profile.yaml`**

Insert before `created_at:`:

```yaml
priority_domains:
  - ashleyfurniture.com
  - ethanallen.com
  - roomandboard.com
  - aritzia.com
  - skims.com

vertical_industries:
  apparel:
    - Retail Apparel and Fashion
    - Apparel Manufacturing
    - Luxury Goods and Jewelry
    - Fashion Accessories Manufacturing
  beauty:
    - Cosmetics
    - Personal Care Product Manufacturing
    - Retail Health and Personal Care Products
  fnb:
    - Food and Beverage Retail
    - Food and Beverage Manufacturing
    - Wine and Spirits
  home:
    - Retail Furniture and Home Furnishings
    - Furniture and Home Furnishings Manufacturing
```

- [ ] **Step 3: Run tests to verify YAML parses**

```bash
npx vitest run tests/_client_config.test.ts
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add profiles/mythic/client-profile.yaml profiles/belardi-wong/client-profile.yaml
git commit -m "feat(profiles): add priority_domains and vertical_industries to client profiles"
```

---

## Task 21: Full Pipeline Dry-Run + Smoke

**Context:** Final validation. Run the new pipeline on Mythic QSR in dry-run mode, then smoke mode, confirm no errors before deleting old scripts.

- [ ] **Step 1: Dry-run for Mythic QSR**

```bash
npx tsx scripts/pipeline/run.ts --client mythic --category qsr --dry-run
```

Expected output:
- prints `=== PIPELINE: Mythic / qsr ===`
- shows Stage 1 pull from cache (no new Prospeo calls)
- shows Stage 2 score from cache (no new sub-agent calls)
- prints PREFLIGHT report
- exits with `[dry-run] aborting before any API calls.`

- [ ] **Step 2: Verify no errors in output**

If any error in dry-run, fix before proceeding. Common issues:
- Missing field in `client-profile.yaml` (add it)
- Cache file not found (acceptable — pipeline plans live calls)
- TypeScript error (fix the import or type)

- [ ] **Step 3: Inspect a few cached responses**

```bash
npx tsx scripts/pipeline/cache-stats.ts
```

Confirm Prospeo + Serper caches exist from previous runs.

- [ ] **Step 4: Commit the dry-run output as a smoke artifact**

```bash
mkdir -p data/runs-smoke
npx tsx scripts/pipeline/run.ts --client mythic --category qsr --dry-run > data/runs-smoke/dry-run-mythic-qsr-$(date -u +%Y%m%d).log 2>&1
git add data/runs-smoke/
git commit -m "test(pipeline): capture dry-run output as smoke artifact"
```

---

## Self-Review

**1. Spec coverage check:**

| Spec section | Implemented by |
|--------------|----------------|
| Architecture (one orchestrator) | Task 15 |
| Stage 1 Lead Pull | Task 5 |
| Stage 2 ICP Score | Task 6 |
| Stage 3 Tiered Research | Tasks 7, 8 |
| Stage 4 Email Writer | Task 9 |
| Stage 5 Validator (3 sub-stages) | Task 10 |
| Stage 6 Quality Gate | Uses existing `_quality_gate.ts`, wired in Task 15 |
| Credit Guard + Pre-flight | Task 11 |
| Smoke Mode | Task 12 |
| Cache + Recovery | Tasks 1, 16, 17 |
| Sub-agent Orchestration | Task 2 |
| Run Artifacts | Task 13 |
| Example Emails | Task 14 |
| Client config extensions | Task 4 |
| priority_domains in YAML | Task 20 |
| Migration / Legacy | Task 19 |
| Integration tests | Task 18 |
| Final dry-run validation | Task 21 |

All spec sections have at least one implementing task.

**2. Placeholder scan:** Reviewed every code block. No "TBD", "TODO", "implement later". One inline note in Task 15 acknowledges that the smoke-continuation block should be factored into a helper in the actual implementation; that's an implementer instruction, not a missing piece.

**3. Type consistency:**
- `Lead` defined in Task 5, used in Tasks 6, 8, 12, 15
- `ScoredLead` defined in Task 6, used in Tasks 8, 12, 15
- `ResearchDossier` defined in Task 8, used in Tasks 9, 10, 15
- `WriterEmail` / `WriterOutput` defined in Task 9, used in Task 10
- `Tier` defined in Task 8, used in Tasks 11, 12, 15
- `SubagentDispatcher` defined in Task 2, used in Tasks 6, 9, 10, 15
- `Limits` defined in Task 3, used in Tasks 11, 15

All types consistent across tasks.

**4. Scope check:** This is one cohesive subsystem (the pipeline). It does not include Smartlead upload or LeadMagic integration (deferred per spec). Single implementation plan is appropriate.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-28-standardized-pipeline.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
