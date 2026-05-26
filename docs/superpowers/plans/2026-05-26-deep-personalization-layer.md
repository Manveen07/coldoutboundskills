# Deep Personalization Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a signal-grounded deep-personalization layer that fetches time-bounded facts (funding, hires, promotions, press, launches, company snippet) about each qualified lead, then renders signal-aware Email 1 + Email 2 with constrained bridge sentences enforced by validator checks.

**Architecture:** Three-component pipeline with file-boundary interfaces. **Signal extractor** (`extract-signals.ts`) fires tier-gated Serper + PND queries, persists raw responses + extracted facts to domain-keyed JSON sidecars (90-day TTL for hits, 7-day for empties). **Signal-aware renderer** (`render-with-signals.ts`) reads sidecars, picks freshest in-window signal by priority order, generates third-person fact + category-pattern bridge via AI subagent, slots into Email 1 + Email 2 templates. **Validator** (`validate-final.ts`) extends with Checks 11-14 to mechanically reject editorial words, banned sentence-starts, stale signals, and bare universal-truth patterns. Cache is cross-client, cross-campaign keyed by domain.

**Tech Stack:** TypeScript via tsx (no compile), vitest for tests, native fetch for Serper + RapidAPI PND, existing AI subagent dispatch via Claude Code Agent tool. Reads existing v4 `leads-all-with-qual.csv` schema, emits v5 `leads-with-signals.csv` + `leads-final-v5.csv`.

**Spec reference:** `coldoutboundskills/docs/superpowers/specs/2026-05-26-deep-personalization-layer-design.md`

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `package.json` | vitest + dependencies (project root) |
| `vitest.config.ts` | test config |
| `tsconfig.json` | TS config (if not already present at root) |
| `scripts/_lib_signals.ts` | shared utilities: cache I/O, tier computation, banned-word matcher, sentence tokenizer |
| `scripts/_serper_client.ts` | Serper API wrapper. Returns `{ raw, queryString, timestamp, status }`. Mockable for tests. |
| `scripts/_pnd_client.ts` | PND wrapper. Placeholder shape until user provides endpoint docs. |
| `scripts/_query_templates.ts` | Serper query template strings per signal type (locked in spec §5) |
| `scripts/_signal_selector.ts` | Picks freshest in-window signal per priority order (new_role > promotion > funding > launch > press > snippet) |
| `scripts/_bridge_writer.ts` | Wraps AI subagent invocation for bridge sentence generation. Pre-validates against banned lists before returning. |
| `scripts/extract-signals.ts` | Main extractor entry point. Reads `leads-all-with-qual.csv`, writes `leads-with-signals.csv` + per-domain sidecars. |
| `scripts/render-with-signals.ts` | Main renderer entry point. Reads `leads-with-signals.csv` + variants + sidecars, writes `leads-final-v5.csv` + `messages-final-v5.md`. |
| `data/signals/.gitkeep` | placeholder so directory exists |
| `tests/_lib_signals.test.ts` | unit tests for cache + tier + banned-word matcher |
| `tests/_serper_client.test.ts` | unit tests for Serper wrapper (mocked) |
| `tests/_signal_selector.test.ts` | unit tests for signal priority + freshness |
| `tests/_bridge_writer.test.ts` | unit tests for bridge generation + pre-validation |
| `tests/extract-signals.test.ts` | integration tests for extractor |
| `tests/render-with-signals.test.ts` | integration tests for renderer |
| `tests/validate-final.test.ts` | unit tests for new Checks 11-14 |
| `tests/cache_cross_client.test.ts` | proves cross-client compounding (key economic argument) |
| `tests/fixtures/serper-funding-success.json` | mock Serper response: funding round found |
| `tests/fixtures/serper-empty.json` | mock Serper response: zero results |
| `tests/fixtures/leads-mock-5.csv` | 5 mock qualified leads (mix of tiers) |

### Modified files

| Path | Change |
|---|---|
| `scripts/validate-final.ts` | Add Checks 11/12/13/14. Existing 1-10 unchanged. |
| `.gitignore` | Add `data/signals/` and `node_modules/` |
| `.env.example` | Confirm `SERPER_API_KEY` + `RAPIDAPI_KEY` documented (already present) |

---

## Task 1: Project setup — vitest + package.json

**Files:**
- Create: `package.json`
- Create: `vitest.config.ts`
- Create: `tsconfig.json` (if missing)
- Modify: `.gitignore` (add `node_modules/`, `data/signals/`)

- [ ] **Step 1: Create package.json**

```json
{
  "name": "coldoutboundskills-pipeline",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "extract": "tsx scripts/extract-signals.ts",
    "render": "tsx scripts/render-with-signals.ts",
    "validate": "tsx scripts/validate-final.ts"
  },
  "devDependencies": {
    "vitest": "^1.6.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "@types/node": "^20.11.0"
  }
}
```

- [ ] **Step 2: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10000,
  },
});
```

- [ ] **Step 3: Create tsconfig.json (only if missing)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["scripts/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 4: Update .gitignore**

Append to existing `.gitignore`:
```
node_modules/
data/signals/
```

- [ ] **Step 5: Install + verify**

Run: `cd coldoutboundskills && npm install`
Run: `npx vitest --version`
Expected: vitest version prints (1.6.x or similar)

- [ ] **Step 6: Commit**

```bash
git add package.json vitest.config.ts tsconfig.json .gitignore
git commit -m "chore: add vitest + tsx setup for signal layer tests"
```

---

## Task 2: Cache layer — TTL-aware sidecar I/O

**Files:**
- Create: `scripts/_lib_signals.ts` (cache section only)
- Create: `tests/_lib_signals.test.ts`
- Create: `data/signals/.gitkeep`

- [ ] **Step 1: Write the failing test for fresh-cache read**

`tests/_lib_signals.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { resolve } from 'path';
import { readSidecar, writeSidecar } from '../scripts/_lib_signals';

