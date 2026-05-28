# Cold Email Pipeline (`scripts/pipeline/`)

One config-driven pipeline. Adding a new client requires writing one YAML.

## Quick start

```bash
# Dry-run (no API calls, verifies wiring)
npx tsx scripts/pipeline/run.ts --client mythic --category qsr --dry-run

# Smoke run (3 leads first, then asks before doing the rest)
npx tsx scripts/pipeline/run.ts --client mythic --category qsr --smoke

# Full run (preflight cost gate + smoke option appears interactively)
npx tsx scripts/pipeline/run.ts --client mythic --category qsr

# Offline (cache-only, zero API spend)
npx tsx scripts/pipeline/run.ts --client mythic --category qsr --offline
```

## Pipeline stages

| Stage | Module | What it does | API cost |
|------|--------|--------------|----------|
| 1. Lead pull | `_pull.ts` | Prospeo paginated search via client YAML filters | Prospeo: 1 credit per page |
| 2. ICP score | `_score.ts` | Opus sub-agent qualifier, batched per 10 leads | Free (sub-agent) |
| 3a. Web research (free) | `_web_research.ts` | Sub-agent uses WebFetch + WebSearch first | Free (sub-agent) |
| 3b. Serper (gaps only) | `_research.ts` | Only fires Serper queries for signals web research couldn't find | Serper: 1 credit per query |
| 3c. Scrape (free) | `_scrape.ts` | HTTP fetch homepage + /about + /team, parse for tech signals | Free |
| 3d. Person depth (T3 only) | `_research.ts` | Extra Serper queries about the individual | Serper: ~3 per T3 lead |
| 4. Email write | `_write.ts` | Opus sub-agent writes all 4 emails per lead | Free (sub-agent) |
| 5. Validate | `_validate.ts` | 3-stage validator (mechanical regex, semantic LLM, recipient role-play) | Free (sub-agent) |
| 6. Quality gate | `../_quality_gate.ts` | Human approval before final CSV | n/a |

## Tiered research

| Tier | Trigger | What runs |
|------|---------|-----------|
| T1 | Default (icp_confidence < 0.8) | Web research + minimal Serper + scrape |
| T2 | icp_confidence >= 0.8 | T1 + deeper Serper + scrape |
| T3 | icp_confidence >= 0.9 OR domain in `priority_domains` | T2 + person-level Serper |

## Cache (`data/research-cache/`)

Every API response is written to disk BEFORE parsing. If an extractor bug surfaces,
re-run with `--offline` to replay from cache — zero new API calls.

```bash
# Audit current cache
npx tsx scripts/pipeline/cache-stats.ts

# Re-extract from cached Serper responses (zero credits)
npx tsx scripts/pipeline/run.ts --client mythic --category qsr --offline

# Wipe cache for one domain (requires exact-domain confirm)
npx tsx scripts/pipeline/recover.ts --clear-cache --confirm-domain=mythic.us
```

## Credit safety

Every run prompts with a pre-flight cost estimate:

```
PIPELINE PRE-FLIGHT -- mythic / qsr
  Leads to process:        103
  Already in cache:        12
  Serper credits planned:  455
  Prospeo pages:           0
  Sub-agent calls (free):  ~700
  Proceed? (yes / no / smoke / dry-run):
```

Hard caps in `config/limits.yaml`. Run aborts mid-flight if exceeded.

## Run artifacts

Every run writes to `data/runs/{timestamp}-{client}-{category}/`:

```
preflight.json      cost estimate at start
locked-prompts.md   exact prompts used (if smoke ran)
pipeline.log        every API call + sub-agent dispatch
failures.json       leads that fell back or failed
raw-leads.csv       Stage 1 output
scored-leads.csv    Stage 2 output
dossiers/           Stage 3 output (one JSON per lead)
output.csv          final result ready for Smartlead manual import
final-stats.json    end-of-run summary
```

## Adding a new client

1. Run `/icp-onboarding` skill — interviews you, scrapes website, writes `profiles/{client}/client-profile.yaml`
2. Run `/icp-prompt-builder` skill — tunes `profiles/{client}/icp-prompt.txt`
3. Add 3-5 example emails to `profiles/{client}/example-emails.md`
4. Run `npx tsx scripts/pipeline/run.ts --client {new_client} --category {vertical} --smoke`
5. Smoke confirms quality → full run

## For sub-agents executing this pipeline

If you're a Claude Code sub-agent dispatched to a pipeline task:
- Read `docs/sub-agent-runbook.md` for the per-stage protocol
- Don't run Serper or Prospeo without dry-run first
- Always check `cache-stats.ts` before estimating cost
- Never modify `profiles/*/client-profile.yaml` without explicit user request
