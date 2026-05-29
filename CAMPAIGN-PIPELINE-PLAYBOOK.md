# Campaign Pipeline Playbook

*How to onboard a new client and run a campaign end-to-end.*

This is the **production playbook** that complements the skills README. The skills (`/icp-onboarding`, `/campaign-strategy`, etc.) give you the *building blocks*. This playbook is the *operating procedure* — how we string the skills + AI subagents + Prospeo + Smartlead together to ship a real campaign.

If you're new to the repo, read `README.md` first for the skills overview. Then come back here for the workflow.

---

## ⚠ READ FIRST: post-2026-05-28 hardening

After the BW + Mythic showcase run (300 leads, 1200 emails, May 28-29 2026), 8 hard rules were locked in. **All future runs MUST follow these or quality drops to 60% category-filler.**

**Required reading before any production batch run:**
1. `PIPELINE_LESSONS.md` — 12 mistakes + fixes from showcase. Don't repeat.
2. This playbook (Path C below) — bulk batch workflow

**New pipeline scripts (all in `scripts/pipeline/`):**

| Script | Purpose |
|---|---|
| `_email-pipeline.ts` | End-to-end: Serper prebake → fact-richness gate → batch prompts (size 5) |
| `_serper-prebake.ts` | Fetch 1 dated fact per lead via Serper API |
| `_validate-emails.ts` | Hard-rule validator (lowercase opener, ?, no em dash, no banned vocab) |
| `_add-paragraph-breaks.ts` | Mechanical splitter for skim-readability (≥20 word paragraphs, abbreviation-safe) |
| `_smartlead-html.ts` | Convert JSON `\n\n` → `<br><br>` at Smartlead push time (NOT in storage) |
| `_aggregate-showcase.ts` | Flatten all batch JSON → per-vertical CSV + master CSV |

**Hard rules (from PIPELINE_LESSONS.md, do not break):**

1. **Never write lead lists from memory.** Always `awk -F',' 'NR>1{print $4" | "$5" | "$12" | "$13}' raw.csv` then paste into prompts. Sub-agents treat prompt-supplied leads as ground truth.
2. **Each lead prompt MUST have:** date + concrete noun + anchor comp + role hook. Thin prompt = category-filler emails.
3. **Sub-agent batch size = 5 hardcap.** 6+ degrades quality.
4. **Default = Serper pre-bake on main thread.** NOT WebSearch inside sub-agent. ~70% token cut, same quality.
5. **Validate every batch JSON immediately.** Re-dispatch hard fails before piling up batches.
6. **Banned vocab in prompt + validator.** leverage / synergy / ROI / pipeline / "I noticed" / "I came across" / "hope this finds".
7. **Prospeo `vertical_industries` collision:** if page 1 returns wrong-vertical leads, fix the industry filter in `client-profile.yaml` — do NOT pull more pages.
8. **Spacing:** JSON storage keeps clean `\n\n`. HTML conversion happens at Smartlead push (via `_smartlead-html.ts`).

---

## When to use this playbook

You're here because you want to:

- **A.** Onboard a new client from scratch → end up with a `client-profile.yaml` + ICP rules + first campaign live in Smartlead, OR
- **B.** Add a new campaign category for an existing client (e.g., we already have BW Home live; now we want BW Apparel), OR
- **C.** Production batch run (showcase or scaled campaign) using new pipeline scripts. **Use this after showcase-2026-05-28.**

Path A takes ~2-3 hours of guided work + 14-day pilot. Path B takes ~30-60 min once the client profile exists. Path C takes ~1-2 hours per vertical at 25 leads, mostly waiting on sub-agents.

---

## The golden rule: one category at a time

**Don't run multi-vertical pulls in production.** Lessons from the BW v1 run:

- Blended 4-vertical pull → blended qual rate (40.8%) hides per-vertical signal
- 945 raw leads = too many to spot-check
- Subagent reasoning is slower + less confident when scope is wide
- Reject reasons cluster across verticals, hard to tune one filter

**Always:** 1 category → 1-2 Prospeo credits → qualify → sample 10 → tune filter → re-pull → scale. Then move to the next category.

---

## Naming conventions

### Client slug
`{lowercase-hyphenated}` — e.g., `belardi-wong`, `acme-corp`. Used in profiles folder.

### Campaign name
**`{CLIENT}-{CATEGORY}-{ANCHOR}-{YEAR}{QUARTER}`**

