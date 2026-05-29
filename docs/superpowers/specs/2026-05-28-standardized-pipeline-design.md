# Standardized Cold Email Pipeline — Design Spec

**Date:** 2026-05-28
**Status:** Approved by user, ready for implementation planning
**Author:** Brainstormed with Avinash
**Replaces:** `bw-*` scripts, `mythic-*` scripts, ad-hoc batch tools

---

## Goal

One config-driven pipeline that produces production-quality cold emails for any client. Adding a new client requires writing one YAML file. The output must be cold emails that a senior marketing leader would actually reply to — research-driven, peer-to-peer voice, not robotic.

## Non-Goals

- Smartlead upload (deferred — manual export from final CSV for now)
- LeadMagic email reveal (placeholder only — wire up in a future iteration)
- Multi-language support
- Automated reply handling

## Background

We have two client pipelines today (Belardi Wong, Mythic). They share utilities but each has its own `extract-signals`, `render`, `prospeo-search` scripts. Three classes of bugs have hurt us:

1. **Param ordering swaps** — `serperSearch(query, key, retries, caller)` vs `serperSearch(query, key, caller, retries)` — caused 846 wasted Serper credits
2. **Shape mismatches** — passing `SerperResult` where `raw` was expected — extracted nothing despite firing successfully
3. **Quality regression** — generic template output (Mythic Variant C) doesn't read as researched. Senior marketing leaders archive it.

The fix is standardization (one pipeline, config-driven) plus a quality bar enforced by validators.

---

## Architecture

```
profiles/{client}/client-profile.yaml          ← only client-specific file
  ├── business: name, website, positioning, tone
  ├── offer: product, CTA, value_prop, lead_magnet
  ├── icp: titles, industries, headcount, geo, excluded_domains
  ├── research: trusted_domains, query_templates, anchor_customers, priority_domains
  └── copy: vocab_in, vocab_out, banned_phrases, example_emails[]

scripts/pipeline/                              ← one pipeline, all clients
  ├── run.ts                                   ← orchestrator (--client X --category Y)
  ├── _pull.ts                                 ← Stage 1: Prospeo lead pull
  ├── _score.ts                                ← Stage 2: ICP qualifier
  ├── _research.ts                             ← Stage 3: tiered research
  ├── _write.ts                                ← Stage 4: Opus sub-agent email writer
  ├── _validate.ts                             ← Stage 5: 3-stage validator
  ├── _credit_guard.ts                         ← pre-flight cost gate
  ├── _smoke.ts                                ← 3-lead smoke runner
  ├── _cache.ts                                ← raw-response cache layer
  ├── recover.ts                               ← re-extract / re-score / re-write from cache
  └── cache-stats.ts                           ← cache audit

scripts/legacy/                                ← old bw-*, mythic-* moved here for reference
                                                 README explains what replaced what

tests/
  ├── fixtures/                                ← golden Serper/Prospeo/scrape responses
  └── *.integration.test.ts                    ← end-to-end against fixtures
```

---

## Stages (Run Order)

```
[1] LEAD PULL         → Prospeo, raw leads CSV
[2] ICP SCORE         → Opus sub-agent qualifier, scored CSV (qualified ≥ threshold)
[3] RESEARCH (tiered) → Serper + scrape + person depth, dossier per lead
       ├── T1 (all qualified):       company signals (funding, press, expansion)
       ├── T2 (qual_conf ≥ 0.8):     + website scrape, recent campaigns, tech signals (FREE)
       └── T3 (qual_conf ≥ 0.9 OR    + person research (quotes, posts, talks)
              priority_domain):
[4] EMAIL WRITE       → Opus sub-agent per lead, drafts all 4 emails using dossier + profile
[5] VALIDATE          → 3 sub-stages per email:
       ├── mechanical (regex, no LLM)
       ├── semantic (Opus sub-agent)
       └── recipient role-play (Opus sub-agent, Email 1 only)
       Regenerate up to 3 times. Fall back to Variant C template if all 3 fail.
[6] QUALITY GATE      → human approval: summary + samples printed, requires "yes"
[7] FINAL CSV         → output ready for manual export to Smartlead
```

LeadMagic email reveal and Smartlead upload are out of scope for v1.

---

## Stage 1 — Lead Pull (`_pull.ts`)

Reads `profiles/{client}/client-profile.yaml`, builds Prospeo filters, pulls pages.

**Cache:** Each Prospeo page saved to `data/research-cache/prospeo/{filter-hash}-page-{n}.json` *before* parsing. 30-day TTL.

