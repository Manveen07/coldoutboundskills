# coldoutboundskills — Complete Repo Walkthrough

How the cold email pipeline works end-to-end. What each file does. How to run it.

This doc assumes zero context. Read top-to-bottom on first pass.

---

## TL;DR

This repo is a **collection of Claude Code skills + supporting TypeScript scripts** that runs the full cold email pipeline for B2B agencies:

1. Onboard a new client → produce ICP profile YAML
2. Pull leads from Prospeo by ICP filter
3. Score every lead against the ICP via sub-agent qualification
4. Research each qualified lead (Serper news + company signal mining)
5. Write a 4-email sequence per lead following the read-aloud framework
6. Validate hard rules (no jargon, lowercase opener, length caps, anchor-category match)
7. Aggregate to per-vertical CSV with reasoning columns
8. Push to Smartlead as DRAFT campaign
9. After send, score replies with positive-reply skill and decide which categories to scale

There is no application server. Skills are invoked via slash commands inside Claude Code. Scripts run via `npx tsx <path>`.

---

## Repository Layout

```
coldoutboundskills/
├── skills/                    29 user-invocable skills (each has SKILL.md frontmatter)
├── scripts/                   ~60 root scripts + scripts/pipeline/ (~37 pipeline-specific)
├── profiles/                  per-client config (client-profile.yaml, icp-prompt.txt, etc.)
├── data/runs/                 per-campaign run outputs (showcase-2026-05-28 is the reference run)
├── docs/                      cross-skill docs (roadmap, etc.)
├── CLAUDE.md                  setup + canonical skill flow (loaded by Claude Code automatically)
├── README.md                  high-level intro
├── PIPELINE_LESSONS.md        12 hard-won rules from showcase-2026-05-28 runs (read this before building)
├── CAMPAIGN-PIPELINE-PLAYBOOK.md    long-form pipeline doc (676 lines)
├── REPO-WALKTHROUGH.md        this file
└── package.json               minimal — only tsx + a few runtime deps
```

---

## How Skills Work

A **skill** is a Claude Code instruction set. Each lives in `skills/<name>/SKILL.md` with frontmatter `name:` and `description:`. Claude Code reads the frontmatter at session start and loads the full skill body when invoked.

Inside a skill body:
- Steps the agent should follow
- Shell commands to run (point at `scripts/...ts` files via `npx tsx`)
- Validation checks
- What to do if a step fails

**Skills are user-facing.** You invoke `/icp-onboarding` and the orchestrator walks you through the conversation. The TypeScript scripts under `scripts/` are the working layer — they call APIs, manipulate CSVs, dispatch sub-agents.

---

## The Canonical Flow

```
/cold-email-kickoff                  ← single start-here orchestrator
  ↓
/icp-onboarding                     → profiles/<client>/client-profile.yaml
  ↓
/lead-magnet-brainstorm             → adds offer ideas to YAML
  ↓
/campaign-strategy                  → docs/<client>-campaign-strategy.md
  ↓
/zapmail-domain-setup-public        → domains + inboxes (skip if infra exists, 2-week warmup)
  ↓
/smartlead-inbox-manager            → connect inboxes, set tags, enable warmup
  ↓
list-builder skill                  → e.g. /prospeo-full-export, /disco-like, /blitz-list-builder
   ├─ requires /icp-prompt-builder first (tunes the ICP scoring prompt against 50-lead sample)
  ↓
/list-quality-scorecard             → grades the list before send
  ↓
/campaign-copywriting               → variants.yaml (E1-E4 templates)
  ↓
/spam-word-checker                  → flags risky language
  ↓
/smartlead-campaign-upload-public   → DRAFT campaign in Smartlead UI
                                       always DRAFT — you hit Start manually
  ↓
[ send the campaign ]
  ↓
/positive-reply-scoring             → after 14 days, classifies replies + reports positive %
  ↓
/experiment-design                  → decide next round
```

The full decision tree lives at `docs/roadmap.md`.

---

## Skills Catalog (29 total)

