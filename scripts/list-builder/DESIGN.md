# Standalone List-Builder Pipeline — Design

**Goal:** Build qualified, deduped, validated lead lists as a standalone entry point — usable by colleagues, runnable without driving the cold-email pipeline. Two input modes: (A) ICP filters → Prospeo/Blitz pull, (B) niche-DB scrape. Shared dedup + validate + score + CSV output.

**Status:** Design — awaiting approval before build.

---

## Hard requirements (from user)

1. **MUST NOT degrade cold-email pipeline quality.** List-builder is isolated. Imports shared clients read-only. Touches zero email-pipeline files. The 16 cold-email rules and `_e1-rewrite-*`, `_validate-emails.ts`, `_aggregate-showcase.ts` are untouched.
2. **Good standalone list output.** Qualified CSV usable on its own (name, title, company, domain, email, email_status, icp_qualified, icp_confidence, icp_reason, signal, source).
3. **Exclusion + already-reached-out dedup.** Layered suppression, never re-target.

## Two input modes

### Mode A — Filters → list
```
ICP filters (title/industry/headcount/geo/count) + client
  → Prospeo pull (+ Blitz fallback for thin verticals)
```
Reuses: `skills/auto-research-public/scripts/phase-prospeo.ts`, `skills/blitz-list-builder/scripts/find-contacts.ts`, `scripts/_prospeo_client.ts`.

### Mode B — Niche-DB scrape
```
source URL + extraction schema (e.g., SEC Form 4, chamber directory)
  → scrape contacts → normalize to lead shape
```
Net-new: `_niche-scrape.ts`. Output feeds same downstream stages as Mode A.

## Shared downstream (both modes)

```
[dedupe]   layered suppression (see below)
[enrich]   email waterfall: Smartlead finder → Prospeo → LeadMagic   (reuse phase-enrich.ts)
[validate] MillionVerifier → keep valid, flag catch-all
[score]    ICP score vs profiles/<client>/icp-prompt.txt
             --engine=subagent (default, free, Claude Code Task)
             --engine=api       (Anthropic API, standalone for colleagues)
[output]   qualified.csv (conf >= 0.6) + rejected.csv sidecar
[ledger]   append output domains to contacted-ledger.json
```

## Layered suppression (req #3)

| Layer | Source | Always on? | Catches |
|---|---|---|---|
| 1 Static exclude | `exclude-domains.csv` + client-profile.yaml `excluded_domains` | yes | competitors, existing clients, partners |
| 2 Auto-ledger | `data/list-builder/contacted-ledger.json` | yes | anyone any past run output |
| 3 Smartlead live | Smartlead API `get_all_leads` | opt-in `--suppress-smartlead` | anyone actually emailed |

Order: pull → drop L1 → drop L2 → drop L3 → enrich → validate → score → CSV → append survivors to ledger (L2 grows each run).

Dedup key: normalized domain + normalized email (lowercase, strip www, strip +tags).

## File layout

```
scripts/list-builder/
  DESIGN.md                  ← this
  build-list.ts              ← entry: mode A orchestrator (filters → CSV)
  _niche-scrape.ts           ← mode B: URL + schema → leads
  _suppress.ts               ← layered dedup (3 layers)
  _score.ts                  ← ICP scorer, engine-switched (subagent | api)
  _enrich.ts                 ← thin wrapper over phase-enrich waterfall
  _ledger.ts                 ← read/append contacted-ledger.json
  README.md                  ← colleague-facing how-to-run

data/list-builder/
  contacted-ledger.json      ← auto-grown suppression (gitignored)
  runs/<timestamp>/          ← qualified.csv, rejected.csv, run-meta.json
```

## Isolation proof (req #1)

- New folder `scripts/list-builder/`, no edits to `scripts/pipeline/*`
- Imports `../_prospeo_client.ts`, `../_csv_io.ts` read-only (no mutation)
- Score reuses `icp-prompt.txt` + anchor-category + relevance pattern (rules 10/13/16) — consistent with email pipeline, doesn't change it
- Output CSV is consumable by email pipeline later, but list-builder never invokes it

## Output CSV columns

```
full_name, title, company_name, domain, email, email_status,
icp_qualified, icp_confidence, icp_reason, relevance_signal,
source (prospeo|blitz|niche:<db>), pulled_at
```

## Cost (Mode A, 300 pulled → ~100 qualified)

| Item | Cost |
|---|---|
| Prospeo 300 | ~$5-8 |
| MillionVerifier 300 | ~$1.20 |
| ICP score (subagent) | $0 (Claude Code plan) |
| ICP score (api Haiku) | ~$0.60 |
| **Total subagent** | **~$6-9** |
| **Total api** | **~$7-10** |

## Build order (implementation plan)

1. `_suppress.ts` + `_ledger.ts` — suppression core (testable standalone)
2. `_score.ts` — engine-switched scorer (subagent default)
3. `build-list.ts` — Mode A orchestrator (pull → suppress → enrich → validate → score → CSV → ledger)
4. `_niche-scrape.ts` — Mode B
5. `README.md` — colleague run guide
6. `.gitignore` += `data/list-builder/`
7. Integration test on 20-lead sample (1 client, verify suppression + scoring + no email-pipeline files touched)

## Decisions (locked)

1. **Client-agnostic.** Not hardcoded to BW/Mythic. `--client <slug>` loads `profiles/<slug>/icp-prompt.txt` if it exists, OR `--icp-prompt <path>` for any custom prompt, OR a built-in generic ICP template when neither given. Colleagues bring their own client.
2. **Scoring engine = subagent only** for now. `--engine=api` is a stub flag that errors with "not yet wired" until we decide to build it. No ANTHROPIC_API_KEY needed.
3. **Niche-DB = category-driven.** `_niche-scrape.ts` maps a category → candidate source(s) (SEC, chambers, directories). Sources added incrementally at Mode B build. Not one hardcoded DB.
4. No ANTHROPIC_API_KEY in .env.example until API engine built.

## Client-agnostic ICP resolution order

```
--icp-prompt <path>           → use that file
--client <slug>               → profiles/<slug>/icp-prompt.txt (or icp-prompt-allverticals.txt)
neither                       → scripts/list-builder/_generic-icp-prompt.txt (built-in template)
```

Generic template asks colleague's filters inline (title fit, industry fit, headcount, B2B/B2C, disqualifiers) so it works with zero client setup.