**Filters built from YAML:**
- `person_job_title.include` ← `icp.job_titles`
- `person_location_search.include` ← `icp.countries`
- `company_headcount_custom` ← `icp.headcount_min`, `icp.headcount_max`
- `company_industry.include` ← `icp.industries_in[category]` (per-vertical override) or `icp.industries_in`
- `person_contact_details.email` ← `["VERIFIED"]` always

**Output:** `data/runs/{timestamp}-{client}-{category}/raw-leads.csv`

---

## Stage 2 — ICP Score (`_score.ts`)

Replaces `mythic-score-leads.ts` + `mythic-apply-scores.ts`. Same logic, standardized.

For each lead: dispatch Opus sub-agent with:
- ICP prompt from `profiles/{client}/icp-prompt.txt`
- Lead's metadata (name, title, company, domain, industry, headcount)

Sub-agent returns: `{ qualified, confidence, reason }`.

**Cache:** scoring results keyed by `{client}-{domain}-{prompt-hash}`. Re-runs with same prompt and same lead are free.

**Batch size:** configurable, default 10 leads per sub-agent dispatch (one dispatch scores 10 leads in a single JSON array response).

**Output:** `data/runs/{timestamp}-{client}-{category}/scored-leads.csv` (qualified + rejected, in separate files).

---

## Stage 3 — Research (`_research.ts`)

Three tiers. Each lead's dossier saved to `data/runs/{timestamp}-{client}-{category}/dossiers/{domain}.json`.

### Tier 1 — Company signals (every qualified lead)

- Serper queries from `_query_templates.ts` (overridable in `profiles/{client}/client-profile.yaml`)
- Trusted domain allowlist from `client-profile.yaml` + sane defaults
- Per-query raw response saved to `data/research-cache/serper/{domain}--{query-hash}.json` *before* extraction
- Extractor pulls funding, press, acquisition, snippet facts
- Budget: 3-8 queries per lead (T1=8, T2=5, T3=3 queries)

### Tier 2 — Company depth (ALL qualified leads, FREE)

Free per user feedback: if it's free, run on everyone.

- HTTP fetch homepage, /about, /team (3 pages max per company)
- Parse for: recent campaign banner/headline, tech-stack signals (script tag detection — Klaviyo, Attentive, etc.), social proof (testimonials, awards), tone hints (corporate vs founder-led)
- Cache to `data/research-cache/scrape/{domain}.json`, 30-day TTL
- Output: structured fields appended to dossier

### Tier 3 — Person depth (qual_conf ≥ 0.9 OR priority_domain)

- Serper search: `"{full_name}" "{company}" -inurl:linkedin` for quotes, podcast appearances, press mentions
- Re-uses existing Prospeo `person_linkedin_url` and `person_id` (already cached)
- Cache to `data/research-cache/person/{person_id}.json`, 90-day TTL
- Budget: 2-4 Serper queries per lead

### Dossier output (Stage 4 input)

```json
{
  "tier": "T1" | "T2" | "T3",
  "person": { name, title, seniority, linkedin_url },
  "company": { name, domain, industry, headcount, location },
  "signals": {
    "funding_fact": "string or null",
    "press_facts": ["array of strings"],
    "acquisition_fact": "string or null",
    "category_snippet": "string or null"
  },
  "scrape": {
    "recent_initiative": "string or null",
    "tech_signals": ["array"],
    "social_proof": ["array"],
    "tone_observations": "string"
  },
  "person_depth": {
    "person_quote": "string or null",
    "recent_post_topic": "string or null",
    "public_speaking_topics": [],
    "career_pivot_signal": "string or null"
  }
}
```

**Key rule:** dossier should be deep, email should be shallow. The dossier exists so the writer has options, not so all facts get used.

---

## Stage 4 — Email Writer (`_write.ts`)

One Opus sub-agent dispatch per lead. Writes ALL 4 emails in one JSON response.

### Prompt construction (auto-built from `client-profile.yaml`)