### Orchestrators / Onboarding
| Skill | Purpose |
|---|---|
| `cold-email-kickoff` | Single start-here. Runs icp-onboarding → lead-magnet → strategy in sequence. Produces `campaign-plan.md`. Ends with an interactive menu. |
| `icp-onboarding` | Conversational interview. Outputs `profiles/<client>/client-profile.yaml`. Hard vs soft filters, banned phrases, tone, offer. |
| `lead-magnet-brainstorm` | 5-10 free-offer ideas you can put in cold emails. Triggers when icp-onboarding flags missing magnet. |
| `campaign-strategy` | 15-25+ campaign experiment ideas, each with targeting + personalization angle. |

### Infrastructure (one-time per account)
| Skill | Purpose |
|---|---|
| `zapmail-domain-setup-public` | Buy domains on Dynadot, point at Zapmail, create inboxes, export to Smartlead. End-to-end domain bootstrap. |
| `smartlead-inbox-manager` | Bulk: enable warmup with correct ramp, set signatures, tag inboxes (active vs insurance), pull inbox health dashboards. |
| `email-deliverability-audit` | Diagnostic: SPF/DKIM/DMARC + inbox health + bounce-by-inbox-type + optional Smart Delivery spam test. Produces markdown report. |
| `deliverability-test-public` | Compares reply/bounce/positive-reply rates by inbox type (SMTP/Gmail/Outlook). |
| `deliverability-incident-response` | Decision-tree triage when something breaks ("landed in spam", "bounce spike", "domain blacklisted"). |

### List Building (each requires /icp-prompt-builder first)
| Skill | Best for |
|---|---|
| `prospeo-full-export` | Title + industry + headcount + geography filters via Prospeo. Largest databases. State-by-state crawling to beat 25K limit. |
| `disco-like` | Lookalike search via 65M-domain database. Seed with 3-10 reference companies. |
| `blitz-list-builder` | Domain-to-people lookup. Best for SMB owner-finding when you already have company domains. |
| `google-maps-list-builder` | Local SMB scrape by category + location. Restaurants, clinics, gyms, etc. |
| `competitor-engagers` | LinkedIn engagement scrape. Pulls commenters + reactors on competitor posts. |
| `prospeo-search-api` | Reference doc for raw Prospeo API filters + rate limiting. |
| `icp-prompt-builder` | Iterative loop: scores 10 sample companies, you correct, repeat until 2 clean rounds. Saves tuned prompt for reuse at scale. |
| `list-quality-scorecard` | Pre-send grade: duplicates, title diversity, catch-all rate, ICP fit, verification coverage. |
| `leadmagic-email-reveal` | Reveals work emails from LinkedIn URLs via LeadMagic. |

### Copy
| Skill | Purpose |
|---|---|
| `campaign-copywriting` | Stepwise confirmation flow. Reads `client-profile.yaml`, produces `variants.yaml` with A/B/C subject + body variants for E1-E4. |
| `personalization-subagent-pattern` | Reusable approval-loop: 1 sample → user feedback → 10 more → approve → 10 more. Always uses Claude Code sub-agents, never API. |
| `spam-word-checker` | Always-on guardrails. Auto-triggers when copywriting is active. |
| `smartlead-spintax` | Adds Smartlead-format spintax `{a\|b\|c}` for deliverability variation. |

### Send + Track
| Skill | Purpose |
|---|---|
| `smartlead-campaign-upload-public` | Uploads CSV + variants.yaml as DRAFT campaign. Tag-scoped inbox selection, A/B/C variant assembly, schedule config. **Always DRAFT** — you hit Start in UI. |
| `smartlead-api` | Reference doc for all Smartlead endpoints + auth + rate limits. |
| `auto-research-public` | Autonomous daily campaign launcher. One domain in → full campaign out → DRAFT in Smartlead. Requires `client-profile.yaml` + 20+ active inboxes + MillionVerifier key. |
| `positive-reply-scoring` | After 14 days: pulls Smartlead replies, classifies each (positive/neutral/negative/OOO/bounce/unsubscribe), reports positive %. |
| `experiment-design` | Framework for single-variable tests. List-only vs copy-only vs combined. |