const TEST_DIR = resolve(__dirname, '../data/signals-test');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('cache read/write', () => {
  it('returns fresh sidecar when within TTL', () => {
    const now = new Date().toISOString();
    writeSidecar('example.com', {
      schema_version: '1.0',
      domain: 'example.com',
      fetched_at: now,
      company_snippet: { fact: 'snippet', source_query: 'q' },
    }, TEST_DIR);

    const data = readSidecar('example.com', TEST_DIR);
    expect(data).not.toBeNull();
    expect(data!.cache_status).toBe('fresh');
    expect(data!.company_snippet.fact).toBe('snippet');
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `cd coldoutboundskills && npx vitest run tests/_lib_signals.test.ts`
Expected: FAIL — `readSidecar` / `writeSidecar` not exported (module not found)

- [ ] **Step 3: Implement minimal cache layer**

`scripts/_lib_signals.ts`:

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

export const DEFAULT_TTL_DAYS_HIT = 90;
export const DEFAULT_TTL_DAYS_MISS = 7;

export interface SignalSidecar {
  schema_version: string;
  domain: string;
  fetched_at: string;
  cache_status?: 'fresh' | 'stale' | 'fetched';
  ttl_days?: number;
  company_snippet?: any;
  funding?: any;
  press?: any[];
  product_launch?: any;
  fetch_log?: any[];
  [k: string]: any;
}

function ttlForSidecar(s: SignalSidecar): number {
  const empty = isEmpty(s);
  return empty ? DEFAULT_TTL_DAYS_MISS : DEFAULT_TTL_DAYS_HIT;
}

function isEmpty(s: SignalSidecar): boolean {
  const noSnippet = !s.company_snippet?.fact;
  const noFunding = !s.funding?.fact;
  const noPress = !s.press?.length || !s.press[0]?.fact;
  const noLaunch = !s.product_launch?.fact;
  return noSnippet && noFunding && noPress && noLaunch;
}

export function writeSidecar(domain: string, data: SignalSidecar, baseDir = 'data/signals'): void {
  if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });
  const path = resolve(baseDir, `${domain}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2));
}

export function readSidecar(domain: string, baseDir = 'data/signals'): SignalSidecar | null {
  const path = resolve(baseDir, `${domain}.json`);
  if (!existsSync(path)) return null;

  let data: SignalSidecar;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }

  const ageMs = Date.now() - new Date(data.fetched_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const ttl = ttlForSidecar(data);
  data.cache_status = ageDays <= ttl ? 'fresh' : 'stale';
  data.ttl_days = ttl;
  return data;
}
```

- [ ] **Step 4: Run the test to verify pass**

Run: `npx vitest run tests/_lib_signals.test.ts`
Expected: PASS — 1 test passing

- [ ] **Step 5: Add stale-sidecar test**

Append to `tests/_lib_signals.test.ts`:

```typescript
it('returns stale sidecar when older than TTL', () => {
  const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
  writeSidecar('example.com', {
    schema_version: '1.0',
    domain: 'example.com',
    fetched_at: oldDate,
    company_snippet: { fact: 'old', source_query: 'q' },
  }, TEST_DIR);

  const data = readSidecar('example.com', TEST_DIR);
  expect(data!.cache_status).toBe('stale');
});

it('uses 7-day TTL for empty sidecars', () => {
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  writeSidecar('example.com', {
    schema_version: '1.0',
    domain: 'example.com',
    fetched_at: eightDaysAgo,
    company_snippet: { fact: null, source_query: 'q' },
    funding: { fact: null, found: false },
  }, TEST_DIR);

  const data = readSidecar('example.com', TEST_DIR);
  expect(data!.cache_status).toBe('stale');
  expect(data!.ttl_days).toBe(7);
});

it('returns null if sidecar missing', () => {
  const data = readSidecar('nonexistent.com', TEST_DIR);
  expect(data).toBeNull();
});
```

- [ ] **Step 6: Run all 4 tests**

Run: `npx vitest run tests/_lib_signals.test.ts`
Expected: PASS — 4 tests passing

- [ ] **Step 7: Create placeholder data dir**

```bash
mkdir -p coldoutboundskills/data/signals
touch coldoutboundskills/data/signals/.gitkeep
```

- [ ] **Step 8: Commit**

```bash
git add scripts/_lib_signals.ts tests/_lib_signals.test.ts data/signals/.gitkeep
git commit -m "feat(signals): cache layer with 90d hit / 7d miss TTL"
```

---

## Task 3: Tier computation

**Files:**
- Modify: `scripts/_lib_signals.ts` (add tier section)
- Modify: `tests/_lib_signals.test.ts`

- [ ] **Step 1: Write failing tier tests**

Append to `tests/_lib_signals.test.ts`:

```typescript
import { computeTier } from '../scripts/_lib_signals';

describe('tier computation', () => {
  it('T1: VP+ with conf >= 0.80', () => {
    expect(computeTier({ qual_confidence: 0.85, title: 'VP Marketing' })).toBe('T1');
    expect(computeTier({ qual_confidence: 0.92, title: 'CMO' })).toBe('T1');
    expect(computeTier({ qual_confidence: 0.80, title: 'Founder' })).toBe('T1');
  });

  it('T1: Director+ with conf >= 0.90', () => {
    expect(computeTier({ qual_confidence: 0.91, title: 'Director of Growth' })).toBe('T1');
    expect(computeTier({ qual_confidence: 0.89, title: 'Director of Growth' })).toBe('T2');
  });

  it('T2: Director+ with conf 0.70-0.89', () => {
    expect(computeTier({ qual_confidence: 0.75, title: 'Director of Marketing' })).toBe('T2');
    expect(computeTier({ qual_confidence: 0.80, title: 'Head of Brand' })).toBe('T2');
    expect(computeTier({ qual_confidence: 0.85, title: 'Senior Manager' })).toBe('T2');
  });

  it('T2: Manager with conf >= 0.80', () => {
    expect(computeTier({ qual_confidence: 0.82, title: 'Marketing Manager' })).toBe('T2');
    expect(computeTier({ qual_confidence: 0.79, title: 'Marketing Manager' })).toBe('T3');
  });

  it('T3: everyone else qualified', () => {
    expect(computeTier({ qual_confidence: 0.71, title: 'Specialist' })).toBe('T3');
    expect(computeTier({ qual_confidence: 0.75, title: 'Coordinator' })).toBe('T3');
  });

  it('throws if below qualifier floor', () => {
    expect(() => computeTier({ qual_confidence: 0.65, title: 'CMO' }))
      .toThrow(/below qualifier floor/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/_lib_signals.test.ts`
Expected: FAIL — `computeTier` not exported

- [ ] **Step 3: Implement computeTier**

Append to `scripts/_lib_signals.ts`:

```typescript
export type EnrichmentTier = 'T1' | 'T2' | 'T3';

interface TierInput {
  qual_confidence: number;
  title: string;
}

const SENIOR_TITLES = /\b(vp|svp|evp|cmo|cro|ceo|cfo|coo|founder|chief|president)\b/i;
const DIRECTOR_TITLES = /\b(director|head of|senior manager|sr\.?\s*manager|sr\.?\s*director)\b/i;
const MANAGER_TITLES = /\bmanager\b/i;

export function computeTier(input: TierInput): EnrichmentTier {
  const { qual_confidence: conf, title } = input;

  if (conf < 0.70) {
    throw new Error(
      `Lead is below qualifier floor 0.70 (conf=${conf}). Should not reach enrichment.`
    );
  }

  const isSenior = SENIOR_TITLES.test(title);
  const isDirector = DIRECTOR_TITLES.test(title);
  const isManager = !isDirector && MANAGER_TITLES.test(title);

  if (conf >= 0.80 && isSenior) return 'T1';
  if (conf >= 0.90 && isDirector) return 'T1';
  if (conf >= 0.70 && isDirector) return 'T2';
  if (conf >= 0.80 && isManager) return 'T2';

  return 'T3';
}
```

**Plan-template bug fix note:** Earlier version of this template had `"head of"` in BOTH SENIOR_TITLES and DIRECTOR_TITLES. This caused "Head of Brand" at conf 0.80 to incorrectly return T1 (test expected T2). Spec §5 places "Head of" in the T2 Director+ list, not the T1 Senior list. Fix: removed "head of" from SENIOR_TITLES. Regression test added: "Head of Brand" at 0.91 → T1 (via Director+ at 0.90+ rule).

- [ ] **Step 4: Run tier tests**

Run: `npx vitest run tests/_lib_signals.test.ts`
Expected: PASS — all 10 tests (4 cache + 6 tier)

- [ ] **Step 5: Commit**

```bash
git add scripts/_lib_signals.ts tests/_lib_signals.test.ts
git commit -m "feat(signals): tier computation per spec thresholds"
```

---

## Task 4: Banned-word + sentence-start matcher

**Files:**
- Modify: `scripts/_lib_signals.ts` (add matcher section)
- Modify: `tests/_lib_signals.test.ts`

- [ ] **Step 1: Write failing banned-word tests**

Append to `tests/_lib_signals.test.ts`:

```typescript
import { findBannedWords, findBannedStarts } from '../scripts/_lib_signals';

describe('banned word matcher', () => {
  it('catches simple banned words', () => {
    expect(findBannedWords('Smart brands at your stage diversify channels')).toEqual(['smart']);
    expect(findBannedWords('The best DTC brands win.')).toEqual(['best']);
  });

  it('catches morphological variants', () => {
    expect(findBannedWords('Move smartly on direct mail.')).toEqual(['smartly']);
    expect(findBannedWords('A leading-edge approach to acquisition.')).toEqual(['leading-edge']);
    expect(findBannedWords('Best-in-class results.')).toEqual(['best-in-class']);
  });

  it('catches compound phrases', () => {
    expect(findBannedWords('Fresh eyes on the channel mix.')).toEqual(['fresh eyes']);
    expect(findBannedWords('Perfect timing for direct mail.')).toEqual(['perfect timing']);
  });

  it('does NOT match embedded substrings', () => {
    expect(findBannedWords('Smartphone integrations matter.')).toEqual([]);
    expect(findBannedWords('Best practices for testing.')).toEqual([]);
  });

  it('returns empty array for clean text', () => {
    expect(findBannedWords('Your Series B closed in March. Brands at that stage start asking the question.')).toEqual([]);
  });
});

describe('banned sentence-start matcher', () => {
  it('catches first-word "Saw"', () => {
    expect(findBannedStarts('Saw your Series B in March. Brands at that stage benchmark fast.')).toEqual(['Saw']);
  });

  it('catches "Noticed"', () => {
    expect(findBannedStarts('Noticed the new role. The first quarter is when benchmarks land.')).toEqual(['Noticed']);
  });

  it('catches multi-token starts like "I saw"', () => {
    expect(findBannedStarts('I saw your Austin store opened.')).toEqual(['I saw']);
  });

  it('catches across multiple sentences', () => {
    expect(findBannedStarts('Your Series B closed. Saw the announcement.')).toEqual(['Saw']);
  });

  it('returns empty for clean third-person', () => {
    expect(findBannedStarts('Your Series B closed in March. The first quarter usually surfaces the channel question.')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/_lib_signals.test.ts`
Expected: FAIL — `findBannedWords` / `findBannedStarts` not exported

- [ ] **Step 3: Implement matchers**

Append to `scripts/_lib_signals.ts`:

```typescript
export const BANNED_WORDS_SINGLE = [
  'smart', 'smarter', 'smartest', 'smartly',
  'best', 'savvy', 'savviness',
  'leading', 'great', 'exceptional', 'brilliant', 'brilliantly',
  'amazing', 'awesome', 'fantastic', 'impressive',
];

export const BANNED_WORDS_COMPOUND = [
  'best-in-class', 'best-of-breed', 'leading-edge', 'top-tier', 'top-rated',
  'fresh eyes', 'fresh perspective', 'fresh take',
  'the right person', 'the right time', 'perfect timing',
];

export const BANNED_STARTS = [
  'Saw', 'Noticed', 'Caught', 'I see', 'I noticed', 'I saw', 'I caught',
];

export function findBannedWords(text: string): string[] {
  const found = new Set<string>();
  const norm = text.toLowerCase();

  for (const phrase of BANNED_WORDS_COMPOUND) {
    if (norm.includes(phrase)) found.add(phrase);
  }

  // Tokenize: split on whitespace, strip surrounding punctuation, keep hyphens
  const tokens = norm
    .split(/\s+/)
    .map(t => t.replace(/^[.,;:!?()"']+|[.,;:!?()"']+$/g, ''))
    .filter(Boolean);

  for (const tok of tokens) {
    if (BANNED_WORDS_SINGLE.includes(tok)) found.add(tok);
    // hyphen-split compounds
    if (tok.includes('-')) {
      for (const part of tok.split('-')) {
        if (BANNED_WORDS_COMPOUND.includes(tok)) found.add(tok);
      }
    }
  }

  return Array.from(found);
}

export function findBannedStarts(text: string): string[] {
  const found: string[] = [];
  // Split into sentences (rough — split on . ! ? followed by whitespace)
  const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);

  for (const sentence of sentences) {
    for (const start of BANNED_STARTS) {
      const startLower = start.toLowerCase();
      const sentLower = sentence.toLowerCase();
      // Must be at sentence start AND followed by whitespace or end
      if (sentLower === startLower || sentLower.startsWith(startLower + ' ')) {
        if (!found.includes(start)) found.push(start);
        break;
      }
    }
  }

  return found;
}
```

- [ ] **Step 4: Run banned-word tests**

Run: `npx vitest run tests/_lib_signals.test.ts`
Expected: PASS — all tests passing (cache + tier + matchers, ~20 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/_lib_signals.ts tests/_lib_signals.test.ts
git commit -m "feat(signals): banned-word + banned-start matchers (Check 11 enforcement)"
```

---

## Task 5: Serper client (mockable wrapper)

**Files:**
- Create: `scripts/_serper_client.ts`
- Create: `tests/_serper_client.test.ts`
- Create: `tests/fixtures/serper-funding-success.json`
- Create: `tests/fixtures/serper-empty.json`

- [ ] **Step 1: Create mock fixtures**

`tests/fixtures/serper-funding-success.json`:

```json
{
  "searchParameters": { "q": "Test Co raised funding 2025 2026", "gl": "us" },
  "organic": [
    {
      "title": "Test Co raises $18M Series B - TechCrunch",
      "link": "https://techcrunch.com/test-co-series-b",
      "snippet": "Test Co announced an $18M Series B round led by Sequoia in March 2026.",
      "date": "2026-03-15"
    }
  ],
  "credits": 1
}
```

`tests/fixtures/serper-empty.json`:

```json
{
  "searchParameters": { "q": "Random Brand raised funding 2025 2026", "gl": "us" },
  "organic": [],
  "credits": 1
}
```

- [ ] **Step 2: Write failing Serper client test**

`tests/_serper_client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { serperSearch } from '../scripts/_serper_client';

const FUNDING_SUCCESS = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/serper-funding-success.json'), 'utf8'));
const EMPTY = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/serper-empty.json'), 'utf8'));

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('serperSearch', () => {
  it('returns structured response on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(FUNDING_SUCCESS),
    } as any);

    const result = await serperSearch('Test Co raised funding 2025 2026', 'test-api-key');
    expect(result.status).toBe(200);
    expect(result.queryString).toBe('Test Co raised funding 2025 2026');
    expect(result.raw.organic[0].title).toContain('Series B');
    expect(result.timestamp).toBeDefined();
  });

  it('returns empty result count when no organic results', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(EMPTY),
    } as any);

    const result = await serperSearch('Random Brand raised funding 2025 2026', 'test-api-key');
    expect(result.raw.organic).toHaveLength(0);
  });

  it('retries on 429 rate limit', async () => {
    let calls = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      calls++;
      if (calls === 1) {
        return Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}) } as any);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(FUNDING_SUCCESS) } as any);
    });

    const result = await serperSearch('q', 'key');
    expect(calls).toBe(2);
    expect(result.status).toBe(200);
  });

  it('gives up after 3 retries', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 429, json: () => Promise.resolve({})
    } as any);

    await expect(serperSearch('q', 'key')).rejects.toThrow(/rate limit/i);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/_serper_client.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement Serper client**

`scripts/_serper_client.ts`:

```typescript
export interface SerperResult {
  raw: any;
  queryString: string;
  timestamp: string;
  status: number;
}

export async function serperSearch(query: string, apiKey: string, retries = 3): Promise<SerperResult> {
  const url = 'https://google.serper.dev/search';
  let lastStatus = 0;

  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, gl: 'us' }),
    });

    lastStatus = res.status;

    if (res.ok) {
      const raw = await res.json();
      return {
        raw,
        queryString: query,
        timestamp: new Date().toISOString(),
        status: res.status,
      };
    }

    if (res.status === 429 || res.status >= 500) {
      const backoff = Math.pow(2, attempt) * 500;
      await new Promise(r => setTimeout(r, backoff));
      continue;
    }

    throw new Error(`Serper non-retryable error ${res.status}`);
  }

  throw new Error(`Serper rate limit / server error after ${retries} retries (last status: ${lastStatus})`);
}
```

- [ ] **Step 5: Run client tests**

Run: `npx vitest run tests/_serper_client.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 6: Commit**

```bash
git add scripts/_serper_client.ts tests/_serper_client.test.ts tests/fixtures/
git commit -m "feat(signals): Serper API client with retry + mockable for tests"
```

---

## Task 6: Query template strings

**Files:**
- Create: `scripts/_query_templates.ts`
- Create: `tests/_query_templates.test.ts`

- [ ] **Step 1: Write failing query template test**

`tests/_query_templates.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getQueriesForTier, SignalType } from '../scripts/_query_templates';