```
You are an experienced cold email writer ghosting for {business.name}.
You are writing to {lead.full_name}, {lead.current_job_title} at {lead.company_name}.

Voice: {business.tone}. Peer to peer. Senior strategist to senior marketing leader.
You have done deep research. You will use ONE specific detail per email and discard the rest.

CLIENT POSITIONING:
{business.one_liner}
{business.positioning}

OFFER:
Product: {offer.primary_product}
Value prop: {offer.value_prop}
Primary CTA: {offer.primary_cta}

ABSOLUTE RULES:
- Exactly ONE specific research detail in Email 1. No more.
- No em dashes. No exclamation points. No bullet points.
- Banned phrases: {copy.vocab_out joined}
- Vocabulary to lean on: {copy.vocab_in joined}
- Email 1 body: 60-90 words. Email 2-4: 40-70 words.
- Open with the recipient's first name lowercase and an observation. No "Hi", "Hello", "I hope this finds you well."
- Email 1 must NOT mention {business.name} or {offer.primary_product} in the first 3 sentences.
- The ask in Email 1 is a question, not a meeting invite.
- Each email references DIFFERENT aspects of the dossier. No repetition.
- Email 2 is a threaded follow-up (empty subject).
- Email 4 is a soft close ("if not you, who?"). Never aggressive.

EXAMPLES OF GOOD EMAILS FOR THIS CLIENT:
{copy.example_emails joined with separators}

RESEARCH DOSSIER ON THIS LEAD:
{dossier as JSON}

OUTPUT FORMAT (JSON only):
{
  "email1": { "subject": "...", "body": "...", "research_detail_used": "..." },
  "email2": { "subject": "", "body": "...", "research_detail_used": "..." },
  "email3": { "subject": "...", "body": "...", "research_detail_used": "..." },
  "email4": { "subject": "...", "body": "...", "research_detail_used": "..." }
}
```

**Parallelism:** configurable batches, default 10 leads parallel.

**Failure handling:** 3 retries per lead with exponential backoff. On final failure, mark `write_failed: true` and fall back to Variant C template. Failed leads logged to `data/runs/{timestamp}/failures.json` for manual review. Pipeline aborts only if >25% of a batch fails.

---

## Stage 5 — Validate (`_validate.ts`)

Three sub-stages per email.

### 5a — Mechanical (regex + code, no LLM)

Checks:
- Word count within bounds (60-90 for E1, 40-70 for E2-4)
- No em dashes (`—` or `--`)
- No exclamation points
- No bullet points
- No banned phrases from `copy.vocab_out`
- Opens with lowercase first name + observation (no "Hi"/"Hello")
- Email 1 doesn't mention `business.name` or `offer.primary_product` in first 3 sentences

Returns: `{ pass: bool, violations: ["array of specific violations"] }`

### 5b — Semantic (Opus sub-agent)

Prompt:
```
You are reviewing a cold email for quality. The email is below.
Research dossier the writer had: {dossier}
Research detail the writer claims to have used: {research_detail_used}

Check:
1. Does the email reference the claimed research detail in a meaningful way? (Not just dropped in as a fact.)
2. Does it sound human or AI-generated? Failure modes: starts with "I noticed" / "I came across" / "I hope this finds you" / uses "leverage" / "synergy" / "in today's competitive landscape" / "as a {title}".
3. Does it feel templated? Test: if you swapped the company name to a different company, would the email still make sense for the new company? If yes, it's templated → fail.
4. Is there EXACTLY ONE research detail in the body? Count specific facts. More than one fails.
5. Is the voice peer-to-peer for a {seniority} title? Too vendor-pitchy = fail. Too casual = fail.

EMAIL:
Subject: {subject}
Body: {body}

Return JSON: { pass: bool, score: 1-10, issues: ["array"], suggestions: ["array"] }
```

Pass threshold: `score >= 7` and no critical issues.

### 5c — Recipient role-play (Opus sub-agent, EMAIL 1 ONLY)

Prompt:
```
You are {lead.full_name}, {lead.current_job_title} at {lead.company_name}.
Your inbox gets 100-200 cold emails a week. You are skeptical of agencies and SaaS pitches.
You just received this cold email:

Subject: {subject}
Body: {body}

Be brutally honest. What's your reaction? Would you:
- "reply" — interesting enough to respond
- "archive" — not bad but not worth time
- "unsubscribe" — bad enough to opt out

Return JSON: { verdict: "reply" | "archive" | "unsubscribe", reason: "one sentence" }
```

Pass: `verdict === "reply"`.

### Regeneration loop

If any stage fails:
- Stage 5a fail → regenerate with the specific violations in the prompt
- Stage 5b fail → regenerate with issues + suggestions in the prompt
- Stage 5c fail → regenerate with role-play reason in the prompt

Max 3 regenerations per email. After 3 failures: fall back to Variant C template for that email, log to failures.

### Per-email output stored on dossier