### Operational
| Skill | Purpose |
|---|---|
| `cold-email-starter-kit` | Bundle: end-to-end first-campaign guide. Domain purchase → list → copy → enrich → send. Includes shared `_lib.ts`. |
| `cold-email-weekly-rhythm` | Operational playbook. Mon/Wed/Fri/biweekly/monthly cadence prescription. |

---

## Pipeline Scripts (where the actual work happens)

Scripts under `scripts/pipeline/` are the showcase-2026-05-28 reference pipeline. Each is self-contained, runs via `npx tsx scripts/pipeline/_NAME.ts`. Most accept `--in`, `--report`, etc. flags.

### Lead pull + filter
| Script | What it does |
|---|---|
| `_pull.ts` | Prospeo paginated pull by ICP filter. Writes raw CSV. |
| `_pull-topup-v2.ts` | Same but for top-up after initial pass (catch missing verticals). |
| `_pull-missing-verticals.ts` | Targeted top-up for verticals under quota. |

### ICP scoring
| Script | What it does |
|---|---|
| `_score.ts` | Dispatches sub-agents against `profiles/<client>/icp-prompt.txt`. Writes JSON scores per lead. |
| `_select-seed-leads.ts` | Picks N leads per vertical for sub-agent prompts. |
| `_build-qualified-inputs.ts` | Intersects raw CSV with score outputs → qualified-only set. |
| `_icp-backfill-prep.ts` | Builds ICP scoring batch prompts for any lead missing a score. Used in v2 backfill. |

### Research
| Script | What it does |
|---|---|
| `_serper-prebake.ts` | Per-lead Serper news search. Picks best fact (date + verb + URL). Writes `facts/*.json`. |
| `_serper-backfill.ts` | Same for missing-domain backfill. |
| `_research.ts` | Full per-lead research dispatch (web + Prospeo signals + LinkedIn). |
| `_web_research.ts` | Generic web research sub-agent invoker. |

### Email writing
| Script | What it does |
|---|---|
| `_email-pipeline.ts` | Main per-batch pipeline. Reads dossier → builds prompt → dispatches sub-agent → writes E1-E4 JSON. |
| `_write.ts` | Lower-level email-writer wrapper. |
| `_e1-rewrite-batch-prep.ts` | Builds rewrite prompts for E1-only passes. Used in v2 read-aloud rewrite. |
| `_e1-rewrite-merge.ts` | Merges E1 rewrites back into source `emails/` JSONs. Backs up first. |

### Validation
| Script | What it does |
|---|---|
| `_validate-emails.ts` | Hard + soft rule check. 8 hard (lowercase opener, ends with ?, no em dash, no exclamations, no banned phrases, no acronyms in body) + soft (read-aloud sentence length, deck-speak, anchor-category match). |
| `_validate-e1-format.ts` | E1-specific 2-pass validator. Regex + LLM judge. |
| `_validate.ts` / `_signal-validate.ts` | Per-step validation utilities. |

### Output
| Script | What it does |
|---|---|
| `_aggregate-showcase.ts` | Joins emails + Serper facts + ICP scores → per-vertical CSV + `_master.csv`. 21 columns including `relevance_summary`. |
| `_add-paragraph-breaks.ts` | Mechanical sentence splitter with abbreviation guard (Dr./U.S./i.e./etc). Adds `\n\n` between paragraphs. |
| `_smartlead-html.ts` | Converts `\n\n` → `<br><br>` for Smartlead push. Protects `{{first_name}}` merge tags and `{a\|b}` spintax. |
| `_showcase-to-csv.ts` | Lower-level CSV writer used by aggregator. |

### Top-up + bookkeeping
| Script | What it does |
|---|---|
| `_topup-leads.ts`, `_topup-v2.ts` | Refill underfilled verticals. |
| `_select-p2.ts`, `_select-p2-v2.ts` | Pick second-pass leads for retry. |
| `_subagent_runner.ts` | Wrapper for dispatching sub-agents with consistent format. |
| `_run_artifacts.ts` | Bookkeeping: writes a manifest of all artifacts produced in a run. |

### Helpers
| Script | What it does |
|---|---|
| `_cache.ts` | Generic disk cache (Serper, Prospeo, dossier). |
| `_credit_guard.ts` | Hard cap on Prospeo + Serper credit burn per run. |
| `_limits.ts` | Rate limiter for API calls. |
| `_recover.ts` | Recovers a run from partial state. |
| `_smoke.ts` | Smoke test the pipeline on a tiny sample. |

