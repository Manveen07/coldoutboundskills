# New Client Onboarding Guide

*Quick-start for shipping a first campaign. See CAMPAIGN-PIPELINE-PLAYBOOK.md for full detail on each step.*

---

## Prerequisites checklist

| Item | Notes |
|---|---|
| `PROSPEO_API_KEY` | Required — list building |
| `SMARTLEAD_API_KEY` | Required — campaign upload |
| `LEADMAGIC_API_KEY` | Required — email reveal (used only after team approval) |
| `SERPER_API_KEY` | Required for v5 signal-aware render (extract-signals.ts) |
| `PND_API_KEY` | Optional — LinkedIn person signals (new_role/promotion); pipeline degrades gracefully without it |
| `DYNADOT_API_KEY` + `ZAPMAIL_API_KEY` | Infrastructure — domain + inbox setup |
| Client website URL | Needed for `/icp-onboarding` |
| Client legal sign-off | Confirm client has approved cold outbound for their brand |
| Anchor brand confirmed | At least one named case-study brand per category before list-building at scale |

---

## Step-by-step: first campaign for a new client

### 1. Run `/icp-onboarding`

Conversational skill (~30 min). Scrapes website + asks ~10 questions.

**Output:** `profiles/<client-slug>/client-profile.yaml`

Must contain: `icp.hard_filters`, `aov_floors_by_subcategory`, `vertical_anchor_map`, `anchor_proof_per_category`.

### 2. Run `/icp-prompt-builder`

Generates the AI qualifier prompt (6 MUST-be-true + 6 disqualifiers).

**Output:** `profiles/<client-slug>/icp-prompt.txt`

Run this before any list-building at scale. Re-use for every campaign under this client.

### 3. Pull raw leads (pick ONE category)

**Full export:**
```
/prospeo-full-export
```

**Trial / test pull (1-2 credits, ~25-50 leads):**
```bash
VERTICAL_GROUP=home MAX_CREDITS=2 npx tsx scripts/prospeo-trial-search.ts
```

**Output:** `leads-raw.csv` + `prospeo-raw-{batch}.json` sidecars

Spot-check raw CSV before burning more credits. If >20% look off-ICP → tighten filters first.

### 4. Qualify leads with AI subagents → merge

- Pre-split raw CSV into ~50-row chunks
- Dispatch one `general-purpose` subagent per chunk (parallel)
- Each subagent writes `leads-qual-batch-<N>.csv` (`qualified`, `qual_confidence`, `qual_reason`)

Merge:
```bash
npx tsx scripts/merge-qual-v2.ts
```

**Output:** `leads-all-with-qual.csv`

### 5. Enrich qualified leads (4 AI variables)

Dispatch enrichment subagents (same pre-split pattern). Each uses `clay-personalization-prompts.md` verbatim. Writes 4 variables per row:

- `ai_similarity_dimension`
- `ai_brand_category`
- `ai_role_hook`
- `ai_catalog_observation`

### 6. Extract company signals

```bash
npx tsx scripts/extract-signals.ts leads-all-with-qual.csv data/signals/
```

Fetches Serper results per company domain. Writes JSON sidecars to `data/signals/`. Cache-aware (90-day TTL hits, 7-day TTL misses). Needs `SERPER_API_KEY`.

### 7. Fetch person signals (optional)

```bash
npx tsx scripts/fetch-pnd-signals.ts leads-all-with-qual.csv
```

Detects `new_role` (new company, <90 days) and `promotion` (same company, new title, <90 days). Writes sidecars to `data/person-signals/`. Needs `PND_API_KEY`. Skip if unavailable — pipeline degrades gracefully.

### 8. Generate bridge sentences

```bash
# Step 1: prepare tasks
npx tsx scripts/prepare-bridge-prompts.ts leads-with-signals.csv data/bridge-tasks.json data/bridge-responses/

# Step 2: dispatch Task subagents (one per bridge task) to write response files
```

Only leads with real signals (funding, press, new_role, promotion, product_launch, acquisition) get a bridge. Fallback/snippet leads skip automatically.

### 9. Render 4-email sequence (v5 signal-aware)

```bash
npx tsx scripts/render-with-signals.ts leads-with-signals.csv leads-final-v5.csv data/bridge-responses/
```

Signal priority: `new_role > promotion > acquisition > funding > product_launch > press > company_snippet > fallback`

**Output:** `leads-final-v5.csv`

### 10. Validate

```bash
npx tsx scripts/validate-final.ts
```

All checks must PASS before proceeding. Fix failures before upload.

### 11. Split by campaign

```bash
npx tsx scripts/split-by-campaign.ts
```

**Output:** one CSV per category in `smartlead-campaigns/`

### 12. Team review (human gate)

- Team reads `<CAMPAIGN-NAME>-CONTEXT.md`
- Team reads 10 sample emails (5 B + 5 C) out loud
- Flag any off-sounding row → Slack row number → re-render or pull
- 10/10 sound good → approve

**Do not reveal emails before this step.**

### 13. Reveal emails (after approval only)

```bash
npx tsx scripts/reveal-emails-leadmagic.ts
```

~$0.09/email. Never run before team approval.

### 14. Upload to Smartlead as DRAFT

```
/smartlead-campaign-upload-public
```

Always creates as DRAFT. Human inspects in UI, clicks Start — never Claude.

---

## Adding a second/third category (same client)

`client-profile.yaml` and `icp-prompt.txt` already exist. Re-use them as-is.

1. Pick next category from `vertical_anchor_map` — note its anchor brand
2. Re-run from **Step 3** (Prospeo pull) with new vertical filter
3. Same AI prompts apply — no rebuild needed
4. New anchor auto-loads from `vertical_anchor_map` in `client-profile.yaml`
5. New campaign folder: `campaigns/<new-campaign-folder>/`

---

## Key rules

1. One category at a time — never multi-vertical pulls in production
2. Run `/icp-prompt-builder` before list-building at scale
3. Never reveal emails before team approval
4. Smartlead upload is always DRAFT — human clicks Start, not Claude
5. Run `validate-final.ts` before every upload — all checks must pass

---

## Folder structure per campaign

```
profiles/<client-slug>/
  client-profile.yaml
  icp-prompt.txt
  campaigns/<campaign-folder>/
    variants.yaml
    clay-personalization-prompts.md
    leads-raw.csv
    leads-all-with-qual.csv
    leads-final-v5.csv              ← signal-aware render output
    data/
      signals/                      ← company signal sidecars (extract-signals.ts)
      person-signals/               ← PND person sidecars (fetch-pnd-signals.ts)
      bridge-tasks.json
      bridge-responses/             ← AI bridge sentence files
    smartlead-campaigns/
      <CAMPAIGN-NAME>.csv
      <CAMPAIGN-NAME>-CONTEXT.md
```

---

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `SMARTLEAD_API_KEY` | Always | Campaign upload |
| `PROSPEO_API_KEY` | Always | List building |
| `LEADMAGIC_API_KEY` | Always | Email reveal (after team approval only) |
| `SERPER_API_KEY` | Yes (v5) | Company signal extraction via extract-signals.ts |
| `PND_API_KEY` | Optional | LinkedIn person signals — new_role/promotion detection; degrades gracefully without it |
| `DYNADOT_API_KEY` | Infrastructure | Domain setup |
| `ZAPMAIL_API_KEY` | Infrastructure | Inbox setup |