```json
{
  "validator": {
    "email1": { "mechanical_pass": true, "semantic_score": 9, "role_play_verdict": "reply", "regenerations": 0 },
    "email2": { ... },
    ...
  }
}
```

---

## Stage 6 — Quality Gate (`_quality_gate.ts`, already exists, extended)

Prints summary + 5 random samples + 5 random failures. Blocks until operator types `yes` or `no`.

```
═══════════════════════════════════════════════════════════
  QUALITY GATE — mythic / qsr
═══════════════════════════════════════════════════════════
  Run:               2026-05-28-1430-mythic-qsr
  Leads in CSV:      103
  Tier breakdown:    T1: 18  T2: 67  T3: 18
  Validator passes:  E1=95/103 (92%)  E2-4 first pass: 87%
  Fallbacks used:    8 (Variant C template)
  Role-play "reply": 89/103 (86%)

  Random sample 1 — Bindi Menon, CMO, Captain D's (T3):
    [shows full E1 body inline]

  Random sample 2 — Christine Cocce, Director, Legal Sea Foods (T2):
    [shows full E1 body inline]

  ... 3 more samples ...

  Random failure 1 — Lead X (fell back to template, role-play returned "archive"):
    [shows the email that failed + the failure reason]

═══════════════════════════════════════════════════════════
  Approve and write final CSV? (yes / no):
```

---

## Credit Guard + Smoke Mode

### Pre-flight cost estimate (every run)

```
═══════════════════════════════════════════════════════════
  PIPELINE PRE-FLIGHT — mythic / qsr
═══════════════════════════════════════════════════════════
  Leads to process:        103
  Already in cache:        12   (will skip)
  New API calls planned:
    Prospeo:               0 pages (cached)
    Serper (T1):           91 × ~5 queries = ~455 credits
    Serper (T3):           18 × ~3 queries = ~54 credits
    LeadMagic:             (out of scope v1)
    Scrape (free):         103 pages
  Sub-agent calls (free):  ~700

  Estimated wall-clock:    ~15 minutes
  Estimated dollar cost:   $0 (sub-agents free, subscriptions)
  Credit usage:            509 Serper credits
═══════════════════════════════════════════════════════════
  Proceed? (yes / no / smoke / dry-run):
```

### Smoke mode

`smoke` picks 3 leads (1 per tier if possible), runs full pipeline on just those 3. Shows actual emails + validator results. Saves the prompts used. Then asks again before doing the rest.

**Smoke lock:** prompts/rules used in smoke get written to `data/runs/{timestamp}/locked-prompts.md`. Full run reads from that file. No drift possible between smoke and full run.

### Hard caps

In `config/limits.yaml`:
```yaml
hard_caps:
  serper_per_run: 1000
  prospeo_per_run: 50
  leadmagic_per_run: 500
abort_if_exceeded: true
batch_size_default: 10
```

---

## Cache + Recovery

### Cache layout

```
data/research-cache/
  ├── serper/    {domain}--{query-hash}.json    90-day TTL
  ├── prospeo/   {filter-hash}-page-{n}.json    30-day TTL
  ├── scrape/    {domain}.json                  30-day TTL
  ├── person/    {person_id}.json               90-day TTL
  └── leadmagic/ {first}-{last}-{domain}.json   365-day TTL
```

### Cache write rule

Raw API response is saved to disk *before* any parsing. If parser throws, cache is intact.

```typescript
async function fetchWithCache(key, ttl, fetcher) {
  const cached = readCache(key, ttl);
  if (cached && !cached.stale) return { ...cached, fromCache: true };

  const raw = await fetcher();           // hits API
  writeCache(key, raw);                  // save BEFORE parsing
  return { raw, fromCache: false };
}
```

### Recovery commands

```bash
# Re-extract signals from cached Serper responses (zero new calls)
npx tsx scripts/pipeline/recover.ts --client mythic --category qsr --stage extract

# Re-score from cached Prospeo + cached extracted facts (zero new calls)
npx tsx scripts/pipeline/recover.ts --client mythic --category qsr --stage score

# Re-write emails from cached research dossiers (uses sub-agents, free)
npx tsx scripts/pipeline/recover.ts --client mythic --category qsr --stage write

# Full re-run from cache (no Prospeo, uses existing cache)
npx tsx scripts/pipeline/run.ts --client mythic --category qsr --offline
```

### Cache stats

```bash
npx tsx scripts/pipeline/cache-stats.ts --client mythic --category qsr
```

### Cache wipe (requires confirm-domain)