---

## Root-Level Scripts (~60)

These are older / one-off / per-client utilities. Most-used:

| Script | What |
|---|---|
| `_csv_io.ts` | Read/write CSV helpers. Shared library. |
| `_client_config.ts` | Loads `profiles/<client>/client-profile.yaml`. |
| `_prospeo_client.ts` | Prospeo API wrapper. |
| `_serper_client.ts` | Serper API wrapper. |
| `_leadmagic_client.ts` | LeadMagic email-reveal API wrapper. |
| `_pnd_client.ts` | Person+Domain enrichment client. |
| `_openrouter_invoker.ts` | OpenRouter LLM call wrapper. |
| `_file_based_invoker.ts` | File-based sub-agent prompt/response handler. |
| `_ai_subagent.ts` | Direct sub-agent dispatch helper. |
| `_quality_gate.ts` | Fact-richness gate before email write. |
| `_fact_extractor.ts` | Extracts dated, source-attributed facts from research. |
| `_signal_selector.ts` | Picks the right signal based on tier + priority. |
| `_lib_signals.ts` | Signal definitions (new role, promotion, fundraise, etc.). |
| `_lib_tier.ts` | Lead tier definitions — drives depth of research per lead. |
| `_lib_banned.ts` | Banned-vocab regex library. |
| `_bridge_writer.ts` | Writes the bridge line that connects signal → CTA. |
| `_uniqueness_classifier.ts` | Flags emails that look too generic. |
| `_stat_rotator.ts` | Rotates between "3-8x ROAS" / "103% LTV" stat lines for variety. |
| `_query_templates.ts` | Prospeo query template library per vertical. |
| `_exclusion_list.ts` | Loads competitor + existing-customer domain block list. |
| `_category_resolver.ts` | Maps lead industry → BW/Mythic vertical category. |
| `mythic-*.ts` | Mythic-specific runners (score, render, search, signals). |
| `merge-*.ts` | Different merge passes between research runs. |
| `validate-final.ts` | Pre-Smartlead final gate (5K leads check). |
| `validate-lead-eligibility.ts` | Pre-send eligibility (domain on block list, etc.). |
| `prep-smartlead-for-signals.ts` | Reformats signal data for Smartlead custom fields. |
| `reextract-from-cache.ts` | Re-runs signal extraction on cached research blobs. |
| `_sheets_writer.ts`, `_upload-to-sheets.ts` | Google Sheets writer for client-facing review. |

---

## Profiles Directory

`profiles/<client>/` is where per-client configuration lives. Each has:

| File | What |
|---|---|
| `client-profile.yaml` | The ground truth. Hard filters, soft preferences, tone, offer, banned words, social proof, named clients, etc. Output of `/icp-onboarding`. |
| `icp-prompt.txt` | The qualification prompt sub-agents use to score leads. Output of `/icp-prompt-builder` (tuned over 5-10 rounds). |
| `icp-prompt-allverticals.txt` | Broader version covering full BW or Mythic vertical set. Used for backfill when vertical-specific scoring missed leads. |
| `example-emails.md` | Reference cold emails the client has approved. Style anchor for sub-agents. |
| `campaign-strategy.md` | Long-form strategy doc — output of `/campaign-strategy`. |
| `campaigns/` | Per-campaign output (variants.yaml, generated emails, etc.). |

Current profiles: `belardi-wong`, `mythic`.

---

## data/runs Layout

Each campaign run gets a dated folder under `data/runs/`. Reference run is `showcase-2026-05-28/`. Structure:

```
data/runs/showcase-2026-05-28/
├── inputs/                     raw Prospeo CSVs pulled per vertical
├── qualified/                  ICP-pass subset
├── topup/, topup-v2/           backfill pulls
├── facts/                      Serper prebake per vertical (`<client>-<vertical>.json`)
├── scoring/, scoring-p2/       ICP score outputs per vertical
├── pipeline-out/               intermediate per-lead dossiers
├── emails/                     final per-batch JSONs (one file per source batch — Katie / Miller's lives in mythic-qsr-batch-1.json)
├── emails_pre_e1_rewrite_backup/    snapshot before v1 E1 rewrite pass
├── emails_pre_spacing_backup/       snapshot before paragraph-break run
├── emails_pre_e1_v2_backup/         snapshot before v2 read-aloud rewrite
├── e1-rewrite-prompts/         v1 rewrite batch prompts
├── e1-rewrite-results/         v1 rewrite batch outputs
├── e1-rewrite-prompts-v2/      v2 read-aloud rewrite batch prompts
├── e1-rewrite-results-v2/      v2 read-aloud rewrite batch outputs
├── icp-backfill-prompts/       ICP score backfill prompts
├── icp-backfill-results/       ICP score backfill outputs (relevance_summary added here)
├── validate-*.json             per-pass validator reports
├── bw-showcase.csv, mythic-showcase.csv    client-specific exports
└── final/                      master CSV + per-vertical CSVs (deliverable)
    ├── _master.csv             21 cols x 300 rows. The main artifact.
    └── <client>-<vertical>.csv per-vertical splits
```

---

## End-to-End Walkthrough (Katie / Miller's Ale House example)

Picking one Mythic QSR lead and showing every stage. Walks the same lead through the full pipeline.

### Stage 1 — Input
```
lead:    Katie / Miller's Ale House
domain:  millersalehouse.com
title:   CMO
client:  mythic
vertical: qsr
```
Came from Prospeo via `_pull.ts` after the ICP filter pulled chain restaurant CMOs.

### Stage 2 — ICP scoring
`_score.ts` dispatched sub-agents using `profiles/mythic/icp-prompt.txt`. Result stored in `scoring/mythic-qsr.json` (or backfill).

```
icp_qualified:    true
icp_confidence:   0.92
icp_reason:       100+ location US sports-bar casual dining chain with CMO title and a crowded competitive set demanding share-of-voice spend.
```

### Stage 3 — Research dossier
`_research.ts` ran web + Serper. Wrote into the lead's JSON:

```
dossier_summary:
  Skillet Queso Dunks LTO launched March 2026. 100+ locations 10 states.
  Orlando HQ. Sports-bar casual dining vs Buffalo Wild Wings, Twin Peaks.

source_urls:
  https://www.prnewswire.com/news-releases/millers-ale-house-launches-new-skillet-queso-dunks-302707564.html

e1_facts_used:
  - "Skillet Queso Dunks LTO launched March 2026"
  - "100+ locations 10 states"
  - "Orlando HQ"
  - "Sports-bar casual dining vs Buffalo Wild Wings, Twin Peaks"
```

### Stage 4 — Serper prebake (independent fact)
`_serper-prebake.ts` ran `"Miller's Ale House" 2026 launches OR announces` and stored top result into `facts/_backfill.json`. Used later as `signal_fact` column.

### Stage 5 — Email write (v1)
`_email-pipeline.ts` built a sub-agent prompt embedding:
- The 4 dossier facts (NO-INVENTED-FACTS rule)
- Mythic anchor pool: Spectrum, MetLife, Ally, Subway, Meineke, Cone Health, Harley-Davidson, UnitedHealthcare
- 4-block framework: opener / fact+implication / solution+ONE proof / CTA
- Voice rules (lowercase opener, no em dash, banned phrases, 60-90 words)

Sub-agent returned v1 E1. Same agent wrote E2 / E3 / E4 in sequence.