Examples:
- `BW-Home-SandL-2026Q2` (Belardi Wong, Home category, Serena & Lily anchor, Q2 2026)
- `BW-Apparel-Bombas-2026Q3`
- `ACME-Mortgage-Rocket-2026Q2`

When the team sees a CSV land in Smartlead, this name tells them: **client, category, anchor proof used, when it was built.**

### Category names (the ICP segments)
These are NOT the Prospeo industry tags. They're the ICP segments that share an anchor + AOV bracket. Examples used for BW:

| Category slug | What's in it | Anchor |
|---|---|---|
| `home_furniture` | Heritage furniture retailers + premium DTC home | Serena & Lily |
| `apparel` | Premium apparel + lifestyle DTC | Bombas |
| `denim` | Premium denim brands | AG |
| `athletic` | Athletic/activewear DTC | Title Nine |
| `footwear` | Premium footwear | Birkenstock |
| `beauty` | Premium beauty DTC | (waiting on client to provide anchor) |
| `food_bev` | DTC food + bev | (waiting on client) |

For a new client, define categories during ICP-onboarding. Each category needs one named anchor brand or we can't run Variant B.

---

## Path A — Onboarding a new client from scratch

### Step 0 — Pre-flight

- [ ] `.env` has `PROSPEO_API_KEY`, `SMARTLEAD_API_KEY`, `LEADMAGIC_API_KEY` (or equivalent reveal service)
- [ ] Client has agreed to direct-mail / cold-outbound for their brand (legal)
- [ ] You have client's website URL

### Step 1 — `/icp-onboarding` (~30 min, conversational)

Run the skill. It scrapes the website + asks ~10 questions. Produces:

```
profiles/<client-slug>/client-profile.yaml
```

The yaml must include (for our production pipeline to work):

```yaml
client_business:
  name: ...
  website: ...
  what_they_sell: ...

icp:
  hard_filters:
    must_be_true:
      - US-based
      - Has DTC ecom + sells own products
      - Headcount 20-10,000
      - (4-6 more)
    disqualifiers:
      - BW competitor (named list)
      - Excluded industries (named list)
      - (4-6 more)
  aov_floors_by_subcategory:
    furniture: 500
    home: 100
    apparel: 100
    # etc.

vertical_anchor_map:
  home_furniture: Serena & Lily
  apparel: Bombas
  # ... one anchor per category. If you don't have one for a category, the category cannot run Variant B yet.

anchor_proof_per_category:
  Serena & Lily: "year 11 of running direct mail for Serena & Lily. {{company_name}} reminds me of where they were around 2017"
  # one full proof line per anchor brand
```

**Critical:** `vertical_anchor_map` + `anchor_proof_per_category` are what makes per-category Variant B work. No anchor = no B variant for that category = only generic C copy.

### Step 2 — `/icp-prompt-builder` (~10 min)

Produces `profiles/<client-slug>/icp-prompt.txt` — the qualifier prompt fed to the AI subagent. Always 6 MUST-be-true + 6 disqualifiers. Reused by every list-building skill for this client.

### Step 3 — Choose category #1

**Don't try to run all categories.** Pick ONE:

- Where the client has the strongest anchor brand (case study, named client)
- Where AOV math is clean (clear floor, easy to qualify)
- Where Prospeo industry filters give a tight pull

For BW v1 that was Home (Serena & Lily anchor, $500 AOV floor furniture, "Retail Furniture and Home Furnishings" tag).

### Step 4 — Lock copy variants

```
profiles/<client-slug>/campaigns/<campaign-name>/variants.yaml
```

Three variants:
- **A** — dormant in v3 (was format-observation, retired because of fabrication risk)
- **B** — anchor-flex: uses `vertical_anchor` per category for proof
- **C** — generic fallback: no anchor, uses `ai_brand_category` only

`/campaign-copywriting` skill builds these stepwise. Test against a single known prospect (e.g., "Room & Board for BW Home") before scaling.

### Step 5 — Lock personalization prompts

```
profiles/<client-slug>/campaigns/<campaign-name>/clay-personalization-prompts.md
```

4 hardened AI prompts:
- `ai_catalog_observation` — currently dormant (NULL output)
- `ai_similarity_dimension` — drives Variant B routing
- `ai_brand_category` — drives Variant C copy
- `ai_role_hook` — used in all variants, last sentence of every Email 1

