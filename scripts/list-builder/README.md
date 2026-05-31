# List-Builder — standalone qualified-list pipeline

Build qualified, deduped, validated lead lists. Two input modes, shared
suppression + enrichment + scoring. **Isolated from the cold-email pipeline** —
this never touches `scripts/pipeline/*` or the 16 email-writing rules.

## What it does

```
filters OR niche source -> pull -> SUPPRESS -> enrich+validate -> ICP score -> qualified.csv
```

- **Suppression (3 layers):** static exclude CSV + client `excluded_domains`, auto-grown `contacted-ledger.json` (every past run), optional Smartlead "already-emailed".
- **Enrich:** email waterfall (Prospeo finder) + MillionVerifier validation. Reuses `auto-research-public/phase-enrich.ts` as a subprocess.
- **Score:** Claude Code Task sub-agents vs an ICP prompt. Client-agnostic.
- **Output:** `qualified.csv` (conf >= 0.6) + `rejected.csv`. Survivors appended to the ledger so they're never re-targeted.

## Env needed

```
PROSPEO_API_KEY            # pull + email finder
MILLIONVERIFIER_API_KEY    # validation (warn-only if missing)
SMARTLEAD_API_KEY          # only for --suppress-smartlead
```

No Anthropic key — scoring uses Claude Code sub-agents (the controller dispatches them).

---

## Mode A — filters -> list

### 1. Write a Prospeo filters JSON

```json
{
  "job_title": ["VP Sales", "Head of Sales"],
  "company_industry": ["Software"],
  "company_headcount": ["51-200", "201-500"],
  "company_country": ["United States"]
}
```
(See `skills/prospeo-search-api/SKILL.md` for the full filter schema.)

### 2. Stage 1 — pull + suppress + enrich + write score prompts

```
npx tsx scripts/list-builder/build-list.ts \
  --filters=/path/filters.json \
  --client=mythic \            # optional: loads profiles/mythic/icp-prompt.txt + excluded_domains
  --max-leads=300 \
  --exclude-csv=/path/exclude-domains.csv \   # optional extra suppression
  --suppress-smartlead          # optional: drop anyone already in Smartlead
```

Client resolution for ICP:
- `--icp-prompt=<path>` → use that file
- `--client=<slug>` → `profiles/<slug>/icp-prompt.txt` (or `-allverticals`)
- neither → built-in `_generic-icp-prompt.txt`; pass `--icp-desc="VP Sales at US B2B SaaS 50-500"` to fill it

Stage 1 prints a run dir and a batch count.

### 3. Dispatch sub-agents (controller / Claude Code does this)

For each `score-prompts/batch-NN.txt` in the run dir, dispatch a sub-agent that
reads it and saves the JSON array to `score-results/batch-NN.json`.

### 4. Stage 2 — merge + write CSV + update ledger

```
npx tsx scripts/list-builder/build-list.ts --finalize --run=<runDir> --min-confidence=0.6
```

Outputs `qualified.csv` + `rejected.csv` in the run dir.

---

## Mode B — niche-DB scrape

Category-driven. A registry maps category -> source(s). Add sources incrementally.

```
# list what's available
npx tsx scripts/list-builder/_niche-scrape.ts --list-sources

# pull a source into a run dir
npx tsx scripts/list-builder/_niche-scrape.ts \
  --source=sec_form4 \
  --out=data/list-builder/runs/<ts>/pulled.json
```

Then run the same suppress -> enrich -> score stages (wire via build-list, or
call `_suppress` / `_enrich` / `_score` directly — same shape as Mode A).

Currently registered: `sec_form4` (SEC EDGAR insider filings, public, no key).
Add chambers / directories by registering a new entry in `SOURCES` inside
`_niche-scrape.ts`.

---

## Files

| File | Role |
|---|---|
| `build-list.ts` | Mode A orchestrator (2 stages) |
| `_niche-scrape.ts` | Mode B category-driven scraper + source registry |
| `_suppress.ts` | 3-layer suppression |
| `_ledger.ts` | persistent contacted ledger |
| `_score.ts` | client-agnostic ICP scorer (subagent prompts + merge) |
| `_enrich.ts` | email waterfall + validation wrapper |
| `_generic-icp-prompt.txt` | built-in ICP when no client given |

## Isolation guarantee

This folder imports `../_prospeo_client.ts` and `../_csv_io.ts` read-only and
shells out to `auto-research-public/phase-*.ts`. It edits **zero** files in
`scripts/pipeline/`. The cold-email quality rules are untouched. The
`qualified.csv` is consumable by the email pipeline later, but list-builder
never invokes it.