```bash
npx tsx scripts/pipeline/recover.ts --clear-cache --confirm-domain=mythic.us
```

Requires typing exact domain. Prevents accidents.

---

## Sub-agent Orchestration

### Parallelism

- Default: 10 sub-agents in parallel per batch
- Configurable in `config/limits.yaml` → `batch_size_default`
- Per-stage override possible (Stage 4 writer might need fewer parallel due to context size)

### Per-sub-agent error handling

- Max 3 retries with exponential backoff (1s, 3s, 9s)
- On final failure: log to `failures.json`, fall back to Variant C
- Pipeline aborts if >25% of any batch fails (signal of systemic issue)

### Run artifacts

Every full run writes to `data/runs/{timestamp}-{client}-{category}/`:

```
preflight.json         ← cost estimate at start
smoke-results.json     ← if smoke was run
locked-prompts.md      ← exact prompts used
pipeline.log           ← every API call + sub-agent dispatch + result
failures.json          ← leads that fell back
final-stats.json       ← end-of-run summary
raw-leads.csv          ← Stage 1 output
scored-leads.csv       ← Stage 2 output
dossiers/              ← Stage 3 output, one JSON per lead
output.csv             ← Stage 4+5 final output
```

---

## Final Output

CSV columns (ordered):

```
person_id, first_name, last_name, full_name, current_job_title, email, email_status,
person_linkedin_url, company_name, company_domain, company_industry,
company_headcount_range, company_city, company_state, company_country,
icp_qualified, icp_confidence, icp_reason,
research_tier, signal_used, signal_fact, research_dossier_path,
assigned_variant, validator_score, validator_role_play_verdict,
email1_subject, email1_body, email1_research_detail,
email2_subject, email2_body, email2_research_detail,
email3_subject, email3_body, email3_research_detail,
email4_subject, email4_body, email4_research_detail
```

This CSV is operator-facing. Manual import to Smartlead via CSV upload in the UI (DRAFT only, always).

---

## Migration

1. Build all new `scripts/pipeline/` modules in parallel with existing code
2. Run new pipeline against existing Mythic data (cached Prospeo from today, no new credits)
3. Compare new output side-by-side with old: validator scores, signal coverage, manual sample review
4. **Old scripts only deleted after new pipeline produces output AT LEAST AS GOOD as old on both BW and Mythic**
5. Move deleted scripts to `scripts/legacy/` with README documenting what replaced what
6. Git history preserves everything

---

## Testing

- **Unit tests:** every module in `scripts/pipeline/` has unit tests
- **Golden fixtures:** real Serper/Prospeo/scrape responses saved to `tests/fixtures/`
- **Integration tests:** end-to-end pipeline run against fixtures, asserts on output structure + validator scores
- **Smoke run before every full run** (mandatory in prod, can skip in dev with `--no-smoke`)

---

## New Client Onboarding

1. Operator runs `/icp-onboarding` skill (interview → scrape website → writes `client-profile.yaml`)
2. Operator runs `/icp-prompt-builder` skill (tunes ICP qualifier prompt)
3. Operator adds 3-5 example emails to `profiles/{client}/example-emails.md` (these go into Stage 4 writer prompt)
4. Operator runs `npx tsx scripts/pipeline/run.ts --client {new_client} --category {vertical} --smoke`
5. Smoke confirms quality → full run
6. Total time: ~1 hour including writing example emails (the part that takes time)

---

## Future Expansion (out of scope v1)

- **Smartlead auto-upload** — currently manual export from final CSV. Build `pipeline/upload-smartlead.ts` later.
- **LeadMagic email reveal** — currently a placeholder column. Wire up the `_leadmagic_client.ts` call in a later iteration.
- **LeadMagic for other enrichment** — phone numbers, additional contacts, etc. Future.
- **Reply handling integration** — read replies from Smartlead, route to appropriate team member. Future.
- **Multi-language support** — current pipeline is English-only.

---

## Open Questions (intentionally left open)

- **Should Stage 5b semantic scoring threshold be 7 or 8?** Start with 7, tune up if false-positives. Need real data.
- **How many example emails per client?** Spec says 3-5. May need more for clients in unusual verticals. Tune in onboarding.
- **What's the right T2 → T3 cutoff?** Spec says `qual_confidence >= 0.9`. May want to make this client-tunable in profile YAML.
- **Cache TTLs** — 90 days for Serper, 30 for scrape, 365 for LeadMagic. These are guesses. Adjust based on observed staleness.