Each prompt MUST have:
- Explicit "do not fabricate" hard rules
- Word limit (15 / 22 / etc.)
- NULL fallback when data is insufficient
- No first-person verbs (avoid "I noticed", "I saw")

### Steps 6-onward — see Path B below.

The rest of the pipeline (Prospeo pull → qualifier → enrichment → render → split → upload) is identical for first campaign and Nth campaign. Continue with Path B Step 1.

---

## Path B — Adding a new campaign for an existing client

You have `client-profile.yaml`, ICP prompt, variants, and AI prompts already. Now you want to add one new category.

Target: ~30-60 min of work + 14-day pilot.

### Step 1 — Pick the category + Prospeo filter

Pick ONE category from `vertical_anchor_map`. Note its anchor brand.

Build the Prospeo search filter. Keep it tight — single industry tag is best:

```typescript
// In scripts/prospeo-trial-search.ts, configure VERTICAL_GROUP
{
  industries: ["Retail Apparel and Fashion"],          // ONE tag
  job_titles: ["Marketing", "Growth", "Ecommerce"],    // senior decision-makers
  headcount: ["51-200", "201-500", "501-1000"],
  geography: ["US"],
}
```

Title exclusion list (always-on): `Office`, `Commercial`, `B2B`, `Wholesale`, `Sales` (unless target persona is Sales).

### Step 2 — Test pull: 1-2 Prospeo credits (25-50 leads)

```bash
VERTICAL_GROUP=apparel \
MAX_CREDITS=2 \
npx tsx scripts/prospeo-trial-search.ts
```

Outputs:
- `profiles/<client>/campaigns/<campaign>/leads-raw.csv` (≈25-50 rows)
- `profiles/<client>/campaigns/<campaign>/prospeo-raw-{batch}.json` (sidecar, for debugging)

**Spot-check the raw CSV.** If 80% of rows already look off-ICP (wrong title, B2B, contract furniture, etc.) → tighten filters before burning more credits.

### Step 3 — Qualify with AI subagent

Dispatch a `general-purpose` Task subagent for each batch (one subagent = one CSV slice).