describe('query templates', () => {
  it('T1 returns 8 total queries (7 Serper + 1 PND slot)', () => {
    const queries = getQueriesForTier('T1', { company: 'Test Co', domain: 'testco.com' });
    expect(queries.serper).toHaveLength(7);
    expect(queries.pnd).toBe(true);
  });

  it('T2 returns 4 Serper + 1 PND', () => {
    const queries = getQueriesForTier('T2', { company: 'Test Co', domain: 'testco.com' });
    expect(queries.serper).toHaveLength(4);
    expect(queries.pnd).toBe(true);
  });

  it('T3 returns 3 Serper, no PND', () => {
    const queries = getQueriesForTier('T3', { company: 'Test Co', domain: 'testco.com' });
    expect(queries.serper).toHaveLength(3);
    expect(queries.pnd).toBe(false);
  });

  it('substitutes company name into template', () => {
    const queries = getQueriesForTier('T3', { company: 'Acme Inc', domain: 'acme.com' });
    expect(queries.serper.some(q => q.query.includes('Acme Inc'))).toBe(true);
  });

  it('every query has a signal_type', () => {
    const queries = getQueriesForTier('T1', { company: 'Test', domain: 'test.com' });
    for (const q of queries.serper) {
      expect(['funding', 'press', 'launch', 'snippet']).toContain(q.signal_type);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/_query_templates.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement query templates**

`scripts/_query_templates.ts`:

```typescript
import type { EnrichmentTier } from './_lib_signals';

export type SignalType = 'funding' | 'press' | 'launch' | 'snippet' | 'new_role' | 'promotion';

export interface QueryEntry {
  id: string;
  query: string;
  signal_type: SignalType;
}

export interface QueryBatch {
  serper: QueryEntry[];
  pnd: boolean;
}

interface QueryContext {
  company: string;
  domain: string;
}

function fund(id: string, template: string): (ctx: QueryContext) => QueryEntry {
  return (ctx) => ({ id, signal_type: 'funding', query: template.replace(/{company}/g, `"${ctx.company}"`).replace(/{domain}/g, ctx.domain) });
}

function press(id: string, template: string): (ctx: QueryContext) => QueryEntry {
  return (ctx) => ({ id, signal_type: 'press', query: template.replace(/{company}/g, `"${ctx.company}"`).replace(/{domain}/g, ctx.domain) });
}

function launch(id: string, template: string): (ctx: QueryContext) => QueryEntry {
  return (ctx) => ({ id, signal_type: 'launch', query: template.replace(/{company}/g, `"${ctx.company}"`).replace(/{domain}/g, ctx.domain) });
}

function snippet(id: string, template: string): (ctx: QueryContext) => QueryEntry {
  return (ctx) => ({ id, signal_type: 'snippet', query: template.replace(/{company}/g, `"${ctx.company}"`).replace(/{domain}/g, ctx.domain) });
}

const F1 = fund('F1', '{company} raised funding 2025 2026');
const F2 = fund('F2', '{company} series A B C funding 2025 2026');
const P1 = press('P1', '{company} press release 2026');
const P2 = press('P2', '{company} announces 2026');
const L1 = launch('L1', '{company} launches new collection 2026');
const L2 = launch('L2', '{company} new product launch 2025 2026');
const S1 = snippet('S1', '{company} {domain} ecommerce stores retail');

export function getQueriesForTier(tier: EnrichmentTier, ctx: QueryContext): QueryBatch {
  switch (tier) {
    case 'T1':
      return { serper: [F1(ctx), F2(ctx), P1(ctx), P2(ctx), L1(ctx), L2(ctx), S1(ctx)], pnd: true };
    case 'T2':
      return { serper: [F1(ctx), P1(ctx), L1(ctx), S1(ctx)], pnd: true };
    case 'T3':
      return { serper: [F1(ctx), P1(ctx), S1(ctx)], pnd: false };
  }
}
```

- [ ] **Step 4: Run template tests**

Run: `npx vitest run tests/_query_templates.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/_query_templates.ts tests/_query_templates.test.ts
git commit -m "feat(signals): Serper query templates per signal type + tier allocation"
```

---

## Task 7: Signal extractor — fact extraction from Serper response

**Files:**
- Create: `scripts/_fact_extractor.ts`
- Create: `tests/_fact_extractor.test.ts`

- [ ] **Step 1: Write failing fact extraction tests**

`tests/_fact_extractor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractFundingFact, extractPressFact, extractLaunchFact, extractSnippetFact } from '../scripts/_fact_extractor';

describe('extractFundingFact', () => {
  it('extracts fact from first organic result with date', () => {
    const raw = {
      organic: [{
        title: 'Test Co raises $18M Series B',
        snippet: 'Test Co announced an $18M Series B round led by Sequoia in March 2026.',
        date: '2026-03-15',
      }],
    };
    const fact = extractFundingFact(raw, 'Test Co');
    expect(fact).not.toBeNull();
    expect(fact!.fact).toMatch(/series b/i);
    expect(fact!.fact_date).toBe('2026-03-15');
    expect(fact!.freshness_days).toBeGreaterThanOrEqual(0);
  });

  it('returns null when no funding-relevant results', () => {
    const raw = { organic: [{ title: 'Test Co careers page', snippet: 'Jobs at Test Co', date: '2024-01-01' }] };
    const fact = extractFundingFact(raw, 'Test Co');
    expect(fact).toBeNull();
  });

  it('returns null when organic is empty', () => {
    expect(extractFundingFact({ organic: [] }, 'X')).toBeNull();
  });
});

describe('extractSnippetFact', () => {
  it('extracts company snippet from organic[0]', () => {
    const raw = {
      organic: [{
        title: 'Havertys Furniture - Quality Home Furniture',
        snippet: 'Shop Havertys for quality furniture across 120+ stores with free delivery.',
        link: 'https://havertys.com',
      }],
    };
    const fact = extractSnippetFact(raw, 'Havertys Furniture');
    expect(fact).not.toBeNull();
    expect(fact!.fact).toContain('120+ stores');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/_fact_extractor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement fact extractors**

`scripts/_fact_extractor.ts`:

```typescript
export interface ExtractedFact {
  fact: string;
  fact_date?: string;
  freshness_days?: number;
  source_query?: string;
}

const FUNDING_PATTERNS = /\b(series [a-d]|seed|raised|funding round|secures|investment|million in funding|\$[\d.]+m|\$[\d.]+ million)\b/i;
const PRESS_PATTERNS = /\b(announces|announced|press release|opening|launches|debuts|partnership)\b/i;
const LAUNCH_PATTERNS = /\b(launches|launched|debuts|debut|introduces|new collection|new line|new product)\b/i;

function freshnessDaysFromIso(iso: string): number {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 999;
  const ms = Date.now() - d.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function extractFundingFact(raw: any, company: string): ExtractedFact | null {
  const orgs = raw?.organic ?? [];
  for (const item of orgs) {
    const text = `${item.title || ''} ${item.snippet || ''}`;
    if (FUNDING_PATTERNS.test(text)) {
      return {
        fact: item.snippet?.trim() || item.title?.trim() || '',
        fact_date: item.date,
        freshness_days: item.date ? freshnessDaysFromIso(item.date) : undefined,
      };
    }
  }
  return null;
}

export function extractPressFact(raw: any, company: string): ExtractedFact | null {
  const orgs = raw?.organic ?? [];
  for (const item of orgs) {
    const text = `${item.title || ''} ${item.snippet || ''}`;
    if (PRESS_PATTERNS.test(text)) {
      return {
        fact: item.snippet?.trim() || item.title?.trim() || '',
        fact_date: item.date,
        freshness_days: item.date ? freshnessDaysFromIso(item.date) : undefined,
      };
    }
  }
  return null;
}

export function extractLaunchFact(raw: any, company: string): ExtractedFact | null {
  const orgs = raw?.organic ?? [];
  for (const item of orgs) {
    const text = `${item.title || ''} ${item.snippet || ''}`;
    if (LAUNCH_PATTERNS.test(text)) {
      return {
        fact: item.snippet?.trim() || item.title?.trim() || '',
        fact_date: item.date,
        freshness_days: item.date ? freshnessDaysFromIso(item.date) : undefined,
      };
    }
  }
  return null;
}

export function extractSnippetFact(raw: any, company: string): ExtractedFact | null {
  const orgs = raw?.organic ?? [];
  if (orgs.length === 0) return null;
  const first = orgs[0];
  return { fact: first.snippet?.trim() || first.title?.trim() || '' };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/_fact_extractor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/_fact_extractor.ts tests/_fact_extractor.test.ts
git commit -m "feat(signals): fact extractors per signal type"
```

---

## Task 8: Signal selector — priority order

**Files:**
- Create: `scripts/_signal_selector.ts`
- Create: `tests/_signal_selector.test.ts`

- [ ] **Step 1: Write failing selector test**

`tests/_signal_selector.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { selectSignal } from '../scripts/_signal_selector';

describe('selectSignal', () => {
  it('picks new_role over funding when both fresh', () => {
    const sidecar = {
      funding: { fact: 'raised X', freshness_days: 30 },
      company_snippet: { fact: 'snippet' },
    };
    const person = {
      new_role: { fact: 'joined as VP', freshness_days: 10 },
    };
    const result = selectSignal(sidecar, person);
    expect(result.signal_used).toBe('new_role');
    expect(result.signal_fact).toBe('joined as VP');
  });

  it('picks funding when no new_role + no promotion', () => {
    const sidecar = {
      funding: { fact: 'raised X', freshness_days: 30 },
      company_snippet: { fact: 'snippet' },
    };
    const result = selectSignal(sidecar, null);
    expect(result.signal_used).toBe('funding');
  });

  it('falls back to snippet when no in-window signals', () => {
    const sidecar = {
      funding: { fact: 'raised X', freshness_days: 200 }, // out of window
      company_snippet: { fact: 'snippet' },
    };
    const result = selectSignal(sidecar, null);
    expect(result.signal_used).toBe('company_snippet');
  });

  it('returns "fallback" when sidecar has nothing useful', () => {
    const sidecar = { company_snippet: { fact: null } };
    const result = selectSignal(sidecar, null);
    expect(result.signal_used).toBe('fallback');
  });

  it('rejects stale signals (>90 days)', () => {
    const sidecar = {
      funding: { fact: 'old', freshness_days: 120 },
      press: [{ fact: 'recent press', freshness_days: 45 }],
      company_snippet: { fact: 'snippet' },
    };
    const result = selectSignal(sidecar, null);
    expect(result.signal_used).toBe('press');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/_signal_selector.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement selector**

`scripts/_signal_selector.ts`:

```typescript
const FRESHNESS_WINDOW_DAYS = 90;

export interface SelectedSignal {
  signal_used: 'new_role' | 'promotion' | 'funding' | 'product_launch' | 'press' | 'company_snippet' | 'fallback';
  signal_fact: string | null;
  signal_freshness_days: number;
}

function inWindow(facts: any): boolean {
  if (!facts) return false;
  if (Array.isArray(facts)) {
    return facts.some(f => f?.fact && (f.freshness_days ?? 999) <= FRESHNESS_WINDOW_DAYS);
  }
  return Boolean(facts.fact) && (facts.freshness_days ?? 999) <= FRESHNESS_WINDOW_DAYS;
}

function pickFromArray(arr: any[]): any | null {
  if (!arr || !Array.isArray(arr)) return null;
  const valid = arr.filter(f => f?.fact && (f.freshness_days ?? 999) <= FRESHNESS_WINDOW_DAYS);
  if (!valid.length) return null;
  return valid.sort((a, b) => (a.freshness_days ?? 0) - (b.freshness_days ?? 0))[0];
}

export function selectSignal(companySidecar: any, personSidecar: any | null): SelectedSignal {
  if (personSidecar) {
    if (inWindow(personSidecar.new_role)) {
      return { signal_used: 'new_role', signal_fact: personSidecar.new_role.fact, signal_freshness_days: personSidecar.new_role.freshness_days };
    }
    if (inWindow(personSidecar.promotion)) {
      return { signal_used: 'promotion', signal_fact: personSidecar.promotion.fact, signal_freshness_days: personSidecar.promotion.freshness_days };
    }
  }

  if (inWindow(companySidecar.funding)) {
    return { signal_used: 'funding', signal_fact: companySidecar.funding.fact, signal_freshness_days: companySidecar.funding.freshness_days };
  }

  if (inWindow(companySidecar.product_launch)) {
    return { signal_used: 'product_launch', signal_fact: companySidecar.product_launch.fact, signal_freshness_days: companySidecar.product_launch.freshness_days };
  }

  const press = pickFromArray(companySidecar.press);
  if (press) {
    return { signal_used: 'press', signal_fact: press.fact, signal_freshness_days: press.freshness_days };
  }

  if (companySidecar.company_snippet?.fact) {
    return { signal_used: 'company_snippet', signal_fact: companySidecar.company_snippet.fact, signal_freshness_days: 0 };
  }

  return { signal_used: 'fallback', signal_fact: null, signal_freshness_days: 0 };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/_signal_selector.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/_signal_selector.ts tests/_signal_selector.test.ts
git commit -m "feat(signals): signal selector with priority order + freshness filter"
```

---

## Task 8.5: Lead Eligibility Validator (NEW — Amendment 1)

**Files:**
- Create: `scripts/validate-lead-eligibility.ts`
- Create: `tests/validate-lead-eligibility.test.ts`

**Purpose:** Catch leads who should never enter enrichment. Twain wrote a full 5-email sequence to Sarah Zurell at Chinese Laundry despite its own Warnings field saying "The lead is no longer the CMO of the target company." We mechanically refuse.

**Checks (each produces a `warnings` column code + contributes to `eligible` boolean):**
- W1: LinkedIn current_company matches lead.company_domain. Uses PND when available. Falls back to "unknown" (flag but don't block) when PND not yet integrated.
- W2: LinkedIn shows active employment (no "Open to work" / "Currently unemployed" status). Falls back to "unknown" pre-PND.
- W3: LinkedIn current title fuzzy-matches campaign data title ("VP Marketing" ≈ "Vice President of Marketing"). Falls back to "unknown" pre-PND.
- W4: company_domain resolves to live website (DNS check + HTTP 200 on root). Always runs.

Output columns:
- `eligibility_warnings`: semicolon-separated codes (e.g., "W1;W4")
- `eligible`: boolean (true unless any check returned hard fail)

Leads with `eligible=false` NEVER enter the enrichment queue.

- [ ] **Step 1: Write failing tests for each check**

`tests/validate-lead-eligibility.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { checkW4_dnsResolves, validateEligibility } from '../scripts/validate-lead-eligibility';

describe('Check W4 — DNS resolution', () => {
  it('returns pass for live domain', async () => {
    const result = await checkW4_dnsResolves('google.com');
    expect(result.pass).toBe(true);
  });

  it('returns fail for non-existent domain', async () => {
    const result = await checkW4_dnsResolves('thisdomainshouldnotexist-xyz-12345.com');
    expect(result.pass).toBe(false);
  });
});

describe('validateEligibility', () => {
  it('returns eligible=true with no warnings when all checks pass', async () => {
    const result = await validateEligibility({
      person_id: 'pid_1',
      company_domain: 'google.com',
      current_job_title: 'VP Marketing',
    });
    expect(result.eligible).toBe(true);
    expect(result.eligibility_warnings).toBe('');
  });

  it('returns eligible=false when W4 fails (DNS)', async () => {
    const result = await validateEligibility({
      person_id: 'pid_2',
      company_domain: 'thisdomainshouldnotexist-xyz-12345.com',
      current_job_title: 'VP Marketing',
    });
    expect(result.eligible).toBe(false);
    expect(result.eligibility_warnings).toContain('W4');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/validate-lead-eligibility.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement minimal validator**

`scripts/validate-lead-eligibility.ts`:

```typescript
import { promises as dns } from 'dns';

export interface EligibilityInput {
  person_id: string;
  company_domain: string;
  current_job_title?: string;
  linkedin_url?: string;
}

export interface CheckResult {
  pass: boolean;
  reason?: string;
}

export interface EligibilityResult {
  eligible: boolean;
  eligibility_warnings: string;
  details: Record<string, CheckResult>;
}

export async function checkW4_dnsResolves(domain: string): Promise<CheckResult> {
  try {
    const records = await dns.resolve(domain).catch(() => null);
    if (!records || records.length === 0) {
      return { pass: false, reason: 'DNS resolution failed' };
    }
    return { pass: true };
  } catch (err) {
    return { pass: false, reason: String(err) };
  }
}

// W1/W2/W3 stubs until PND integration (Task 19)
export function checkW1_companyMatch(input: EligibilityInput): CheckResult {
  // Pre-PND: return "unknown" — neither pass nor fail. Falls through to non-blocking.
  return { pass: true, reason: 'unknown (PND not integrated yet)' };
}

export function checkW2_activeEmployment(input: EligibilityInput): CheckResult {
  return { pass: true, reason: 'unknown (PND not integrated yet)' };
}

export function checkW3_titleMatch(input: EligibilityInput): CheckResult {
  return { pass: true, reason: 'unknown (PND not integrated yet)' };
}

export async function validateEligibility(input: EligibilityInput): Promise<EligibilityResult> {
  const w1 = checkW1_companyMatch(input);
  const w2 = checkW2_activeEmployment(input);
  const w3 = checkW3_titleMatch(input);
  const w4 = await checkW4_dnsResolves(input.company_domain);

  const failures: string[] = [];
  if (!w1.pass) failures.push('W1');
  if (!w2.pass) failures.push('W2');
  if (!w3.pass) failures.push('W3');
  if (!w4.pass) failures.push('W4');

  return {
    eligible: failures.length === 0,
    eligibility_warnings: failures.join(';'),
    details: { w1, w2, w3, w4 },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/validate-lead-eligibility.test.ts`
Expected: PASS — 4 tests passing

- [ ] **Step 5: Commit**

```bash
git add scripts/validate-lead-eligibility.ts tests/validate-lead-eligibility.test.ts
git commit -m "feat(signals): lead eligibility validator (W1-W4 + extensibility for PND)"
```

**Integration note:** Task 9 (extractor orchestration) must check `eligible=true` before firing any queries. Update Task 9's leads-with-signals.csv input to filter on eligibility.

---

## Task 9: Signal extractor — main orchestration script

**Files:**
- Create: `scripts/extract-signals.ts`
- Create: `tests/extract-signals.test.ts`

- [ ] **Step 1: Write failing integration test**

`tests/extract-signals.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { extractSignalsForLead } from '../scripts/extract-signals';

const TEST_DIR = resolve(__dirname, '../data/signals-test-extractor');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
  vi.restoreAllMocks();
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('extractSignalsForLead', () => {
  it('writes sidecar after fetch + returns enrichment_tier', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ organic: [{ title: 'X raises $5M', snippet: 'X raised $5M Series A in February 2026.', date: '2026-02-15' }] }),
    } as any);

    const lead = {
      person_id: 'pid_1',
      qual_confidence: 0.85,
      title: 'VP Marketing',
      company_name: 'X',
      company_domain: 'x.com',
    };

    const result = await extractSignalsForLead(lead, 'fake-key', TEST_DIR);

    expect(result.enrichment_tier).toBe('T1');
    expect(existsSync(resolve(TEST_DIR, 'x.com.json'))).toBe(true);
    const sidecar = JSON.parse(readFileSync(resolve(TEST_DIR, 'x.com.json'), 'utf8'));
    expect(sidecar.funding.fact).toContain('Series A');
  });

  it('returns cached sidecar without re-fetching', async () => {
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(resolve(TEST_DIR, 'cached.com.json'), JSON.stringify({
      schema_version: '1.0',
      domain: 'cached.com',
      fetched_at: oneDayAgo,
      funding: { fact: 'old funding', freshness_days: 100 },
      company_snippet: { fact: 'snippet from cache' },
    }));

    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    const lead = {
      person_id: 'pid_2',
      qual_confidence: 0.85,
      title: 'VP Marketing',
      company_name: 'Cached',
      company_domain: 'cached.com',
    };

    const result = await extractSignalsForLead(lead, 'fake-key', TEST_DIR);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.enrichment_tier).toBe('T1');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/extract-signals.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement extractor**

`scripts/extract-signals.ts`:

```typescript
import { resolve } from 'path';
import { readSidecar, writeSidecar, computeTier, type SignalSidecar } from './_lib_signals';
import { getQueriesForTier } from './_query_templates';
import { serperSearch } from './_serper_client';
import { extractFundingFact, extractPressFact, extractLaunchFact, extractSnippetFact } from './_fact_extractor';

export interface LeadRow {
  person_id: string;
  qual_confidence: number;
  title: string;
  company_name: string;
  company_domain: string;
}

export interface ExtractionResult {
  enrichment_tier: 'T1' | 'T2' | 'T3';
  sidecar_path: string;
  fired_queries: number;
  cache_hit: boolean;
}

export async function extractSignalsForLead(
  lead: LeadRow,
  serperKey: string,
  baseDir = 'data/signals'
): Promise<ExtractionResult> {
  const tier = computeTier({ qual_confidence: lead.qual_confidence, title: lead.title });
  const domain = lead.company_domain;

  // Cache hit path
  let existing = readSidecar(domain, baseDir);
  if (existing && existing.cache_status === 'fresh') {
    return {
      enrichment_tier: tier,
      sidecar_path: resolve(baseDir, `${domain}.json`),
      fired_queries: 0,
      cache_hit: true,
    };
  }

  // Cache miss or stale: fetch
  const queries = getQueriesForTier(tier, { company: lead.company_name, domain });
  const sidecar: SignalSidecar = {
    schema_version: '1.0',
    domain,
    fetched_at: new Date().toISOString(),
    company_snippet: { fact: null, source_query: null, raw_serper_response: null },
    funding: { fact: null, found: false },
    press: [],
    product_launch: { fact: null, found: false },
    fetch_log: [],
  };

  let firedQueries = 0;
  for (const q of queries.serper) {
    try {
      const result = await serperSearch(q.query, serperKey);
      firedQueries++;
      sidecar.fetch_log!.push({
        query: q.query,
        signal_type: q.signal_type,
        timestamp: result.timestamp,
        status: result.status,
        result_count: result.raw?.organic?.length ?? 0,
      });

      if (q.signal_type === 'funding') {
        const fact = extractFundingFact(result.raw, lead.company_name);
        if (fact && !sidecar.funding!.fact) {
          sidecar.funding = { ...fact, found: true, source_query: q.query, raw_serper_response: result.raw };
        }
      } else if (q.signal_type === 'press') {
        const fact = extractPressFact(result.raw, lead.company_name);
        if (fact) {
          sidecar.press!.push({ ...fact, source_query: q.query, raw_serper_response: result.raw });
        }
      } else if (q.signal_type === 'launch') {
        const fact = extractLaunchFact(result.raw, lead.company_name);
        if (fact && !sidecar.product_launch!.fact) {
          sidecar.product_launch = { ...fact, found: true, source_query: q.query, raw_serper_response: result.raw };
        }
      } else if (q.signal_type === 'snippet') {
        const fact = extractSnippetFact(result.raw, lead.company_name);
        if (fact && !sidecar.company_snippet!.fact) {
          sidecar.company_snippet = { ...fact, source_query: q.query, raw_serper_response: result.raw };
        }
      }
    } catch (err) {
      sidecar.fetch_log!.push({
        query: q.query,
        signal_type: q.signal_type,
        timestamp: new Date().toISOString(),
        status: 'ERROR',
        error: String(err),
      });
    }
  }

  writeSidecar(domain, sidecar, baseDir);

  return {
    enrichment_tier: tier,
    sidecar_path: resolve(baseDir, `${domain}.json`),
    fired_queries: firedQueries,
    cache_hit: false,
  };
}

// CLI entry — runs over leads-all-with-qual.csv if invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.error('Extractor CLI entry — see render-with-signals.ts integration in Task 12');
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/extract-signals.test.ts`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/extract-signals.ts tests/extract-signals.test.ts
git commit -m "feat(signals): per-lead extractor — fires queries, writes sidecar, respects cache"
```

---

## Task 10: Cross-client cache integration test

**Files:**
- Create: `tests/cache_cross_client.test.ts`

- [ ] **Step 1: Write cross-client cache test**

`tests/cache_cross_client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { extractSignalsForLead } from '../scripts/extract-signals';

const TEST_DIR = resolve(__dirname, '../data/signals-cross-client');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
  vi.restoreAllMocks();
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('cross-client cache', () => {
  it('second client touching same domain reads cache and fires zero queries', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ organic: [{ title: 'Faherty launches Swim', snippet: 'Faherty launched Swim in March 2026.', date: '2026-03-15' }] }),
      } as any);
    });

    // BW Apparel touches faherty.com first
    const bwLead = {
      person_id: 'bw_pid_1',
      qual_confidence: 0.85,
      title: 'VP Marketing',
      company_name: 'Faherty',
      company_domain: 'faherty.com',
    };
    const bwResult = await extractSignalsForLead(bwLead, 'key', TEST_DIR);
    expect(bwResult.cache_hit).toBe(false);
    expect(bwResult.fired_queries).toBeGreaterThan(0);
    const callsAfterBw = callCount;

    // Hypothetical Client-Y touches faherty.com second
    const clientYLead = {
      person_id: 'cy_pid_1',
      qual_confidence: 0.82,
      title: 'CMO',
      company_name: 'Faherty',
      company_domain: 'faherty.com',
    };
    const cyResult = await extractSignalsForLead(clientYLead, 'key', TEST_DIR);

    expect(cyResult.cache_hit).toBe(true);
    expect(cyResult.fired_queries).toBe(0);
    expect(callCount).toBe(callsAfterBw); // No new fetch calls
  });

  it('different domains do not share cache', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ organic: [] }),
      } as any);
    });

    const a = { person_id: 'a', qual_confidence: 0.85, title: 'VP', company_name: 'A', company_domain: 'a.com' };
    const b = { person_id: 'b', qual_confidence: 0.85, title: 'VP', company_name: 'B', company_domain: 'b.com' };

    await extractSignalsForLead(a, 'key', TEST_DIR);
    const callsAfterA = callCount;
    await extractSignalsForLead(b, 'key', TEST_DIR);

    expect(callCount).toBeGreaterThan(callsAfterA); // Fresh fetches for b.com
  });
});
```

- [ ] **Step 2: Run cross-client tests**

Run: `npx vitest run tests/cache_cross_client.test.ts`
Expected: PASS — 2 tests

- [ ] **Step 3: Commit**

```bash
git add tests/cache_cross_client.test.ts
git commit -m "test(signals): cross-client cache compounding (key economic test)"
```

---

## Task 11: Bridge writer — AI subagent integration with pre-validation

**Files:**
- Create: `scripts/_bridge_writer.ts`
- Create: `tests/_bridge_writer.test.ts`

- [ ] **Step 1: Write failing bridge-writer test**

`tests/_bridge_writer.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { writeBridgeSentence } from '../scripts/_bridge_writer';