### Stage 6 — v1 validation
`_validate-emails.ts` ran 8 hard rules. v1 E1 passed hard rules. But two soft fails:
- **Cone Health** anchor used → anchor-category mismatch (Cone Health is healthcare, Miller's is restaurant)
- 30-word opening sentence → read-aloud fail

### Stage 7 — v2 read-aloud rewrite
After user feedback "opener fails read-aloud test", added rules 9-12 to `PIPELINE_LESSONS.md` and `memory/feedback_cold_email_pipeline.md`. Rebuilt prompts via `_e1-rewrite-batch-prep.ts` (which embeds the new rules), dispatched 30 sub-agent batches, merged via `_e1-rewrite-merge.ts`.

v2 E1:
```
katie,

The Skillet Queso Dunks drop is a smart hook. But the fight against
Buffalo Wild Wings and Twin Peaks gets louder every quarter, and new
menu items only travel if the brand voice carries them past the bar crowd.

Mythic does brand work for Subway and Meineke, so the multi-state chain
story is familiar. Scott Luther offers a free Growth Codes audit if useful.

Is the new menu pulling traffic across all 100 locations, or mostly in Orlando?
```

Changes from v1: "LTO" → "new menu item". Cone Health → Meineke (category match). 30-word sentence split into two. "100+" → "100".

### Stage 8 — Aggregation
`_aggregate-showcase.ts` joined emails JSON + Serper facts + ICP scoring + relevance_summary → master CSV row.

| Column | Value |
|---|---|
| client | mythic |
| vertical | qsr |
| lead | Katie / Miller's Ale House |
| domain | millersalehouse.com |
| title | CMO |
| dossier_summary | Skillet Queso Dunks LTO… |
| signal_fact | Food News Today \| SupermarketGuru: … 2026 … |
| signal_source | supermarketguru.com URL |
| icp_confidence | 0.92 |
| icp_reason | 100+ location US sports-bar… |
| relevance_summary | The dossier signal is the March 2026 Skillet Queso Dunks LTO across 100+ locations… |
| anchors_used | Subway, Meineke |
| source_urls | PRNewswire URL |
| email1_subject | Skillet Queso Dunks and the sports-bar squeeze |
| email1_body | (v2 above) |
| email2-4 subject/body | (followup sequence) |

### Stage 9 — Push to Smartlead
`/smartlead-campaign-upload-public` reads `_master.csv` + variants.yaml. Uploads as **DRAFT**. User reviews in Smartlead UI, hits Start.

### Stage 10 — Reply scoring
After 14 days: `/positive-reply-scoring` pulls replies, classifies each via Claude. Reports positive %. If above baseline → scale category. Below → swap signal or copy.

---

## Read-Aloud Rule (the v2 quality gate)

Every E1 sentence must pass spoken aloud as a peer-to-peer note. Codified in:

- **Prompt** (`_e1-rewrite-batch-prep.ts`): explicit rule + acronym table + anchor-vertical map
- **Validator** (`_validate-emails.ts`): 4 new soft rules
- **Memory** (`~/.claude/.../memory/feedback_cold_email_pipeline.md`): rules 9-12

### The four soft validator rules
| Rule | Catches |
|---|---|
| `read_aloud_max_sentence_22_words` | Sentences over 22 words |
| `read_aloud_no_deck_speak` | playbook, lane, umbrella story, brand architecture, marketing math, category entry point, etc. |
| `read_aloud_no_acronyms_in_body` | LTO, AOR, QSR, CPG, RTO, AOV, LTV, GTM, MQL, SaaS, etc. |
| `read_aloud_anchor_category_match` | Cone Health in restaurants, Harley in healthcare, etc. |

### v1 → v2 result delta
| Metric | v1 | v2 | Change |
|---|---|---|---|
| Sentences > 22 words | 285/300 | 27/300 | −90% |
| Deck-speak instances | 118/300 | 89/300 | −25% |
| Body acronyms | 44/300 | 0/300 | −100% |
| Anchor mismatches | 28/300 | 2/300 | −93% |
| Hard fails | 0 | 0 | clean |

---

## Costs at Scale (current benchmarks)

### Per 100 leads (full pipeline including research + 4-email sequence)
| Stack | LLM | Non-LLM | Total |
|---|---|---|---|
| Haiku 4.5 | $1.00 | $7 | ~$8 |
| Sonnet 4.6 | $3.00 | $7 | ~$10 |
| Opus 4.7 | $15.20 | $7 | ~$22 |

### Per 1,000 leads
| Stack | One-time | Monthly subs | First month total |
|---|---|---|---|
| Sonnet + Prospeo + Serper + MV + 10 Zapmail + Smartlead Basic | $130 | $80 | **~$210** |

### Per 5K/month
| Service | Cost |
|---|---|
| Prospeo 5K | $250 |
| API 5K (Sonnet) | $150 |
| Smartlead Pro | $94 |
| Zapmail 20 inboxes | $80 |
| **Total** | **~$575/mo** → $0.115/lead |

### Send-rate ceiling (real bottleneck)
- Per warmed Smartlead inbox: ~30-50 cold sends/day
- 1K leads × 4 emails = 4K sends spread over 14 days = ~285/day
- Need: **8-10 warmed inboxes minimum**

---

## Environment Variables

Minimum for first campaign:
```
SMARTLEAD_API_KEY=
PROSPEO_API_KEY=
DYNADOT_API_KEY=
ZAPMAIL_API_KEY=
SERPER_API_KEY=
```

For auto-research-public + advanced workflows:
```
ANTHROPIC_API_KEY=         # only needed for API-mode rewrites (vs sub-agents)
MILLIONVERIFIER_API_KEY=   # email validation
OPENROUTER_API_KEY=        # alternate LLM router
LEADMAGIC_API_KEY=         # email reveal from LinkedIn
RAPIDAPI_KEY=              # Google Maps + LinkedIn signal mining
```

See `.env.example` for full reference.

---

## Critical Files to Read Before Building

1. **`CLAUDE.md`** — Repo-level instructions Claude Code loads on session start. Don't bypass.
2. **`PIPELINE_LESSONS.md`** — 12 hard-won rules. Read before any pipeline change.
3. **`CAMPAIGN-PIPELINE-PLAYBOOK.md`** — Long-form pipeline doc (676 lines).
4. **`docs/roadmap.md`** — Full decision tree across skills.
5. **`profiles/<client>/client-profile.yaml`** — Ground truth for the client you're building for.

---

## How to Add a New Client

1. Run `/cold-email-kickoff` → answers stack into `profiles/<new-client>/client-profile.yaml`
2. Run `/icp-prompt-builder` on a 50-lead sample → tunes `icp-prompt.txt`
3. Pick a list-builder skill, pull 500-1000 leads
4. `/list-quality-scorecard` grades the list
5. `/campaign-copywriting` → variants.yaml (read-aloud rule applies automatically)
6. `/spam-word-checker` final pass
7. `/smartlead-campaign-upload-public` → DRAFT in Smartlead UI

---

## How to Add a New Vertical / Campaign Type for Existing Client

1. Update `profiles/<client>/client-profile.yaml` with new vertical's filters + anchors
2. Update the **anchor-vertical map** in `_e1-rewrite-batch-prep.ts` so the new vertical has correct anchors
3. Run a 10-lead pilot via `_email-pipeline.ts` with `--limit 10`
4. Validate with `_validate-emails.ts`
5. If clean, scale via `/auto-research-public` or manual `_pull.ts` → ... → upload

---

## Two Things to Watch When Modifying

1. **Anchor-vertical map** — if you change Mythic or BW client lists, update the map in `_e1-rewrite-batch-prep.ts` AND the soft validator rule in `_validate-emails.ts`.
2. **Banned phrases** — production runs leak ~5% even with explicit ban list. Validator catches. When you see a leak in production, add to both the prompt ban list AND the validator regex.

---

## Open Questions / Future Work

From the May 29 walkthrough:

- **Signal priority** — should person-level signals (new role, promotion) override company-level (funding, launch)? Current pipeline goes company-first. User feedback: flip to person-first when both exist.
- **Auto-responder routing** — webhooks fire on every reply. Need to filter: first-reply only routes to autoresponder; reply-to-our-autoresponder routes to human (Ken). Currently messy.
- **Offer-agnostic architecture** — pipeline assumes catalog/mail (BW) or Growth Codes audit (Mythic). To support new offers (roundtables, other audits), the offer plug-in point lives in `profiles/<client>/client-profile.yaml#offer` and the email-write prompt template. Adding a new offer type ≈ 10 lines of YAML + a paragraph in the prompt template.
- **Person-level signal API priority order** — RapidAPI LinkedIn endpoints called by tier; tier table in `_lib_tier.ts`. Currently implicit — needs explicit "tier 1 = check new role first, tier 2 = check posts" config.

---

*Last updated 2026-05-29.*