**Critical:** pre-split the input CSV so each subagent reads its own file. Do NOT give 4 subagents the same CSV with "process rows 1-37, 38-74, etc." prompts — they collide at boundaries (see Bug #1 in `FINAL-LEARNINGS.md`).

```bash
# Split into 4 chunks of ~50 rows each
npx tsx scripts/split-additional-qualified.ts

# Then dispatch 4 parallel subagents, each reading its own chunk
# (Done via Agent tool calls in Claude Code, see render-multivertical.ts for pattern)
```

Each subagent outputs `leads-qual-batch-<N>.csv` with columns:
- All original lead fields
- `qualified` (true/false — normalize during merge: yes/YES/true all → true)
- `qual_confidence` (0-1)
- `qual_reason` (one sentence)

Merge with `scripts/merge-qual-v2.ts`. Output: `leads-all-with-qual.csv`.

### Step 4 — Review reject reasons

```bash
npx tsx scripts/tally-multivertical.ts
```

Look at qual rate + top 10 reject reasons. If reject reasons cluster on something tunable (e.g., "30% rejected for B2B-only" → add title-exclude or industry filter), tune and re-pull.

### Step 5 — Enrich qualified leads with 4 AI variables

Dispatch subagents again, this time each reads the qualified subset and writes the 4 AI variables per row.

Same pre-split rule. Each subagent should use the `clay-personalization-prompts.md` verbatim.

### Step 5a — Extract company signals (new in v5)

```bash
npx tsx scripts/extract-signals.ts leads-all-with-qual.csv data/signals/
```

Fetches Serper search results for each qualified lead's company. Writes per-domain JSON sidecars to `data/signals/`. Cache-aware — re-runs are cheap (90-day TTL on hits, 7-day TTL on misses).

Needs `SERPER_API_KEY` in `.env`.

### Step 5b — Fetch person signals via PND (optional, needs PND_API_KEY)

```bash
npx tsx scripts/fetch-pnd-signals.ts leads-all-with-qual.csv
```

Fetches LinkedIn profile data for leads that have `linkedin_url`. Detects `new_role` (started <90 days ago at new company) and `promotion` (same company, new title, <90 days). Writes per-person sidecars to `data/person-signals/`.

Skip if `PND_API_KEY` not available — pipeline degrades gracefully to company-only signals.

### Step 5c — Generate bridge sentences

```bash
# 1. Prepare tasks
npx tsx scripts/prepare-bridge-prompts.ts leads-with-signals.csv data/bridge-tasks.json data/bridge-responses/

# 2. Dispatch Task subagents (one per bridge task) to read the prompt and write the response file
```

Bridge generation is per-lead — only leads with real signals (funding, press, new_role, promotion, product_launch, acquisition) get a bridge. Fallback/snippet leads skip this step automatically.

### Step 6 — Render 4-email sequence (v5 signal-aware)

```bash
npx tsx scripts/render-with-signals.ts leads-with-signals.csv leads-final-v5.csv data/bridge-responses/
```

Signal priority: `new_role > promotion > acquisition > funding > product_launch > press > company_snippet > fallback`.

**Output:** `leads-final-v5.csv`

Legacy fast-path (no signals): `npx tsx scripts/render-multivertical.ts` (still works, skips all signal logic)

### Step 7 — Validate

```bash
npx tsx scripts/validate-final.ts
```

10 checks (see `validate-final.ts` for the full list). All must PASS before upload.

### Step 8 — Split by campaign

```bash
npx tsx scripts/split-by-campaign.ts
```

Outputs one CSV per campaign into `smartlead-campaigns/`:

```
smartlead-campaigns/
  BW-Apparel-Bombas-2026Q3.csv
```

### Step 9 — Write the campaign kickoff doc

Copy the template:
```
profiles/<client>/campaigns/<campaign>/smartlead-campaigns/<CAMPAIGN-NAME>-CONTEXT.md
```

Use `BW-Home-SandL-2026Q2-CONTEXT.md` as template. Fill in: campaign identity table, sample 15 leads, anchor + variant counts, sample rendered email, launch plan, success criteria.

This is the doc the team reviews in Slack.

### Step 10 — Team review (the only manual gate)

- [ ] Team reads `<CAMPAIGN-NAME>-CONTEXT.md`
- [ ] Team reads 10 sample emails from the CSV (5 B + 5 C). Reads them out loud.
- [ ] Flag any row that sounds off — Slack the row number, we re-render or pull it.
- [ ] If 10/10 sound good → approve.

### Step 11 — Reveal emails (LeadMagic)

LeadMagic (or any reveal service): ~$0.09/email. Reveal only AFTER team approval, never before — don't burn reveal budget on unreviewed leads.

### Step 12 — Smartlead DRAFT upload

```bash
# Skill: /smartlead-campaign-upload-public — ALWAYS creates as DRAFT.
```

Configure in Smartlead UI:
- Sequence: Day 0 / Day 3 (threaded) / Day 7 / Day 11
- Schedule: Mon-Fri 8am-5pm America/New_York
- Inboxes: ≥20 tagged `active`, cap 30 leads/day per inbox

### Step 13 — Human clicks Start

**Not Claude.** Smartlead upload skill is hard-gated to DRAFT. Human inspects in UI, clicks Start.

### Step 14 — Day 14: score replies

```bash
# Skill: /positive-reply-scoring
```

Compare positive reply rate to client baseline. Decision gate:
- ≥ baseline → ship next category
- < baseline → hold all, tune anchor or copy

---

## Folder layout per campaign

```
profiles/<client-slug>/
  client-profile.yaml                  # one per client
  icp-prompt.txt                       # one per client
  campaigns/
    <campaign-folder>/                 # e.g., lookalike-anchor/
      variants.yaml                    # per-campaign copy
      clay-personalization-prompts.md  # per-campaign AI prompts
      leads-raw.csv                    # Prospeo pull
      leads-all-with-qual.csv          # After qualifier
      leads-final.csv                  # After render
      messages-final.md                # Human-readable
      smartlead-campaigns/
        <CAMPAIGN-NAME>.csv            # Smartlead-ready (per category)
        <CAMPAIGN-NAME>-CONTEXT.md     # Team kickoff doc
        SMARTLEAD-UPLOAD-GUIDE.md      # Once per client, reused
      SLACK-QUALIFICATION-EXPLAINER.md # Once per client, reused
      FINAL-LEARNINGS.md               # Per-campaign retro (write after Day 14)
```

---

## Scripts reference

All in `coldoutboundskills/scripts/`. All run via `tsx`:

| Script | What it does |
|---|---|
| `prospeo-trial-search.ts` | Paginated Prospeo puller. Supports `VERTICAL_GROUP`, `MAX_PAGES`, `MAX_CREDITS`, `START_PAGE` env vars. Title-exclude pre-filter. Raw JSON sidecar dump. |
| `merge-raw-csvs.ts` | Merge multiple Prospeo batch CSVs into one raw file |
| `merge-qual-v2.ts` | Merge AI qualifier outputs from N parallel subagents. Normalizes yes/no/true/YES → true. |
| `merge-qual-batches.ts` | Older version. Use v2. |
| `merge-and-split-new.ts` | Split qualified leads across N subagent input CSVs (pre-split pattern) |
| `split-additional-qualified.ts` | Pre-split for enrichment subagents |
| `render-multivertical.ts` | Render 4-email sequence per lead. Routes B vs C. Assigns campaign via CAMPAIGN_MAP. |
| `merge-enrich-and-render-v2.ts` | One-shot enrich + render. Use the multivertical version instead. |
| `split-by-campaign.ts` | Split `leads-final.csv` into per-campaign CSVs for Smartlead upload |
| `rerender-category.ts` | Re-render an existing Smartlead-format CSV through the v5 pipeline. Writes new email columns + a `.diff.md` quality comparison. Use when pipeline fixes are shipped and you want to refresh email copy for a category already in Smartlead. |
| `tally-multivertical.ts` | Qual-rate report + reject-reason tally |
| `validate-final.ts` | 10-check post-hoc validator. Must PASS before any upload. |

---

## Troubleshooting (bugs we've already hit + fixes)

### "Email shows as `[object Object]` in CSV"
Prospeo email field is sometimes `{value, status}` not a string. Use the tolerant `extractEmail()` parser in `prospeo-trial-search.ts`. Always dump raw JSON sidecar so you can re-parse without re-burning credits.

### "Some leads missing from final CSV / duplicates exist"
Subagent batch-boundary off-by-one. Fix: pre-split the input CSV so each subagent reads its own file. Never give 4 subagents one shared CSV with row-range prompts.

### "Half my qual results say `yes`, the other half say `true`"
Subagent schema drift. Fix: normalize during merge (yes/YES/true/TRUE all → true). `merge-qual-v2.ts` does this.

### "Validator CSV parser breaks on multi-line email bodies"
CSV bodies contain newlines inside quoted fields. Fix: use full-state-machine CSV parser (see `validate-final.ts` `parseCsv()` function). Don't use line-by-line splits.

### "Prospeo 400 'Rate limit' on day 1"
Free tier has 50/day undocumented cap. Fix: retry logic in `prospeo-trial-search.ts` handles 400 + "Rate limit" body. Pause + resume with `START_PAGE` env var.

### "Variant B body has em-dash, deliverability flagged"
v2 template had em-dash. Fixed in v3 to period. Validator Check #9 catches em-dash in body.

### "Same company has 3 leads but identical role-hook"
AI prompt didn't see prior leads at the company. Fix: validator Check #10 catches this. Re-render those rows individually with explicit "do not repeat" context.

### "Signal sidecar exists but signals show as fallback"
Cause: sidecar is stale (>90 days on a hit, >7 days on a miss). Fix: delete the sidecar file and re-run `extract-signals.ts`. Or check the `cache_status` field in the JSON — stale sidecars are reprocessed on next run.

---

## When NOT to use this pipeline

- **B2B SaaS clients selling to enterprises** — wrong ICP shape, this pipeline is calibrated for DTC/retail
- **Consumer-targeted email** — this is for B2B outreach to operators at brands, NOT consumer email
- **Very low AOV clients (<$30 AOV)** — Variant B anchor framing doesn't carry; the math doesn't work
- **<25 qualified leads after qualifier** — not worth running. Tune filters or expand category first.

---

## Required environment variables

| Var | What for |
|---|---|
| `PROSPEO_API_KEY` | List building |
| `SMARTLEAD_API_KEY` | Campaign upload |
| `LEADMAGIC_API_KEY` (or equiv) | Email reveal |
| `SERPER_API_KEY` | Company signal extraction (extract-signals.ts). Needed for signal-aware v5 render. |
| `PND_API_KEY` | LinkedIn person signals (new_role/promotion). Optional — pipeline degrades gracefully without it. |
| `OPENROUTER_API_KEY` (optional) | AI enrichment fallback if you don't use Claude subagents |

Subagent qualification + enrichment runs inside Claude Code via the `Agent` tool with `subagent_type: general-purpose`. No external API key needed for those steps.

---

## Next steps if you've never run this before

1. Read `README.md` (skills overview)
2. Read this playbook (you're here)
3. Read `profiles/belardi-wong/campaigns/lookalike-anchor/SLACK-QUALIFICATION-EXPLAINER.md` (real example of qualification)
4. Read `profiles/belardi-wong/campaigns/lookalike-anchor/smartlead-campaigns/BW-Home-SandL-2026Q2-CONTEXT.md` (real example of a campaign kickoff doc)
5. Run `/icp-onboarding` for your client
6. Pick category #1
7. Follow Path B above

---

## Path C — Production batch run (post-2026-05-28 hardening)

Use when you need to ship 25-300 leads across multiple verticals (showcase, multi-category campaign push). Pipeline scripts handle Serper enrichment + sub-agent dispatch + validation.

### Step C0 — Pre-flight

- [ ] Read `PIPELINE_LESSONS.md` (10 min)
- [ ] `.env` has `PROSPEO_API_KEY`, `SERPER_API_KEY`, `SMARTLEAD_API_KEY`
- [ ] `client-profile.yaml` exists for client
- [ ] `vertical_industries` map in client-profile is per-vertical-distinct (NOT shared NAICS across apparel + footwear + denim — that caused 5 wasted Prospeo credits on showcase)

### Step C1 — Per-vertical Prospeo pull

```bash
# Pull 1 page per vertical first. Verify lead quality before scaling.
npx tsx scripts/pipeline/_pull-missing-verticals.ts
```

If page 1 returns wrong-vertical leads (e.g. apparel brands in footwear pull) → STOP. Fix `vertical_industries` map. Do NOT pull more pages.

### Step C2 — ICP score (per vertical, parallel sub-agents)

Always dump real CSV data verbatim into scoring prompts:

```bash
awk -F',' 'NR>1{print $4" | "$5" | "$12" | "$13}' leads-raw-{vertical}.csv | head -25
```

Copy output into sub-agent prompt. **DO NOT confabulate lead names from memory.** That was the #1 mistake on showcase run.

Sub-agent returns JSON scoring → save to `data/runs/{run-id}/scoring/{client}-{vertical}.json`.

### Step C3 — Build qualified inputs

```bash
npx tsx scripts/pipeline/_build-qualified-inputs.ts
```

Filter raw + scoring intersection at confidence ≥ 0.7. Writes `data/runs/{run-id}/qualified/{client}-{vertical}.csv`.

### Step C4 — Email pipeline (Serper + batch prompts)

```bash
npx tsx scripts/pipeline/_email-pipeline.ts \
  --leads data/runs/{run-id}/qualified/{client}-{vertical}.csv \
  --vertical {vertical} --client {client} \
  --out data/runs/{run-id}/pipeline-out/{client}-{vertical}
```

What it does:
1. Reads CSV
2. Serper-fetches 1 dated fact per lead (3 query variants, picks best by recency + verb + URL quality)
3. Runs fact-richness gate (requires 2025/2026 year + action verb + source URL)
4. Thin facts → `skipped-thin.json` (DO NOT dispatch these)
5. Rich facts → batches of 5 → writes `batch-N-prompt.txt` files with locked template

### Step C5 — Dispatch each batch prompt to sub-agent

For each `batch-N-prompt.txt`:
- Dispatch as sub-agent in background
- When complete, save returned JSON to `data/runs/{run-id}/emails/{client}-{vertical}-batch-N.json`

### Step C6 — Validate IMMEDIATELY per batch

```bash
npx tsx scripts/pipeline/_validate-emails.ts \
  --in data/runs/{run-id}/emails \
  --report data/runs/{run-id}/validate-report.json
```

Hard rules checked:
- E1 starts lowercase `[first],` (with optional `hi/hey` prefix)
- E1 ends with `?`
- No em dashes (`—`)
- No exclamations (`!`)
- No banned phrases

**Hard fail = re-dispatch that batch with stricter prompt.** Don't move on with broken outputs.

### Step C7 — Add paragraph breaks (skim-readability)

```bash
npx tsx scripts/pipeline/_add-paragraph-breaks.ts \
  --in data/runs/{run-id}/emails --dry-run

# verify dry-run output, then run for real:
npx tsx scripts/pipeline/_add-paragraph-breaks.ts \
  --in data/runs/{run-id}/emails
```

Inserts `\n\n` after first sentence and every ≥20-word chunk. Abbreviation-safe (Dr./Mr./Inc./U.S./etc don't trigger split). **Backup originals first** — script writes in place.

### Step C8 — Aggregate to per-vertical CSVs

```bash
npx tsx scripts/pipeline/_aggregate-showcase.ts
```

Outputs:
- `data/runs/{run-id}/final/{client}-{vertical}.csv` per vertical
- `data/runs/{run-id}/final/_master.csv` everything

### Step C9 — Smartlead push (HTML conversion at push time, NOT pre-baked)

JSON storage keeps `\n\n` as source of truth. Convert to HTML at push:

```ts
import { toSmartleadHtml } from './scripts/pipeline/_smartlead-html';

// At Smartlead campaign-sequence create:
const sequenceStep = {
  subject: lead.email1.subject,
  body: toSmartleadHtml(lead.email1.body),  // \n\n -> <br><br>
};
```

`_smartlead-html.ts` rules:
1. Normalize line endings (`\r\n` / `\r` → `\n`)
2. Collapse 3+ blank lines → 2
3. Protect spintax `{a|b}` + merge tags `{{first_name}}` from touching
4. `\n\n` → `<br><br>`, remaining `\n` → `<br>`

### Step C10 — Smartlead campaign upload (ALWAYS DRAFT)

```bash
npx tsx skills/smartlead-campaign-upload-public/scripts/upload.ts \
  --csv data/runs/{run-id}/final/{client}-{vertical}.csv \
  --campaign {CLIENT}-{CATEGORY}-{ANCHOR}-{YEAR}{QUARTER}
```

`smartlead-campaign-upload-public` ALWAYS creates campaigns in DRAFT. Review in Smartlead UI. Hit Start manually.

### Cost benchmarks (from showcase-2026-05-28)

- 300 leads = ~$3 Serper + 13 Prospeo credits + ~1.2M tokens (Sonnet)
- Per lead = ~$0.01 Serper + ~4k output tokens
- Quality at 8.5/10 when fact-rich + ≥20 word paragraph breaks

---

## Pipeline changelog

### v6 (May 28-29 2026) — Showcase hardening + spacing + Smartlead conversion
- `_email-pipeline.ts`: end-to-end Serper prebake + fact-richness gate + batched prompts
- `_serper-prebake.ts`: standalone Serper fact fetcher
- `_validate-emails.ts`: hard-rule validator (8 rules, programmatic check post-sub-agent)
- `_add-paragraph-breaks.ts`: mechanical splitter with abbreviation guard (Dr./Inc./U.S./etc)
- `_smartlead-html.ts`: JSON `\n\n` → HTML `<br><br>` conversion at push time, protects spintax + merge tags
- `PIPELINE_LESSONS.md`: 12 mistakes documented from showcase run
- Hard-banned: WebSearch inside sub-agent (was ~50-60k tokens/batch, now Serper prebake = ~40k tokens/batch)
- Hardcap: 5 leads per sub-agent dispatch (6+ degrades quality)
- Never write lead lists from memory — always `awk` dump from real CSV

### v5 (May 2026) — Signal-aware rendering
- `render-with-signals.ts` replaces `render-multivertical.ts` as standard render path
- Signal extraction: `extract-signals.ts` (Serper → company sidecars), `fetch-pnd-signals.ts` (PND → person sidecars)
- Bridge sentences: AI-generated 1-sentence connectors between signal fact and anchor proof
- 5 copy quality fixes from May 2026 review calls: fact truncation, bridge subject rule, hedge-inference rule, anchor proof compression, generic-fact filter
- Email 2 is now a threaded follow-up (empty subject, ≤65 words, bumps thread)
- LeadMagic email reveal now scripted: `reveal-emails-leadmagic.ts`
- PND integration: W1/W2/W3 eligibility checks now live (`validate-lead-eligibility.ts`)

### v4 (April 2026)
- Added `validate-final.ts` with 15 checks
- Added StatRotator to ensure E1/E2 use distinct stats

### v3 (March 2026)
- Retired Variant A (format-observation, fabrication risk)
- Added B/C routing on `ai_similarity_dimension`

---

## Why this exists (the meta-point)

The skills are building blocks. This playbook is the *operating procedure that strings them together.* Without it, every campaign run starts from scratch + repeats the same bugs.

If you change something fundamental about the pipeline (new variant, new validator check, new subagent pattern), update this playbook.