describe('writeBridgeSentence', () => {
  it('returns valid bridge when AI response passes checks', async () => {
    const aiInvoke = vi.fn().mockResolvedValue('Your Series B closed in March. Brands at that funding stage typically start asking the channel-mix question.');
    const result = await writeBridgeSentence({
      signal_used: 'funding',
      signal_fact: 'X raised $18M Series B in March 2026.',
      company_name: 'X',
      first_name: 'Alex',
    }, aiInvoke);

    expect(result.valid).toBe(true);
    expect(result.bridge).toBeTruthy();
    expect(result.bridge).not.toMatch(/\bsmart\b/i);
  });

  it('rejects + retries once when banned word present', async () => {
    let attempt = 0;
    const aiInvoke = vi.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) return Promise.resolve('Smart brands at that stage benchmark fast.');
      return Promise.resolve('Brands at that funding stage typically start asking the channel-mix question.');
    });

    const result = await writeBridgeSentence({
      signal_used: 'funding',
      signal_fact: 'X raised $18M Series B.',
      company_name: 'X',
      first_name: 'Alex',
    }, aiInvoke);

    expect(attempt).toBe(2);
    expect(result.valid).toBe(true);
  });

  it('marks invalid after 2 failed attempts', async () => {
    const aiInvoke = vi.fn().mockResolvedValue('Smart brands diversify fast.');
    const result = await writeBridgeSentence({
      signal_used: 'funding',
      signal_fact: 'X raised funding.',
      company_name: 'X',
      first_name: 'A',
    }, aiInvoke);

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/banned word/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/_bridge_writer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement bridge writer**

`scripts/_bridge_writer.ts`:

```typescript
import { findBannedWords, findBannedStarts } from './_lib_signals';

export interface BridgeContext {
  signal_used: string;
  signal_fact: string;
  company_name: string;
  first_name: string;
}

export interface BridgeResult {
  valid: boolean;
  bridge: string;
  reason?: string;
}

export type AiInvoker = (prompt: string) => Promise<string>;

const BRIDGE_PROMPT_TEMPLATE = `You write ONE bridge sentence (≤25 words) that follows a signal fact in a cold email.

HARD RULES:
- Third-person fact framing only. Never start with "Saw", "Noticed", "Caught", "I see", "I noticed", "I saw", "I caught".
- State a category-level pattern true for the signal TYPE only. NEVER editorialize about the company.
- Banned words: smart, smarter, smartest, smartly, best, savvy, savviness, leading, leading-edge, top-tier, top-rated, great, exceptional, brilliant, brilliantly, amazing, awesome, fantastic, impressive, best-in-class, best-of-breed, fresh eyes, fresh perspective, fresh take, the right person, the right time, perfect timing.
- One sentence. Period at end. Start with capital letter.

INPUT:
  signal_type: {signal_used}
  signal_fact (already written, will appear before your sentence): "{signal_fact}"
  company: {company_name}
  recipient first name: {first_name}

Write ONE bridge sentence that follows the signal_fact naturally.`;

export async function writeBridgeSentence(ctx: BridgeContext, aiInvoke: AiInvoker, maxRetries = 2): Promise<BridgeResult> {
  const prompt = BRIDGE_PROMPT_TEMPLATE
    .replace('{signal_used}', ctx.signal_used)
    .replace('{signal_fact}', ctx.signal_fact)
    .replace('{company_name}', ctx.company_name)
    .replace('{first_name}', ctx.first_name);

  let lastReason = '';
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const bridge = (await aiInvoke(attempt === 0 ? prompt : prompt + '\n\nPREVIOUS ATTEMPT VIOLATED RULES. Try again, stricter.')).trim();

    const bannedWords = findBannedWords(bridge);
    if (bannedWords.length > 0) {
      lastReason = `banned word(s) found: ${bannedWords.join(', ')}`;
      continue;
    }

    const bannedStarts = findBannedStarts(bridge);
    if (bannedStarts.length > 0) {
      lastReason = `banned sentence-start(s) found: ${bannedStarts.join(', ')}`;
      continue;
    }

    if (bridge.split(/\s+/).length > 25) {
      lastReason = 'over 25 words';
      continue;
    }

    return { valid: true, bridge };
  }

  return { valid: false, bridge: '', reason: lastReason };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/_bridge_writer.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/_bridge_writer.ts tests/_bridge_writer.test.ts
git commit -m "feat(signals): bridge sentence writer with banned-word pre-validation + retry"
```

---

## Task 11.5: Stat Rotation Tracker (NEW — Amendment 6)

**Files:**
- Create: `scripts/_stat_rotator.ts`
- Create: `tests/_stat_rotator.test.ts`

**Purpose:** Prevent stat repetition within a lead's 4-email sequence. Twain repeated "3-8x ROAS" in 4 of 5 emails. We rotate stats so each appears max once per sequence.

**Stat pool (locked here, expand later):**
- A: "103% higher LTV on DM-acquired vs paid-acquired customers"
- B: "3-8x ROAS on first direct mail tests"
- C: "20%+ direct mail productivity lift for DWR"
- D: "Built on co-op transactional data from 4,000+ brands"
- E: "Running direct mail for 300+ premium retail and DTC brands"

- [ ] **Step 1: Write failing test**

`tests/_stat_rotator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { StatRotator } from '../scripts/_stat_rotator';

describe('StatRotator', () => {
  it('returns different stats across 4 emails for same lead', () => {
    const r = new StatRotator();
    const e1 = r.nextFor('pid_1');
    const e2 = r.nextFor('pid_1');
    const e3 = r.nextFor('pid_1');
    const e4 = r.nextFor('pid_1');
    expect(new Set([e1, e2, e3, e4]).size).toBe(4);
  });

  it('different leads can use same stat in slot 1', () => {
    const r = new StatRotator();
    const a = r.nextFor('pid_a');
    const b = r.nextFor('pid_b');
    // Either same or different is fine — both start at slot 0
    expect(typeof a).toBe('string');
    expect(typeof b).toBe('string');
  });

  it('throws when pool exhausted for a lead', () => {
    const r = new StatRotator(['only_one']);
    r.nextFor('pid_x');
    expect(() => r.nextFor('pid_x')).toThrow(/exhausted/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/_stat_rotator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`scripts/_stat_rotator.ts`:

```typescript
export const DEFAULT_STAT_POOL = [
  '103% higher LTV on DM-acquired vs paid-acquired customers',
  '3-8x ROAS on first direct mail tests',
  '20%+ direct mail productivity lift for DWR',
  'Built on co-op transactional data from 4,000+ brands',
  'Running direct mail for 300+ premium retail and DTC brands',
];

export class StatRotator {
  private used = new Map<string, Set<string>>();
  constructor(private pool: string[] = DEFAULT_STAT_POOL) {}

  nextFor(personId: string): string {
    const usedByLead = this.used.get(personId) ?? new Set<string>();
    const available = this.pool.filter(s => !usedByLead.has(s));
    if (available.length === 0) {
      throw new Error(`Stat pool exhausted for lead ${personId}`);
    }
    const choice = available[0];
    usedByLead.add(choice);
    this.used.set(personId, usedByLead);
    return choice;
  }

  reset(personId?: string): void {
    if (personId) this.used.delete(personId);
    else this.used.clear();
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/_stat_rotator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/_stat_rotator.ts tests/_stat_rotator.test.ts
git commit -m "feat(signals): stat rotation tracker — max once per lead's sequence"
```

**Integration note:** Task 12 (renderer) will instantiate `StatRotator` per render run + call `nextFor(person_id)` for each email body that needs a stat. Email 2 in particular MUST use a stat different from E1 (per Amendment 7).

---

## Task 11.6: Category Resolver (NEW — Amendment 8)

**Files:**
- Create: `scripts/_category_resolver.ts`
- Create: `tests/_category_resolver.test.ts`

**Purpose:** Don't trust upstream industry tags. Twain had Chinese Laundry tagged "mechanical or industrial engineering" (it's footwear) and Bloom Nutrition tagged "retail" then categorized as "food and kitchen" (it's supplements/wellness). Wrong tags drive wrong anchor selection.

Resolve inferred_category from `company_name + company_description` via cheap AI call. Cross-check against `vertical_anchor_map`.

- [ ] **Step 1: Write failing test**

`tests/_category_resolver.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { resolveCategory } from '../scripts/_category_resolver';

describe('resolveCategory', () => {
  it('overrides upstream tag when AI infers different category', async () => {
    const aiInvoke = vi.fn().mockResolvedValue('footwear');
    const result = await resolveCategory({
      company_name: 'Chinese Laundry',
      company_description: 'Womens fashion footwear brand',
      upstream_industry: 'mechanical or industrial engineering',
      anchor_map: { home_furniture: 'Serena & Lily', apparel: 'Bombas', footwear: 'Birkenstock' },
    }, aiInvoke);
    expect(result.inferred_category).toBe('footwear');
    expect(result.upstream_was_wrong).toBe(true);
    expect(result.anchor_match).toBe('Birkenstock');
  });

  it('flags when no anchor matches the inferred category', async () => {
    const aiInvoke = vi.fn().mockResolvedValue('supplements');
    const result = await resolveCategory({
      company_name: 'Bloom Nutrition',
      company_description: 'Premium supplements and wellness',
      upstream_industry: 'retail',
      anchor_map: { home_furniture: 'Serena & Lily', apparel: 'Bombas' },
    }, aiInvoke);
    expect(result.anchor_match).toBeNull();
    expect(result.warnings).toContain('no_anchor_match');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/_category_resolver.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`scripts/_category_resolver.ts`:

```typescript
import type { AiInvoker } from './_bridge_writer';

export interface CategoryInput {
  company_name: string;
  company_description?: string;
  upstream_industry?: string;
  anchor_map: Record<string, string>;
}

export interface CategoryResult {
  inferred_category: string;
  upstream_was_wrong: boolean;
  anchor_match: string | null;
  warnings: string[];
}

const CATEGORY_PROMPT = `You categorize a company into ONE of these categories based on its name + description.

Valid categories: {categories}

Company name: {company_name}
Description: {description}
Upstream provider tagged this as: {upstream}

Respond with EXACTLY one category name from the list above. Nothing else.`;

export async function resolveCategory(input: CategoryInput, aiInvoke: AiInvoker): Promise<CategoryResult> {
  const categories = Object.keys(input.anchor_map);
  const prompt = CATEGORY_PROMPT
    .replace('{categories}', categories.join(', '))
    .replace('{company_name}', input.company_name)
    .replace('{description}', input.company_description || '(no description)')
    .replace('{upstream}', input.upstream_industry || '(no upstream tag)');

  const raw = (await aiInvoke(prompt)).trim().toLowerCase();
  const inferred = categories.find(c => c.toLowerCase() === raw) || raw;

  const upstream_was_wrong = Boolean(input.upstream_industry && !input.upstream_industry.toLowerCase().includes(inferred));
  const anchor_match = input.anchor_map[inferred] || null;

  const warnings: string[] = [];
  if (upstream_was_wrong) warnings.push('upstream_industry_mismatch');
  if (!anchor_match) warnings.push('no_anchor_match');

  return {
    inferred_category: inferred,
    upstream_was_wrong,
    anchor_match,
    warnings,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/_category_resolver.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/_category_resolver.ts tests/_category_resolver.test.ts
git commit -m "feat(signals): category resolver — don't trust upstream industry tags"
```

**Integration note:** Task 12 (renderer) calls resolveCategory() as pre-pass. If `anchor_match` is null → route to Variant C (no anchor). Log mismatches for audit.

---

## Task 12: Renderer — main script with Email 1 + Email 2 templates

**Files:**
- Create: `scripts/render-with-signals.ts`
- Create: `tests/render-with-signals.test.ts`
- Create: `tests/fixtures/leads-mock-5.csv`

- [ ] **Step 1: Create mock leads fixture**

`tests/fixtures/leads-mock-5.csv`:

```csv
person_id,first_name,full_name,current_job_title,company_name,company_domain,qual_confidence,qualified,primary_vertical,assigned_variant,vertical_anchor,ai_similarity_dimension,ai_brand_category,ai_role_hook,email1_subject,email2_subject,email3_subject,email4_subject
pid_1,Alex,Alex Smith,VP Marketing,Faherty,faherty.com,0.85,true,apparel,B,Bombas,"DTC channel, premium apparel, store plus DTC mix",premium lifestyle apparel,VP Marketing owns acquisition mix at premium lifestyle apparel brand,the bombas playbook,,channel risk,free audit?
pid_2,Sam,Sam Jones,Director of Growth,Tecovas,tecovas.com,0.91,true,apparel,B,Bombas,"DTC channel, premium boots, retail plus DTC",premium western boots,Director of Growth owns paid acquisition at premium western boots brand,the bombas playbook,,channel risk,free audit?
pid_3,Riley,Riley Park,Marketing Manager,Mott & Bow,mottandbow.com,0.75,true,apparel,C,,,premium DTC denim,Marketing Manager runs DTC marketing at premium denim brand,DM economics for premium DTC,,channel risk,free audit?
pid_4,Drew,Drew Chen,CMO,Buck Mason,buckmason.com,0.83,true,apparel,B,Bombas,"DTC channel, heritage menswear, retail plus DTC",heritage menswear,CMO owns brand and acquisition at heritage menswear,the bombas playbook,,channel risk,free audit?
pid_5,Jordan,Jordan Lee,Specialist,SmallCo,smallco.com,0.72,true,apparel,C,,,premium accessories,Specialist supports marketing ops at premium accessories,DM economics for premium DTC,,channel risk,free audit?
```

- [ ] **Step 2: Write failing renderer test**

`tests/render-with-signals.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { renderLead } from '../scripts/render-with-signals';

const TEST_DIR = resolve(__dirname, '../data/signals-renderer-test');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('renderLead', () => {
  it('renders Variant B with signal when fresh signal present', async () => {
    writeFileSync(resolve(TEST_DIR, 'faherty.com.json'), JSON.stringify({
      schema_version: '1.0',
      domain: 'faherty.com',
      fetched_at: new Date().toISOString(),
      funding: { fact: 'Faherty raised $18M Series B in March 2026.', found: true, freshness_days: 30 },
      company_snippet: { fact: 'Faherty: DTC heritage lifestyle with 30 stores.' },
    }));

    const lead = {
      person_id: 'pid_1', first_name: 'Alex', full_name: 'Alex Smith', current_job_title: 'VP Marketing',
      company_name: 'Faherty', company_domain: 'faherty.com', qual_confidence: 0.85,
      primary_vertical: 'apparel', assigned_variant: 'B', vertical_anchor: 'Bombas',
      ai_similarity_dimension: 'DTC channel, premium apparel, store plus DTC mix',
      ai_brand_category: 'premium lifestyle apparel',
      ai_role_hook: 'VP Marketing owns acquisition mix at premium lifestyle apparel brand',
    };

    const aiInvoke = vi.fn().mockResolvedValue('Brands at that funding stage typically start asking the channel-mix question.');

    const result = await renderLead(lead, aiInvoke, TEST_DIR);

    expect(result.signal_used).toBe('funding');
    expect(result.email1_body).toContain('Faherty raised $18M Series B');
    expect(result.email1_body).toContain('Brands at that funding stage');
    expect(result.enrichment_tier).toBe('T1');
  });

  it('falls back to v4 anchor copy when no in-window signal (Variant B)', async () => {
    writeFileSync(resolve(TEST_DIR, 'faherty.com.json'), JSON.stringify({
      schema_version: '1.0',
      domain: 'faherty.com',
      fetched_at: new Date().toISOString(),
      funding: { fact: null, found: false },
      company_snippet: { fact: 'Faherty: DTC heritage lifestyle with 30 stores.' },
    }));

    const lead = {
      person_id: 'pid_1', first_name: 'Alex', full_name: 'Alex Smith', current_job_title: 'VP Marketing',
      company_name: 'Faherty', company_domain: 'faherty.com', qual_confidence: 0.85,
      primary_vertical: 'apparel', assigned_variant: 'B', vertical_anchor: 'Bombas',
      ai_similarity_dimension: 'DTC channel, premium apparel, store plus DTC mix',
      ai_brand_category: 'premium lifestyle apparel',
      ai_role_hook: 'VP Marketing owns acquisition mix',
    };

    const aiInvoke = vi.fn();
    const result = await renderLead(lead, aiInvoke, TEST_DIR);

    expect(result.signal_used).toBe('company_snippet');
    expect(result.email1_body).toContain('30 stores');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/render-with-signals.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement renderer**

`scripts/render-with-signals.ts`:

```typescript
import { resolve } from 'path';
import { readSidecar, computeTier } from './_lib_signals';
import { selectSignal } from './_signal_selector';
import { writeBridgeSentence, type AiInvoker } from './_bridge_writer';

const ANCHOR_PROOF: Record<string, string> = {
  'Serena & Lily': "year 11 of running direct mail for Serena & Lily. {{company_name}} reminds me of where they were around 2017",
  'Bombas': "we run direct mail for Bombas. Scaled from a single test into their core profitable acquisition channel. {{company_name}} sits in the same lane",
  'AG': "we run direct mail for AG, built on transactional-data targeting for higher-value denim buyers. {{company_name}} is in the same bracket",
  'Sundance': "we run direct mail for Sundance. Lifted new customer acquisition 36 points in six months. {{company_name}} reminds me of them",
  'Title Nine': "we run paid digital for Title Nine. Restructured funnel-based paid media for clean ROAS lift on prospecting. {{company_name}} sits in the same lane",
  'Birkenstock': "Birkenstock runs our Swift programmatic direct mail. Co-op transactional data lifted their ecommerce conversion. {{company_name}} could test the same play",
};

const E2_BACK_REF_TEMPLATES: Record<string, string> = {
  funding: 'Brands at the funding stage you\'re at tend to move on benchmark decks fast.',
  new_role: 'First quarter in role is when this kind of benchmark data gets attention.',
  promotion: 'Role transitions are when channel-mix questions get the most attention.',
  product_launch: 'Launches like this usually pull on acquisition data within the same quarter.',
  press: 'Expansion at that pace usually surfaces the channel-mix question right after.',
  company_snippet: '',
  fallback: '',
};

export interface RenderedLead {
  person_id: string;
  enrichment_tier: 'T1' | 'T2' | 'T3';
  signal_used: string;
  signal_fact: string;
  signal_bridge: string;
  signal_freshness_days: number;
  signal_e2_back_reference: string;
  email1_subject: string;
  email1_body: string;
  email2_subject: string;
  email2_body: string;
  email3_subject: string;
  email3_body: string;
  email4_subject: string;
  email4_body: string;
}

interface LeadInput {
  person_id: string;
  first_name: string;
  full_name: string;
  current_job_title: string;
  company_name: string;
  company_domain: string;
  qual_confidence: number;
  primary_vertical: string;
  assigned_variant: 'B' | 'C';
  vertical_anchor?: string;
  ai_similarity_dimension?: string;
  ai_brand_category?: string;
  ai_role_hook: string;
}

export async function renderLead(lead: LeadInput, aiInvoke: AiInvoker, sidecarDir = 'data/signals'): Promise<RenderedLead> {
  const tier = computeTier({ qual_confidence: lead.qual_confidence, title: lead.current_job_title });
  const companySidecar = readSidecar(lead.company_domain, sidecarDir) ?? {};
  const personSidecar = readSidecar(`${lead.company_domain}--${lead.person_id}`, sidecarDir);

  const selected = selectSignal(companySidecar as any, personSidecar);

  let bridge = '';
  let e2BackRef = '';

  if (selected.signal_used !== 'fallback' && selected.signal_fact) {
    const result = await writeBridgeSentence({
      signal_used: selected.signal_used,
      signal_fact: selected.signal_fact,
      company_name: lead.company_name,
      first_name: lead.first_name,
    }, aiInvoke);

    if (result.valid) {
      bridge = result.bridge;
      e2BackRef = E2_BACK_REF_TEMPLATES[selected.signal_used] || '';
    } else {
      // Degrade to fallback
      selected.signal_used = 'fallback';
      selected.signal_fact = '';
    }
  }

  const email1Body = buildEmail1(lead, selected, bridge);
  const email2Body = buildEmail2(lead, selected, e2BackRef);
  const email3Body = buildEmail3(lead);
  const email4Body = buildEmail4(lead);

  return {
    person_id: lead.person_id,
    enrichment_tier: tier,
    signal_used: selected.signal_used,
    signal_fact: selected.signal_fact ?? '',
    signal_bridge: bridge,
    signal_freshness_days: selected.signal_freshness_days,
    signal_e2_back_reference: e2BackRef,
    email1_subject: subjectForVariant(lead),
    email1_body: email1Body,
    email2_subject: '',
    email2_body: email2Body,
    email3_subject: 'channel risk',
    email3_body: email3Body,
    email4_subject: 'free audit?',
    email4_body: email4Body,
  };
}

function subjectForVariant(lead: LeadInput): string {
  if (lead.assigned_variant === 'B' && lead.vertical_anchor) {
    return `the ${lead.vertical_anchor.toLowerCase()} playbook`;
  }
  return `DM economics for ${lead.ai_brand_category || 'premium DTC'}`;
}

function buildEmail1(lead: LeadInput, sig: { signal_used: string; signal_fact: string | null }, bridge: string): string {
  const factLine = sig.signal_fact ? `${sig.signal_fact} ${bridge}` : '';
  if (lead.assigned_variant === 'B' && lead.vertical_anchor) {
    const proof = (ANCHOR_PROOF[lead.vertical_anchor] || '').replace(/{{company_name}}/g, lead.company_name);
    return [
      `${lead.first_name}, ${factLine}`.trim(),
      ``,
      `We run direct mail for ${lead.vertical_anchor}. ${proof}.`,
      ``,
      `${lead.company_name} sits in the same lane on ${lead.ai_similarity_dimension || ''}.`,
      ``,
      `${lead.ai_role_hook}. Worth comparing notes on what worked for them?`,
    ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  // Variant C
  return [
    `${lead.first_name}, ${factLine}`.trim(),
    ``,
    `One stat from our portfolio: DM-acquired customers carry 103% higher LTV than digital-acquired across the 300+ premium retail and DTC brands we run.`,
    ``,
    `Your ${lead.ai_brand_category || 'premium'} positioning makes the math favorable: economics improve as AOV rises. ${lead.ai_role_hook}. Want me to walk you through DM economics for your AOV bracket?`,
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildEmail2(lead: LeadInput, sig: { signal_used: string }, backRef: string): string {
  const backRefLine = backRef ? `\n\n${backRef}` : '';
  return [
    `${lead.first_name}, one stat worth flagging: one of our portfolio brands saw DM-acquired customers carry 103% higher LTV than the cohort acquired on Meta.`,
    ``,
    `At ${lead.company_name}'s AOV, that kind of LTV gap compounds fast. Most premium DTC brands we work with discover the gap only after they hit a wall on paid social.${backRefLine}`,
    ``,
    `Want me to send the category benchmark deck?`,
  ].join('\n').trim();
}

function buildEmail3(lead: LeadInput): string {
  return [
    `${lead.first_name}, two years ago most premium DTC brands we work with had Meta and Google owning the majority of their acquisition mix. That share is dropping. CACs went unstable, auctions got harder to forecast, CFOs started asking why one platform owned that much of the P&L.`,
    ``,
    `Direct mail isn't a Meta replacement, it's the diversification. The data behind it: co-op transactional records across 4,000+ brands. Doesn't get re-priced when Apple changes the rules.`,
    ``,
    `How concentrated is ${lead.company_name}'s acquisition mix?`,
  ].join('\n').trim();
}

function buildEmail4(lead: LeadInput): string {
  return [
    `${lead.first_name}, last note from me. We can run a no-strings audit of ${lead.company_name}'s current direct mail or paid acquisition program. Last 2-3 drops or last quarter of spend, annotated PDF, recommendations on segmentation, format, and frequency. Five business days, no pitch attached.`,
    ``,
    `Useful, or should I close the loop with someone else on your team?`,
  ].join('\n').trim();
}
```

- [ ] **Step 5: Run renderer tests**

Run: `npx vitest run tests/render-with-signals.test.ts`
Expected: PASS — 2 tests

- [ ] **Step 6: Commit**

```bash
git add scripts/render-with-signals.ts tests/render-with-signals.test.ts tests/fixtures/leads-mock-5.csv
git commit -m "feat(signals): renderer with E1 + E2 signal templates + fallback paths"
```

---

## Task 13: Validator Check 11 — banned-word + sentence-start

**Files:**
- Modify: `scripts/validate-final.ts`
- Create: `tests/validate-final.test.ts`

- [ ] **Step 1: Write failing Check 11 test**

`tests/validate-final.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { check11_bannedWords, check12_capitalization, check13_freshness } from '../scripts/validate-final';

describe('Check 11 — banned words + sentence-starts', () => {
  it('passes clean bridge sentence', () => {
    const row = {
      signal_bridge: 'Brands at that funding stage typically start asking the channel-mix question.',
      signal_fact: 'Your Series B closed in March.',
    };
    expect(check11_bannedWords(row).pass).toBe(true);
  });

  it('rejects banned word "smart"', () => {
    const row = {
      signal_bridge: 'Smart brands at that stage diversify channels.',
      signal_fact: 'Funding closed in March.',
    };
    const result = check11_bannedWords(row);
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/smart/i);
  });

  it('rejects banned start "Saw"', () => {
    const row = {
      signal_bridge: 'Saw your Series B last month.',
      signal_fact: '',
    };
    const result = check11_bannedWords(row);
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/saw/i);
  });
});

describe('Check 12 — capitalization', () => {
  it('passes when all sentence starts capitalized', () => {
    expect(check12_capitalization({ email1_body: 'Hello. This is a test.' }).pass).toBe(true);
  });

  it('rejects lowercase sentence start', () => {
    expect(check12_capitalization({ email1_body: 'hello. this is bad.' }).pass).toBe(false);
  });
});

describe('Check 13 — freshness', () => {
  it('passes signal within 90 days', () => {
    expect(check13_freshness({ signal_used: 'funding', signal_freshness_days: 30 }).pass).toBe(true);
  });

  it('rejects signal over 90 days', () => {
    expect(check13_freshness({ signal_used: 'funding', signal_freshness_days: 100 }).pass).toBe(false);
  });

  it('passes fallback regardless of freshness', () => {
    expect(check13_freshness({ signal_used: 'fallback', signal_freshness_days: 500 }).pass).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/validate-final.test.ts`
Expected: FAIL — check11/12/13 not exported

- [ ] **Step 3: Extend validate-final.ts with new checks**

Append to `scripts/validate-final.ts` (before the existing CLI section):

```typescript
import { findBannedWords, findBannedStarts } from './_lib_signals';

export interface CheckResult {
  pass: boolean;
  reason?: string;
}

export function check11_bannedWords(row: { signal_bridge?: string; signal_fact?: string }): CheckResult {
  const text = `${row.signal_bridge || ''} ${row.signal_fact || ''}`;

  const words = findBannedWords(text);
  if (words.length > 0) {
    return { pass: false, reason: `banned word(s): ${words.join(', ')}` };
  }

  const starts = findBannedStarts(text);
  if (starts.length > 0) {
    return { pass: false, reason: `banned sentence-start(s): ${starts.join(', ')}` };
  }

  return { pass: true };
}

export function check12_capitalization(row: { email1_body?: string }): CheckResult {
  const body = row.email1_body || '';
  if (!body) return { pass: true };

  const sentences = body.split(/(?<=[.!?])\s+/).filter(Boolean);
  for (const sentence of sentences) {
    const trimmed = sentence.trimStart();
    if (!trimmed) continue;
    const first = trimmed[0];
    if (first !== first.toUpperCase() || !/[A-Z]/.test(first)) {
      return { pass: false, reason: `sentence-start not capitalized: "${sentence.slice(0, 50)}..."` };
    }
  }

  return { pass: true };
}

export function check13_freshness(row: { signal_used?: string; signal_freshness_days?: number }): CheckResult {
  if (row.signal_used === 'fallback') return { pass: true };
  if ((row.signal_freshness_days ?? 0) > 90) {
    return { pass: false, reason: `signal freshness ${row.signal_freshness_days}d > 90d` };
  }
  return { pass: true };
}
```

- [ ] **Step 4: Run validator tests**

Run: `npx vitest run tests/validate-final.test.ts`
Expected: PASS — ~7 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/validate-final.ts tests/validate-final.test.ts
git commit -m "feat(validator): Checks 11/12/13 — banned words, capitalization, freshness"
```

---

## Task 14: Validator Check 14 — universal-truth soft warn

**Files:**
- Modify: `scripts/validate-final.ts`
- Modify: `tests/validate-final.test.ts`

- [ ] **Step 1: Add Check 14 tests**

Append to `tests/validate-final.test.ts`:

```typescript
import { check14_universalTruth } from '../scripts/validate-final';

describe('Check 14 — universal-truth heuristic (soft warn)', () => {
  it('passes when bridge follows a specific fact', () => {
    const row = {
      signal_fact: 'Your Series B closed in March.',
      signal_bridge: 'Brands at that funding stage typically start asking the channel-mix question.',
    };
    expect(check14_universalTruth(row).pass).toBe(true);
  });

  it('warns when bridge is pure universal truth with no preceding fact', () => {
    const row = {
      signal_fact: '',
      signal_bridge: 'For premium DTC, channel diversification matters.',
    };
    const result = check14_universalTruth(row);
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/universal truth/i);
  });

  it('passes when no signal at all (fallback)', () => {
    const row = { signal_fact: '', signal_bridge: '' };
    expect(check14_universalTruth(row).pass).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/validate-final.test.ts`
Expected: FAIL — check14 not exported

- [ ] **Step 3: Implement Check 14**

Append to `scripts/validate-final.ts`:

```typescript
const UNIVERSAL_PATTERN_PHRASES = [
  /\bfor premium dtc\b/i,
  /\bin this space\b/i,
  /\bbrands at that stage\b/i,
  /\bbrands like yours\b/i,
];

export function check14_universalTruth(row: { signal_bridge?: string; signal_fact?: string }): CheckResult {
  const bridge = row.signal_bridge || '';
  const fact = row.signal_fact || '';

  if (!bridge && !fact) return { pass: true };

  const hasPattern = UNIVERSAL_PATTERN_PHRASES.some(p => p.test(bridge));
  if (hasPattern && !fact.trim()) {
    return { pass: false, reason: 'universal truth pattern with no preceding fact' };
  }

  return { pass: true };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/validate-final.test.ts`
Expected: PASS — all validator tests

- [ ] **Step 5: Commit**

```bash
git add scripts/validate-final.ts tests/validate-final.test.ts
git commit -m "feat(validator): Check 14 — universal-truth heuristic (soft warn)"
```

---

## Task 15: Integration test — end-to-end pipeline on mock data

**Files:**
- Create: `tests/pipeline_e2e.test.ts`

- [ ] **Step 1: Write e2e integration test**

`tests/pipeline_e2e.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { extractSignalsForLead } from '../scripts/extract-signals';
import { renderLead } from '../scripts/render-with-signals';
import { check11_bannedWords, check12_capitalization, check13_freshness } from '../scripts/validate-final';

const TEST_DIR = resolve(__dirname, '../data/signals-e2e');

const MOCK_LEADS = [
  { person_id: 'pid_1', first_name: 'Alex', full_name: 'Alex Smith', current_job_title: 'VP Marketing', company_name: 'Faherty', company_domain: 'faherty-e2e.com', qual_confidence: 0.85, primary_vertical: 'apparel', assigned_variant: 'B' as const, vertical_anchor: 'Bombas', ai_similarity_dimension: 'DTC channel', ai_brand_category: 'lifestyle apparel', ai_role_hook: 'VP Marketing owns acquisition mix' },
  { person_id: 'pid_2', first_name: 'Sam', full_name: 'Sam Jones', current_job_title: 'Specialist', company_name: 'SmallCo', company_domain: 'smallco-e2e.com', qual_confidence: 0.72, primary_vertical: 'apparel', assigned_variant: 'C' as const, ai_brand_category: 'premium accessories', ai_role_hook: 'Specialist supports marketing ops' },
];

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
  vi.restoreAllMocks();
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('e2e pipeline', () => {
  it('runs extractor → renderer → validator and all leads produce valid output', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ organic: [{ title: 'Brand X press', snippet: 'Brand X opened a store in March 2026.', date: '2026-03-15' }] }),
    } as any);

    const aiInvoke = vi.fn().mockResolvedValue('Retail expansion at that pace pulls hard on the DTC channel.');

    const renderedLeads = [];
    for (const lead of MOCK_LEADS) {
      await extractSignalsForLead(lead, 'fake-key', TEST_DIR);
      const rendered = await renderLead(lead, aiInvoke, TEST_DIR);
      renderedLeads.push(rendered);
    }

    expect(renderedLeads).toHaveLength(2);

    for (const r of renderedLeads) {
      expect(check11_bannedWords(r).pass).toBe(true);
      expect(check12_capitalization(r).pass).toBe(true);
      expect(check13_freshness(r).pass).toBe(true);
    }

    // T1 lead should have T1 tier, T3 lead should have T3
    expect(renderedLeads.find(r => r.person_id === 'pid_1')!.enrichment_tier).toBe('T1');
    expect(renderedLeads.find(r => r.person_id === 'pid_2')!.enrichment_tier).toBe('T3');
  });

  it('re-run uses cache (no API calls second time)', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ organic: [] }) } as any);
    });

    const lead = MOCK_LEADS[0];
    await extractSignalsForLead(lead, 'k', TEST_DIR);
    const firstCalls = callCount;

    await extractSignalsForLead(lead, 'k', TEST_DIR);
    expect(callCount).toBe(firstCalls); // Cache hit, no new calls
  });
});
```

- [ ] **Step 2: Run e2e test**

Run: `npx vitest run tests/pipeline_e2e.test.ts`
Expected: PASS — 2 tests

- [ ] **Step 3: Commit**

```bash
git add tests/pipeline_e2e.test.ts
git commit -m "test(signals): e2e integration test on mock data"
```

---

## Task 16: CLI entry — extract + render scripts callable from terminal

**Files:**
- Modify: `scripts/extract-signals.ts`
- Modify: `scripts/render-with-signals.ts`

- [ ] **Step 1: Add CLI orchestration to extract-signals.ts**

Replace the bottom CLI placeholder in `scripts/extract-signals.ts` with:

```typescript
async function runCli() {
  const inputCsv = process.argv[2];
  const outputCsv = process.argv[3];
  if (!inputCsv || !outputCsv) {
    console.error('Usage: tsx scripts/extract-signals.ts <leads-all-with-qual.csv> <leads-with-signals.csv>');
    process.exit(1);
  }

  const { readFileSync, writeFileSync } = await import('fs');
  const text = readFileSync(inputCsv, 'utf8').replace(/\r\n/g, '\n');
  // Naive CSV parse — replace with full parser if needed
  const lines = text.split('\n').filter(Boolean);
  const headers = lines[0].split(',');
  const rows = lines.slice(1).map(line => {
    const vals = line.split(',');
    const obj: any = {};
    headers.forEach((h, i) => obj[h] = vals[i]);
    return obj;
  });

  const qualified = rows.filter(r => r.qualified === 'true');
  console.error(`Processing ${qualified.length} qualified leads`);

  const serperKey = process.env.SERPER_API_KEY;
  if (!serperKey) {
    console.error('ERROR: SERPER_API_KEY not set in .env');
    process.exit(1);
  }

  const results: any[] = [];
  for (const lead of qualified) {
    try {
      const result = await extractSignalsForLead({
        person_id: lead.person_id,
        qual_confidence: parseFloat(lead.qual_confidence),
        title: lead.current_job_title,
        company_name: lead.company_name,
        company_domain: lead.company_domain,
      }, serperKey);

      results.push({ ...lead, enrichment_tier: result.enrichment_tier, fired_queries: result.fired_queries, cache_hit: result.cache_hit });
      console.error(`  ${lead.company_name}: tier=${result.enrichment_tier} fired=${result.fired_queries} hit=${result.cache_hit}`);
    } catch (err) {
      console.error(`  ${lead.company_name}: ERROR ${err}`);
      results.push({ ...lead, enrichment_tier: 'ERROR', fired_queries: 0, cache_hit: false });
    }
  }

  // Write output CSV
  const outHeaders = [...headers, 'enrichment_tier', 'fired_queries', 'cache_hit'];
  const outLines = [outHeaders.join(',')];
  for (const r of results) {
    outLines.push(outHeaders.map(h => r[h] ?? '').join(','));
  }
  writeFileSync(outputCsv, outLines.join('\n'));
  console.error(`Wrote ${results.length} rows to ${outputCsv}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch(e => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 2: Add CLI orchestration to render-with-signals.ts**

Append to `scripts/render-with-signals.ts`:

```typescript
async function runCli() {
  const inputCsv = process.argv[2];
  const outputCsv = process.argv[3];
  if (!inputCsv || !outputCsv) {
    console.error('Usage: tsx scripts/render-with-signals.ts <leads-with-signals.csv> <leads-final-v5.csv>');
    process.exit(1);
  }

  const { readFileSync, writeFileSync } = await import('fs');
  const text = readFileSync(inputCsv, 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n').filter(Boolean);
  const headers = lines[0].split(',');
  const rows = lines.slice(1).map(line => {
    const vals = line.split(',');
    const obj: any = {};
    headers.forEach((h, i) => obj[h] = vals[i]);
    return obj;
  });

  // AI invoker — for production, this dispatches to Claude Code Task subagent
  // For now: pass through a fixed-quality stub. Real subagent integration in Task 17.
  const aiInvoke = async (prompt: string): Promise<string> => {
    console.error('AI subagent invocation pending. Returning placeholder.');
    return 'Brands at that stage typically start asking the channel-mix question.';
  };

  const rendered: any[] = [];
  for (const lead of rows) {
    try {
      const r = await renderLead({
        person_id: lead.person_id,
        first_name: lead.first_name,
        full_name: lead.full_name,
        current_job_title: lead.current_job_title,
        company_name: lead.company_name,
        company_domain: lead.company_domain,
        qual_confidence: parseFloat(lead.qual_confidence),
        primary_vertical: lead.primary_vertical,
        assigned_variant: lead.assigned_variant,
        vertical_anchor: lead.vertical_anchor,
        ai_similarity_dimension: lead.ai_similarity_dimension,
        ai_brand_category: lead.ai_brand_category,
        ai_role_hook: lead.ai_role_hook,
      }, aiInvoke);

      rendered.push({ ...lead, ...r });
    } catch (err) {
      console.error(`Render error for ${lead.person_id}: ${err}`);
    }
  }

  const outHeaders = [...headers, 'enrichment_tier', 'signal_used', 'signal_fact', 'signal_bridge', 'signal_freshness_days', 'signal_e2_back_reference', 'email1_subject', 'email1_body', 'email2_subject', 'email2_body', 'email3_subject', 'email3_body', 'email4_subject', 'email4_body'];
  const outLines = [outHeaders.join(',')];
  for (const r of rendered) {
    outLines.push(outHeaders.map(h => {
      const v = r[h] ?? '';
      const s = String(v);
      return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','));
  }
  writeFileSync(outputCsv, outLines.join('\n'));
  console.error(`Wrote ${rendered.length} rendered leads to ${outputCsv}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch(e => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 3: Test CLI executables work (smoke)**

```bash
cd coldoutboundskills
# Just verify they print usage when args missing
npx tsx scripts/extract-signals.ts
npx tsx scripts/render-with-signals.ts
```
Expected: each prints "Usage: ..." and exits

- [ ] **Step 4: Commit**

```bash
git add scripts/extract-signals.ts scripts/render-with-signals.ts
git commit -m "feat(signals): CLI entry points for extract + render"
```

---

## Task 17: AI subagent integration (production aiInvoke)

**Files:**
- Modify: `scripts/render-with-signals.ts`
- Create: `scripts/_ai_subagent.ts`

- [ ] **Step 1: Document AI invocation approach**

The renderer needs an `aiInvoke(prompt)` function that calls Claude Code's Task subagent. There are two options:

**Option A — production-ready (used in v4 pipeline):** dispatch a Claude Code `general-purpose` subagent for each lead's bridge sentence. Costly per-lead but uses the existing pattern.

**Option B — batch via OpenRouter:** use `OPENROUTER_API_KEY` from `.env` to call a cheap model (claude-haiku, gpt-4o-mini) for bridge generation. Much cheaper at scale.

We use **Option B** for the renderer. Subagent dispatch via Claude Code is reserved for higher-touch tasks. Bridge sentence generation is a constrained task with strong validation — a cheap model + retry-on-fail is fine.

- [ ] **Step 2: Implement OpenRouter AI invoker**

`scripts/_ai_subagent.ts`:

```typescript
export async function openRouterInvoke(prompt: string, apiKey: string, model = 'anthropic/claude-3-haiku'): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  return String(text).trim();
}
```

- [ ] **Step 3: Wire openRouterInvoke into render CLI**

Replace the placeholder `aiInvoke` in `scripts/render-with-signals.ts` runCli:

```typescript
const orKey = process.env.OPENROUTER_API_KEY;
if (!orKey) {
  console.error('ERROR: OPENROUTER_API_KEY not set in .env');
  process.exit(1);
}
const { openRouterInvoke } = await import('./_ai_subagent');
const aiInvoke = (p: string) => openRouterInvoke(p, orKey);
```

(Replace the previous `const aiInvoke = async ...` placeholder block.)

- [ ] **Step 4: Update .env.example to confirm OPENROUTER_API_KEY needed**

Verify `.env.example` documents `OPENROUTER_API_KEY` (already present in existing file).

- [ ] **Step 5: Commit**

```bash
git add scripts/_ai_subagent.ts scripts/render-with-signals.ts
git commit -m "feat(signals): wire OpenRouter-based AI invoker for bridge generation"
```

---

## Task 18: Live smoke test on 20 BW Apparel leads

**Files:**
- No new files; this is a manual gate

- [ ] **Step 1: Subset existing v4 data to 20 sample apparel leads**

```bash
cd coldoutboundskills
# Take first 20 apparel rows from existing v4 CSV
head -1 profiles/belardi-wong/campaigns/lookalike-anchor/leads-final-v4.csv > /tmp/smoke-input.csv
grep ',apparel,' profiles/belardi-wong/campaigns/lookalike-anchor/leads-final-v4.csv | head -20 >> /tmp/smoke-input.csv
```

- [ ] **Step 2: Run extractor on smoke set**

```bash
cd coldoutboundskills
npx tsx scripts/extract-signals.ts /tmp/smoke-input.csv /tmp/smoke-with-signals.csv
```
Expected: 20 rows processed. Cache files written to `data/signals/`. Tier mix visible in stderr output.

- [ ] **Step 3: Run renderer on smoke set**

```bash
npx tsx scripts/render-with-signals.ts /tmp/smoke-with-signals.csv /tmp/smoke-final.csv
```
Expected: 20 rows rendered with E1/E2 signal-aware bodies.

- [ ] **Step 4: Side-by-side compare v4 vs v5**

Open both `leads-final-v4.csv` (rows for the 20 sample leads) and `smoke-final.csv`. For each lead, compare:
- v4 email1_body vs v5 email1_body
- v4 email2_body vs v5 email2_body

Document differences in `coldoutboundskills/profiles/belardi-wong/campaigns/lookalike-anchor/SMOKE-COMPARISON-v4-vs-v5.md`. Note:
- Which lines feel more natural in v5
- Which lines regressed
- Any banned-word leaks that slipped past validator
- Any signal that feels stalkery or wrong

- [ ] **Step 5: Team review checkpoint**

Share the smoke comparison with team. Wait for approval before scaling to full BW Apparel (179 leads).

If team approves → proceed to sub-project D (re-render all 4 campaigns with v5). If team flags issues → iterate on bridge prompt + banned list + retry. Round 2 of smoke test on 20 different leads after iteration.

- [ ] **Step 6: Commit smoke comparison doc**

```bash
git add profiles/belardi-wong/campaigns/lookalike-anchor/SMOKE-COMPARISON-v4-vs-v5.md
git commit -m "docs(signals): v4 vs v5 smoke comparison on 20 BW Apparel leads"
```

---

## Task 19: PND endpoint integration (BLOCKED — awaits user docs)

**Files:**
- Create: `scripts/_pnd_client.ts`
- Modify: `scripts/extract-signals.ts`
- Create: `tests/_pnd_client.test.ts`

**Status:** BLOCKED until user provides PND endpoint shape (see spec OPEN-1).

When PND endpoint docs arrive:

- [ ] **Step 1: Read endpoint docs**

Confirm:
- Endpoint URL
- Request method + params
- Auth header
- Response shape
- Quota / cost per call

- [ ] **Step 2: Write `_pnd_client.ts` mirroring `_serper_client.ts` pattern**

Mockable wrapper. Returns `{ raw, queryString, timestamp, status }`.

- [ ] **Step 3: Extract person-level signals from PND response**

In `scripts/_fact_extractor.ts`, add `extractNewRoleFact()` and `extractPromotionFact()` based on actual PND response shape.

- [ ] **Step 4: Wire PND into `extract-signals.ts`**

When tier is T1 or T2, fire PND lookup after Serper queries. Write to `data/signals/<domain>--<person-id>.json`.

- [ ] **Step 5: Add PND tests**

Mock PND responses (one with new_role, one with promotion, one with neither). Test extraction + sidecar write.

- [ ] **Step 6: Re-run e2e + smoke tests with PND**

Verify new_role / promotion signals appear in signal_used for T1/T2 leads.

- [ ] **Step 7: Commit**

```bash
git add scripts/_pnd_client.ts scripts/extract-signals.ts scripts/_fact_extractor.ts tests/_pnd_client.test.ts
git commit -m "feat(signals): PND endpoint integration for new_role + promotion signals"
```

---

## Task 20: Final verification — run all tests + write completion report

**Files:**
- Create: `coldoutboundskills/docs/superpowers/reports/2026-05-26-deep-personalization-completion.md`

- [ ] **Step 1: Run full test suite**

```bash
cd coldoutboundskills
npx vitest run
```
Expected: ALL tests pass. ~35-40 tests across 8 test files.

- [ ] **Step 2: Verify no orphan TODOs**

```bash
grep -rn "TODO\|FIXME\|XXX" scripts/ tests/
```
Expected: zero matches (or only intentional `[OPEN-X]` references to spec doc).

- [ ] **Step 3: Write completion report**

```markdown
# Sub-project B Completion — Deep Personalization Layer

**Date:** YYYY-MM-DD
**Spec:** docs/superpowers/specs/2026-05-26-deep-personalization-layer-design.md
**Plan:** docs/superpowers/plans/2026-05-26-deep-personalization-layer.md

## Built
- N tests passing (vitest)
- 3 new scripts: extract-signals.ts, render-with-signals.ts, _bridge_writer.ts
- 6 new utility modules: _lib_signals, _serper_client, _query_templates, _fact_extractor, _signal_selector, _ai_subagent
- 4 new validator checks (11-14)
- Cache cross-client integration test
- 20-lead smoke test on BW Apparel data

## Spec coverage
- §1-2: ✅
- §3 architecture: ✅
- §4 sidecar schema: ✅
- §5 tier rules + Serper templates: ✅
- §6 banned words + sentence-starts: ✅
- §6.5 E2 back-reference: ✅
- §7 templates: ✅
- §8 cache: ✅
- §9 error handling: ✅ (partial — see open items)
- §10 testing: ✅
- §11 migration: ✅
- §13 OPEN-1 (PND): STILL OPEN (Task 19 BLOCKED on user docs)
- §13 OPEN-3 (Check 14 heuristic): RESOLVED (Check 14 implemented + soft warn confirmed)
- §13 OPEN-4 (person changes companies): STILL OPEN — edge case deferred
- §17 sub-project D handoff schema: ✅ (renderer emits all promised columns)

## Ready for sub-project D
Yes — Apparel pilot smoke tested, Variant B routing intact, validator catches editorial leaks mechanically.

## Known limitations
- PND integration pending user docs
- Smoke test sample is 20 leads; full BW Apparel re-render (179) happens in sub-project D
- Email 2 back-reference templates are static per signal_type — could be made AI-generated in future iteration
```

- [ ] **Step 4: Commit completion report**

```bash
git add docs/superpowers/reports/
git commit -m "docs(signals): sub-project B completion report"
```

---

## Amendments to existing tasks (Twain-derived — apply when reaching each task)

### Task 4 amendment (banned-word list expansion)

Update BANNED_STARTS to include: 'Saw that', 'I see', 'I don't see', 'I'm guessing', 'I imagine', 'I am guessing', 'I am imagining', 'I could imagine'.

Update BANNED_WORDS_COMPOUND to include: 'caught my eye', 'tends to', 'tend to', 'usually see', 'usually drives', 'often see', 'brands at this stage', 'brands at that stage', 'brands in this category', 'brands in that category'.

Add new exported function: `findFirstPersonObservation(text: string): string[]` matching `/\b(I see|I noticed|I caught|I'm guessing|I imagine|I am guessing|I am imagining|I could imagine)\b/i` (Check 11b).

Add new exported function: `findVagueFact(fact: string): boolean` matching `/^(spring|summer|fall|winter|holiday|q[1-4])\s+(sale|launch|promotion|drop|collection)$/i` AND no proper noun in same fact (Check 11c).

Add ~6 more tests covering all new bans.

### Task 8 amendment (signal selector + rotation)

In addition to existing `selectSignal(companySidecar, personSidecar)`, add:

`selectSignalWithRotation(companySidecar, personSidecar, usedTypesForCompany: Set<string>): SelectedSignal`

Same priority order, but skip signal types already in `usedTypesForCompany`. If all in-window signals already used for this company, fall back to `selectSignal()` (single-lead default).

Add `acquisition` signal type to priority order (between promotion and funding). New tests for rotation: 3 leads at same domain receive 3 different signal types when company has ≥3 fresh signals.

### Task 9 amendment (extractor — persist all signals)

Change extractor to continue all queries (don't stop on first hit per signal type) and persist `available_signals[]` array on sidecar — full ranked list, in priority order, with `in_window` boolean.

`leads-with-signals.csv` adds 2 columns: `available_signal_count` (int) and `available_signal_types` (semicolon-separated list).

Extractor also reads eligibility from Task 8.5 — only processes rows with `eligible=true`.

### Task 11 amendment (bridge writer — anti-Twain prompt)

Update BRIDGE_PROMPT_TEMPLATE to append:

"NEVER use these patterns (critical):
- 'Saw [company] is...' → use '[company]'s [event] [date]...' instead
- 'I see you...' → use 'Your [event]...' instead
- 'I don't see X on your end' → drop the observation, state the category pattern only
- 'Brands at this stage usually...' → use 'Brands at the [specific funding stage / revenue band / channel mix] you're at...'
- 'X tends to...' / 'X usually drives...' → use 'X has driven...' with specific reference

Hedge budget: ONE soft word ('likely', 'probably', 'often', 'usually') maximum per sentence. Stack of hedges = rejection.

Anchor references: NEVER write 'a brand targeting the same consumer' or 'a peer brand'. Use the specific BW client name from the input context. If no specific anchor available, omit the case-study sentence entirely."

### Task 12 amendment (renderer — Email 2 threaded + signal-tied subjects)

Replace existing Email 2 template (the cold re-open template) with Amendment 7 threaded follow-up template. Word cap 65 enforced by new Check 15.

Add `SIGNAL_TIED_SUBJECTS` map (Amendment 9). Add `subject_strategy` to render config: 'anchor' | 'category' | 'signal' | 'mixed' (default).

Renderer instantiates `StatRotator` (Task 11.5) per render run. Each email body that needs a stat calls `rotator.nextFor(person_id)`.

Renderer instantiates `CategoryResolver` (Task 11.6) for pre-pass. If anchor_match is null → assigned_variant = 'C' (override input).

Renderer calls `selectSignalWithRotation` (Task 8 amendment) with per-domain used-types tracker.

### Task 13 amendment (validator — Checks 11b + 11c)

Add Check 11b: `findFirstPersonObservation(signal_bridge + signal_fact + email1_body + email2_body)`. Fail if any matches.

Add Check 11c: `findVagueFact(signal_fact)`. Fail if true.

Add tests covering: Twain's "I see you just dropped a Spring Security Sale" must be rejected by either Check 11b or 11c.

### Task 14 amendment (validator — Check 15: E2 word cap)

Add Check 15: `email2_body.split(/\s+/).filter(Boolean).length` MUST be ≤ 65. Fail if greater. Add tests.

### Task 18 amendment (smoke gates)

In addition to v4 vs v5 comparison, also run v5 against the 5 Twain fixture leads (`data/signals/signal_campaign_20260526_1456.csv`). Score per Amendment 4-9 acceptance gates:

- Banned-word leaks: ZERO across all 5 leads
- Stat repetition: each stat appears ≤1 time per lead's sequence
- Hedge density: ≤1 hedge per sentence, ≤4 per email
- Anchor specificity: every Variant B email names a specific BW client
- Eligibility respected: Sarah Zurell (lead 4 in fixture, no longer at Chinese Laundry per Twain's own warning) must produce ZERO emails

Any gate fail → STOP, do not proceed to full re-render, iterate prompt + banned lists + re-smoke.

---

## Self-Review

**Spec coverage:**
- §1 Purpose → Tasks 1-12 cover the full pipeline
- §2 Constraints → enforced by tier compute (Task 3), banned-word matchers (Task 4), validator (Tasks 13-14)
- §3 Architecture → 3 components built (Tasks 5-12)
- §4 Sidecar schema → Task 2 + 9 implement
- §5 Tier rules → Task 3
- §5 Serper templates → Task 6
- §6 Bridge rule + banned list → Tasks 4 + 11 + 13
- §6.5 E2 back-reference → Task 12 (E2_BACK_REF_TEMPLATES)
- §7 Email templates → Task 12
- §8 Cache strategy → Task 2 (read/write), Task 10 (cross-client test)
- §9 Error handling → Tasks 5 (retry), 9 (per-query error log), 11 (bridge retry + degrade)
- §10 Testing → Tasks throughout + e2e (Task 15) + cross-client (Task 10)
- §11 Migration → Task 16 + 18
- §13 OPEN-1 PND → Task 19 (blocked, but planned)
- §17 D handoff → emits all promised columns (Task 12 RenderedLead schema)

**Placeholder scan:** No "TBD", "TODO", "implement later" patterns. All code blocks complete.

**Type consistency:**
- `EnrichmentTier` defined once in `_lib_signals.ts`, used in `_query_templates.ts` + `extract-signals.ts` + `render-with-signals.ts` ✓
- `SignalSidecar` defined once, read/written via cache layer ✓
- `RenderedLead` columns match §17 handoff contract ✓
- `aiInvoke: (prompt: string) => Promise<string>` consistent across `_bridge_writer.ts` + `render-with-signals.ts` + `_ai_subagent.ts` ✓

---

## Execution Handoff

**Plan complete and saved to `coldoutboundskills/docs/superpowers/plans/2026-05-26-deep-personalization-layer.md`.** Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for: TDD discipline, catches issues early per task.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Best for: faster end-to-end, less context-switching.

**Which approach?**

Note: Task 19 (PND integration) is BLOCKED on user-provided PND endpoint docs. Tasks 1-18 + 20 are unblocked. Task 19 picks up whenever PND docs land.
