# Deep Personalization Layer — Design Spec

*Sub-project B of the BW pipeline standardization effort. Adds signal-grounded per-lead personalization to Email 1 + Email 2. Status: design (no implementation yet).*

*Date: 2026-05-26 · Author: avinash@digitalmojo.co.in + Claude · Sub-project: B/5*

---

## 1. Purpose

The current v4 pipeline produces Email 1 + 2/3/4 using anchor-flex (Variant B) or generic (Variant C) templates. Output is decent but the per-lead AI variables sometimes drift into universal-truth dressed-as-observation territory (see past feedback: "buying directly from private sellers usually leaves more room for margin than auction buying" — universal truth, not personal observation).

This sub-project adds a deep-personalization layer that:

- Fetches real, time-bounded facts about each qualified lead (funding, hires, promotions, press, product launches, company snippet) from Serper + RapidAPI PND
- Routes the freshest fact into Email 1 + Email 2 via a constrained bridge-sentence rule
- Maintains the v4 fallback for leads without recent signals
- Mechanically enforces the quality bar via validator checks — not subagent self-discipline

Final output remains: a good cold email. Short. No buzzwords. Pitches the service. Shows research. One subtle, fact-grounded personalization touch per lead.

---

## 2. Constraints (locked during brainstorming)

| Constraint | Decision |
|---|---|
| Signal freshness | ≤90 days from `fetched_at` |
| Signal types | Funding rounds, new hires, promotions, product launches, press mentions, company snippet (last as weak fallback only) |
| Lead eligibility | Post-qualification only — never burn Serper credits on rejected leads |
| Email placement | Email 1 + Email 2 signal-aware. Email 3 + Email 4 stay static templates from v4. |
| Signal loudness | Subtle. 1 sentence in body. Signal-typed: hire/promo can lead the sentence ("Saw you stepped into the role at X" — but NOT cliché "welcome"), funding/press subtle mid-body. Never in subject line. |
| Bridge sentence rule | Category-level pattern for the signal type ONLY. Zero editorial about the company. Banned words: smart, best, savvy, fresh-eyes, great, exceptional, top, leading, smart ones, the smart, the best. |
| Capitalization | Every sentence must start with a capital letter |
| Fallback (no signal) | Variant B leads → keep v4 anchor framework (anchor already personalizes). Variant C leads → use weak Serper company-snippet (always findable, not time-decayed). |
| Tier cost optimization | Confidence-weighted, see §5 |
| Cache TTL | 90 days for successful fetches. 7 days for failed/empty fetches. Refetch after TTL. |
| Cache key | Domain (`<domain>.json`) for company-level signals. Person-level signals (promotions, new role) keyed by `<domain>--<person-id>` sub-file. |
| Cache scope | Cross-client + cross-campaign. Same domain in BW Apparel + a future client's home campaign reads same cache. |
| Sidecar must persist | Raw Serper response (per query) AND extracted facts. Re-extraction without re-spending. |
| Below qual_confidence 0.70 | Never enters enrichment queue — filtered at qualifier stage. |

---

## 3. Architecture

Three components, each with one job, communicating through file boundaries:

```
┌─────────────────────────────────────────────────────────────────────┐
│ EXISTING UPSTREAM (unchanged)                                       │
│ scripts/prospeo-trial-search.ts  →  leads-raw.csv                   │
│ subagent qualifier                →  leads-all-with-qual.csv        │
└────────────────────────────────────┬────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ NEW COMPONENT 1 — Signal Extractor                                  │
│ scripts/extract-signals.ts                                          │
│                                                                     │
│ Input:  leads-all-with-qual.csv  (qualified rows only)              │
│ Steps:  For each qualified lead:                                    │
│           a. Compute tier from (qual_confidence, title)             │
│           b. Read cache: data/signals/<domain>.json                 │
│              - If fresh (<90d) → reuse                              │
│              - If stale or missing → fetch                          │
│           c. Fire N Serper + PND queries per tier rules             │
│           d. Persist raw responses + extracted facts → sidecar JSON │
│ Output: data/signals/<domain>.json     (company-level)              │
│         data/signals/<domain>--<pid>.json (person-level, T1/T2 only)│
│         leads-with-signals.csv         (adds enrichment_tier,       │
│                                         signal_used, signal_         │
│                                         freshness_days, signal_type)│
└────────────────────────────────────┬────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ NEW COMPONENT 2 — Signal-Aware Renderer                             │
│ scripts/render-with-signals.ts                                      │
│                                                                     │
│ Input:  leads-with-signals.csv + variants-v3.yaml + signals/*.json  │
│ Steps:  For each qualified lead:                                    │
│           a. Read signal JSON sidecar                               │
│           b. Pick freshest in-window signal per signal_type priority│
│           c. Generate fact + bridge sentence via constrained prompt │
│              (see §6 — Bridge Sentence Rule)                        │
│           d. Render Email 1 with signal + standard B/C scaffolding  │
│           e. Render Email 2 carrying same signal context            │
│           f. Email 3 + Email 4 unchanged from v4                    │
│           g. Fallback: if no in-window signal → Variant B uses      │
│              anchor only, Variant C uses company_snippet only       │
│ Output: leads-final-v5.csv (adds: signal_fact, signal_bridge,       │
│         signal_used, enrichment_tier)                               │
│         messages-final-v5.md                                        │
└────────────────────────────────────┬────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ NEW COMPONENT 3 — Validator updates                                 │
│ scripts/validate-final.ts (extend existing 10 checks)               │
│                                                                     │
│ Existing checks 1-10 carry over.                                    │
│ NEW Check 11 — Bridge sentence quality reject                       │
│   Two sub-checks (both must pass):                                  │
│   (a) Banned-word check: signal_bridge + signal_fact tokenized,     │
│       hyphen-split, lowercased, exact-token-matched against full    │
│       banned list in §6 "Expanded banned word list".                │
│   (b) Banned sentence-start check: first token of every sentence in │
│       signal_bridge + signal_fact rejected against §6 "Banned       │
│       sentence-starts" list (Saw / Noticed / Caught / I see / etc). │
│   See §6 for authoritative list — single source of truth.           │
│ NEW Check 12 — Sentence start capitalization                        │
│   For each rendered email body: every sentence (after . ! ?) must  │
│   start with [A-Z]. Reject if any sentence-start fails.             │
│ NEW Check 13 — Signal freshness                                     │
│   For rows with signal_used != "fallback": signal_freshness_days    │
│   must be ≤ 90. Reject if greater.                                  │
│ NEW Check 14 — Universal-truth heuristic (soft warn, not reject)    │
│   Warn (not fail) if signal_bridge contains universal-pattern       │
│   phrases without specific reference: "brands at that stage",       │
│   "for premium DTC", "in this space". Allowed if signal_fact        │
│   precedes it with concrete data. Fail only if zero fact + only     │
│   pattern. Threshold tuned during implementation testing.           │
└─────────────────────────────────────────────────────────────────────┘
```

**Boundary discipline**: each component owns one job. Signal extractor never writes copy. Renderer never fetches data. Validator never modifies content. File contracts (CSV columns + sidecar JSON shape) are the interfaces. Each script tested independently.

---

## 4. Sidecar JSON schema

`data/signals/<domain>.json` (company-level, shared across leads at the same company):

```json
{
  "schema_version": "1.0",
  "domain": "havertys.com",
  "fetched_at": "2026-05-26T14:23:00Z",
  "cache_status": "fresh",
  "ttl_days": 90,
  "company_snippet": {
    "fact": "Havertys operates 120+ stores across 16 states with ecommerce on havertys.com.",
    "source_query": "havertys.com furniture stores ecommerce",
    "raw_serper_response": { "/* full Serper response object */": "..." }
  },
  "funding": {
    "fact": null,
    "source_query": "Havertys Furniture funding round 2025 2026",
    "raw_serper_response": { "..." : "..." },
    "found": false,
    "checked_at": "2026-05-26T14:23:02Z"
  },
  "press": [
    {
      "fact": "Havertys opened its first Austin TX location in March 2026.",
      "fact_date": "2026-03-15",
      "freshness_days": 72,
      "source_query": "Havertys Furniture press release 2026",
      "raw_serper_response": { "...": "..." }
    }
  ],
  "product_launch": {
    "fact": null,
    "source_query": "Havertys Furniture new collection launch 2026",
    "found": false
  },
  "available_signals": [
    {
      "type": "press",
      "fact": "Havertys opened its first Austin TX location in March 2026.",
      "fact_date": "2026-03-15",
      "freshness_days": 72,
      "in_window": true,
      "rank": 1
    },
    {
      "type": "company_snippet",
      "fact": "Havertys operates 120+ stores across 16 states with ecommerce on havertys.com.",
      "freshness_days": null,
      "in_window": true,
      "rank": 2
    }
  ],
  "fetch_log": [
    { "query": "...", "timestamp": "...", "status": "200", "result_count": 10 }
  ]
}
```

`data/signals/<domain>--<person-id>.json` (person-level, T1/T2 only):

```json
{
  "schema_version": "1.0",
  "domain": "havertys.com",
  "person_id": "pid_abc123",
  "linkedin_url": "[OPEN — populated when PND endpoint shape known]",
  "fetched_at": "2026-05-26T14:23:30Z",
  "cache_status": "fresh",
  "ttl_days": 90,
  "promotion": {
    "fact": null,
    "found": false,
    "source": "PND",
    "raw_pnd_response": { "...": "..." }
  },
  "new_role": {
    "fact": "Joined Havertys as SVP Marketing in February 2026.",
    "fact_date": "2026-02-01",
    "freshness_days": 115,
    "in_window": false,
    "source": "PND",
    "raw_pnd_response": { "...": "..." }
  }
}
```

Notes:
- `raw_serper_response` and `raw_pnd_response` preserved verbatim — enables re-extraction if bridge prompt changes without re-spending
- `freshness_days` computed at fetch time + on cache read (so re-reads recompute against current date)
- `in_window` boolean: true iff freshness_days ≤ 90
- Schema versioned so future changes are explicit
- `available_signals` (Amendment 2 — Twain-derived): full ranked list of every extracted signal that's in-window, ordered by priority (new_role > promotion > funding > product_launch > press > company_snippet). Renderer reads this to pick ONE signal; alternates available for sequence-level rotation across leads at same company (Amendment 3). Without this, multi-lead campaigns at the same domain risk forwarding-collision.

---

## 5. Tier rules (exact thresholds — from user)

```
Tier 1 — 8 Serper queries + 1 PND person lookup (full signal hunt)
  qual_confidence ≥ 0.80 AND title is VP+/CMO/CRO/CEO/Founder
  OR
  qual_confidence ≥ 0.90 AND title is Director+

Tier 2 — 5 Serper queries + 1 PND person lookup (focused hunt)
  qual_confidence ≥ 0.70 AND title is Director+/Head of/Senior Manager
  OR
  qual_confidence ≥ 0.80 AND title is Manager

Tier 3 — 3 Serper queries, no PND (minimum viable)
  Everyone else who qualified (qual_confidence ≥ 0.70 was the qualifier floor)

Below qual_confidence 0.70 → filtered out at qualifier stage,
not in enrichment queue.
```

### Query allocation per tier

| Tier | Funding (Serper) | Press (Serper) | Launch (Serper) | Snippet (Serper) | PND person | Total Serper | Total external calls |
|---|---|---|---|---|---|---|---|
| T1 | 2 (broad + dated) | 2 (recent + announce) | 2 (launch + collection) | 1 | 1 LinkedIn lookup | **7** | 8 |
| T2 | 1 | 1 | 1 | 1 | 1 | **4** | 5 |
| T3 | 1 | 1 | 0 | 1 | 0 | **3** | 3 |

*PND counted as separate external slot in `Total external calls` since its quota + cost differ from Serper. PND call is per-person not per-domain so it's bounded by lead count, not domain count. Cache strategy in §8 handles dedup on re-fetch.*

### Serper query templates per signal type (resolves OPEN-2)

Query strings determine signal quality. Locking templates at design phase, not implementation phase. Each template uses `{company}` (full legal/brand name from Prospeo) and `{domain}` (e.g., `havertys.com`).

**Funding queries** (T1 fires 2, T2 + T3 fire 1)

| ID | Template | Typically returns | Use when |
|---|---|---|---|
| F1 | `"{company}" raised funding 2025 2026` | Crunchbase / TechCrunch / press release headlines for recent rounds | Primary funding query — broad |
| F2 | `"{company}" series A B C funding 2025 2026` | Specific round announcements with $X amount | T1 second funding query — drills for amount + stage |
| F3 | `"{company}" announces investment` | Less common but catches private-equity / strategic-investor deals | Fallback if F1/F2 empty |
| F4 | `site:crunchbase.com "{company}"` | Crunchbase profile page | T1 supplementary — confirms F1/F2 finding |
| F5 | `"{company}" funding round announcement` | News articles with explicit "announcement" framing | Alternative to F1 |
| F6 | `"{company}" raises million` | Common headline pattern for funding news | Alternative |

Default: T1 fires F1 + F2. T2 fires F1. T3 fires F1.

**Press queries** (T1 fires 2, T2 + T3 fire 1)

| ID | Template | Typically returns | Use when |
|---|---|---|---|
| P1 | `"{company}" press release 2026` | Recent press release headlines + dates | Primary press query |
| P2 | `"{company}" announces 2026` | "X announces Y" pattern matches | T1 second press query |
| P3 | `"{company}" news 2026` | General news mentions | Fallback |
| P4 | `"{company}" expansion store opening 2026` | Retail expansion specific | Use when target is retail/multi-channel |
| P5 | `"{company}" featured in vogue elle harper` | Tier-1 fashion press for apparel/beauty | Vertical-specific |
| P6 | `"{company}" partnership collaboration 2026` | Brand partnerships / collabs | Useful for beauty + apparel |

Default: T1 fires P1 + P2. T2 + T3 fire P1.

**Launch queries** (T1 fires 2, T2 fires 1, T3 fires 0)

| ID | Template | Typically returns | Use when |
|---|---|---|---|
| L1 | `"{company}" launches new collection 2026` | Product line launches with dates | Primary launch query |
| L2 | `"{company}" new product launch 2025 2026` | Broader product launches | T1 second launch query |
| L3 | `"{company}" debuts collection` | Alternative phrasing for fashion launches | Fashion-specific |
| L4 | `"{company}" introduces new line` | More formal launch phrasing | Premium brand pattern |
| L5 | `"{company}" expands product line` | Line extensions | Mature brand pattern |

Default: T1 fires L1 + L2. T2 fires L1. T3 skips.

**Company snippet (fallback signal)** (all tiers fire 1)

| ID | Template | Typically returns | Use when |
|---|---|---|---|
| S1 | `"{company}" {domain} ecommerce stores retail` | Homepage + about-page metadata, store counts, channel mix | Always fires — the safety-net signal |
| S2 | `site:{domain}` | Direct site results (snippet from homepage) | If S1 returns weak result, retry with S2 |
| S3 | `"{company}" headquartered founded year` | Company background context | Supplementary if S1/S2 insufficient |

Default: all tiers fire S1. If S1 returns empty/weak, fall back to S2 on same run (no extra Serper credit if S1 already returned the snippet via Knowledge Graph).

**PND person query** (T1 + T2 only — see [OPEN-1] for endpoint shape)

```
PND.lookupPerson(linkedinUrl OR domain+name)
  Returns: {
    current_role: { title, company, start_date },
    previous_roles: [...],
    promotions: [...],
    profile_url: ...
  }
```

Use cases:
- T1: Extract "started role in <month>" if start_date within 90 days → new_role signal
- T1: Extract promotion from previous_roles if any role-change at same company within 90 days → promotion signal
- T2: Same extraction, but only if Serper company-level signals found nothing strong

### Signal selection priority (when multiple signals available)

When extractor finds multiple in-window signals for a lead, renderer picks ONE for use. Priority order:

```
1. new_role (joined company ≤90 days ago)        — strongest "fresh entry" angle
2. promotion (role-change at same company ≤90d)  — second-strongest
3. funding (closed ≤90 days ago)                 — strong company-level signal
4. product_launch (within 90 days)               — moderate
5. press (any in-window press mention)           — weak but specific
6. company_snippet (no time decay)               — fallback only
```

Why this order: fresher and more personal signals beat older, broader ones. New-role beats funding because it's about the recipient personally, not the company in general.

### Budget sanity check

Per-campaign config:

```yaml
# In profiles/<client>/campaigns/<campaign>/config.yaml
serper_budget_usd: 10.00   # per-campaign cap, default $10
pnd_budget_usd: 5.00       # separate budget
tier_overrides:            # optional per-client tuning
  t1_query_count: 8
  t2_query_count: 5
  t3_query_count: 3
```

Extractor estimates total spend before firing first query. If estimated > budget → drop T3 to 2 queries (snippet + 1 fallback signal). If still over → drop T2 to 3 queries. Never reduces T1.

Audit columns in `leads-final-v5.csv`:
- `enrichment_tier` (T1/T2/T3)
- `signal_used` (funding | new_role | promotion | press | product_launch | company_snippet | fallback)
- `signal_freshness_days` (integer, 0 if fallback)
- `signal_fact` (the actual text used)
- `signal_bridge` (the bridge sentence used)

---

## 6. Bridge sentence rule + examples

This is the hard guardrail. **Validator Check 11 enforces it.**

### The rule

A bridge sentence may:
- State a category-level pattern true for the signal TYPE
- Connect the signal fact to the service angle in one sentence
- Use **third-person fact framing** (state the fact about the company/person — never imply an observer)

A bridge sentence may NOT:
- Editorialize about the company ("smart", "savvy", "best", "leading", "great", "exceptional", "top")
- Editorialize about the person ("fresh eyes", "the right person", "perfect timing")
- Make universal-truth claims dressed as observations
- Exceed 25 words
- Contain hedging ("might", "perhaps", "could be")
- Use second-person flattery ("you'll", "you're well-positioned")

### Banned sentence-starts (NEW — Check 11 also rejects these)

The implicit-observer pattern is exactly what the hardened v4 prompts banned. Re-banning it here so it can't leak back in:

```
Banned sentence-start tokens (case-insensitive, first word of any sentence in signal_fact or signal_bridge):
- "Saw"
- "Saw that"        — Amendment 4 (Twain pattern: "Saw that L.A. Burdick is adding...")
- "Noticed"
- "Caught"
- "I see"           — Amendment 4 (Twain: "I see you just dropped a Spring Sale")
- "I noticed"
- "I saw"
- "I caught"
- "I don't see"     — Amendment 4 (Twain: "I don't see a print program on your end")
- "I'm guessing"    — Amendment 4 (hedge spam — Twain pattern)
- "I imagine"       — Amendment 4
- "I am guessing"   — Amendment 4
- "I am imagining"  — Amendment 4
- "I could imagine" — Amendment 4

Use third-person fact framing instead:
- BAD:  "Saw your Series B in March."
- GOOD: "Your Series B closed in March."

- BAD:  "Noticed the CMO transition."
- GOOD: "The CMO transition at X happened in January."

- BAD:  "I see your new Austin store."
- GOOD: "X's first Austin store opened in March."

Drop the implicit observer. State the fact in third person.
```

### Expanded banned word list (resolves OPEN-5 — morphological variants + Amendment 4)

Whole-word match (case-insensitive) on the rendered bridge sentence + signal_fact. Banned tokens:

```
smart, smarter, smartest, smartly
best, best-in-class, best-of-breed
savvy, savviness
leading, leading-edge, top-tier, top-rated
great, exceptional, brilliant, brilliantly
fresh eyes, fresh perspective, fresh take
the right person, the right time, perfect timing
amazing, awesome, fantastic, impressive

# Amendment 4 additions (proven from Twain output):
caught my eye
tends to, tend to
usually see, usually drives
often see
brands at this stage, brands at that stage
brands in this category, brands in that category
```

Implementation: validator normalizes punctuation → splits on whitespace + hyphens → lowercases → does exact-token match against banned list. Multi-word phrases checked as substring match. Compound terms like "best-in-class" matched as a single token after hyphen-split.

### NEW Check 11b — first-person observation pattern (Amendment 4)

Reject sentence if it matches:
```
/\b(I see|I noticed|I caught|I'm guessing|I imagine|I am guessing|I am imagining|I could imagine)\b/i
```

These are the hedge-spam patterns Twain uses constantly. Tightened beyond banned-starts because they can appear mid-sentence too.

### NEW Check 11c — vague-fact rejection (Amendment 4)

Reject `signal_fact` if it contains a `{season} {generic_noun}` pattern without a specific product name or date:

**Reject:**
- "Spring sale collection"
- "summer launch"
- "fall promotion"
- "holiday drop"

**Accept:**
- "Spring Icon Tote launched March 2026"
- "Aloe Care Health acquired April 2026"
- "Series B closed in March 2026"

Implementation: regex `/^(spring|summer|fall|winter|holiday|q[1-4])\s+(sale|launch|promotion|drop|collection)$/i` on signal_fact OR sentence following same pattern. If match AND no proper noun follows in same fact → reject.

### Passing examples (all third-person, no implicit observer)

| Signal type | Fact (from sidecar) | Bridge sentence (passes) |
|---|---|---|
| Funding | "X raised $18M Series B in March 2026." | "Your Series B closed in March. Brands at that funding stage typically start asking the channel-mix question." |
| New role | "Y joined X as VP Marketing in February 2026." | "Your role at X started earlier this year. Marketing leaders coming into the role usually inherit the channel-mix decision in the first quarter." |
| Promotion | "Y promoted to CMO at X in January 2026." | "The CMO transition at X happened in January. The first quarter usually surfaces the channel-mix question that was deferred under the prior structure." |
| Product launch | "X launched a Swim line in March 2026." | "X's Swim line launched in March. New category launches tend to put pressure on the acquisition program at the same time." |
| Press | "X opened first Austin store in March 2026." | "X's first Austin store opened in March. Retail expansion at that pace pulls hard on the DTC channel to keep up." |
| Company snippet (fallback) | "X has 120+ stores and ecommerce on x.com." | "With 120+ stores plus DTC ecommerce, the channel-mix question shows up earlier than it does for pure ecom brands." |

### Failing examples (all rejected by Check 11)

| Failing sentence | Why it fails |
|---|---|
| "Smart brands at your stage diversify channels early." | Contains "smart" — editorial |
| "Saw your Series B. The best DTC brands use this moment to test direct mail." | "Saw" — banned sentence-start AND "best" — editorial |
| "You'll bring fresh eyes to the channel mix question." | "fresh eyes" — editorial about person |
| "For premium DTC, channel diversification matters." | Universal truth, no fact preceding |
| "Adrianna Papell is doing great work in occasionwear." | "great" — editorial about company |
| "Top brands at this stage..." | Includes "leading-edge"/"top-tier"-family banned word |
| "You're well-positioned to test direct mail." | Second-person flattery |
| "Noticed your Series B — smart move." | "Noticed" — banned start AND "smart" — editorial |
| "I see you stepped into the role." | "I see" — banned start (implicit observer) |
| "Brands like yours move smartly on direct mail." | "smartly" — morphological variant banned word |
| "Your team has a leading-edge approach to acquisition." | "leading-edge" — banned compound |

The validator normalizes punctuation + lowercases + splits on whitespace + hyphens → does exact-token match against banned list. Whole-token only — so "smartphone" embedded in a fact wouldn't trigger (though unlikely in a bridge sentence anyway). Compound banned terms like "best-in-class" matched after hyphen split.

---

## 6.5 Email 2 signal back-reference rule (resolves OPEN-6)

Email 2 carries the same signal context as Email 1 — but in compressed, indirect form. The renderer adds ONE back-reference sentence into the existing Email 2 v4 body.

**Rule:**
- ≤15 words
- References the signal TYPE category abstractly, NEVER restates the fact verbatim
- Same banned-word + banned-sentence-start rules as Check 11
- Cannot contradict E1 (if E1 said "first quarter in role", E2 cannot say "your second year")
- Inserted between the existing E2 stat sentence and the E2 close sentence
- Validator Check 11 + Check 12 enforced on this sentence too
- If signal_used = `fallback` (no signal in E1) → no back-reference added, E2 stays exactly v4

**Passing examples (3):**

| E1 signal type | E1 bridge (recap) | E2 back-reference |
|---|---|---|
| New role | "Your role at X started earlier this year. Marketing leaders coming into the role usually inherit the channel-mix decision in the first quarter." | "First quarter in role is when this kind of benchmark data gets attention." |
| Funding | "Your Series B closed in March. Brands at that funding stage typically start asking the channel-mix question." | "Brands at the funding stage you're at tend to move on benchmark decks fast." |
| Product launch | "X's Swim line launched in March. New category launches tend to put pressure on the acquisition program at the same time." | "Launches like this usually pull on acquisition data within the same quarter." |

**Failing examples (3):**

| E2 back-reference | Why it fails |
|---|---|
| "Smart brands at this funding stage benchmark themselves fast." | "smart" — banned editorial word |
| "Saw your Series B again — here's why benchmarks matter now." | "Saw" — banned sentence-start AND restates the fact |
| "Since your Austin store opened, you've probably noticed the channel question." | "Since your Austin store opened" restates the fact verbatim — violates "abstract reference only" rule |

**Implementation flow:**

1. Renderer reads `signal_type` + `signal_bridge` from leads-with-signals.csv
2. If `signal_type == fallback` → skip back-reference, E2 = v4 exact
3. Otherwise → look up back-reference template for that signal type
4. Pass through Check 11 + 12 + 13 validation before writing E2 body
5. If validation fails → renderer retries once with stricter prompt → if still fails → degrade to fallback E2

---

## 7. Email 1 + Email 2 template integration

### Subject line strategy (Amendment 9 — signal-tied as third family)

Three subject families. Selected per `campaign_config.subject_strategy`:

| Strategy | Email 1 subject pattern | When to use |
|---|---|---|
| `anchor` | "the {anchor_lower} playbook" (Variant B only) | Original v4 default. Use when anchor is the strongest hook. |
| `category` | "DM economics for {ai_brand_category}" (Variant C only) | Original v4 default. Use when no anchor available. |
| `signal` (NEW) | Per-signal-type — see table below | Use when signal_used is strong + recent. Twain pattern proven on funding/acquisition headers. |
| `mixed` (NEW) | Renderer rotates per lead based on signal_type | Default for v5. Maximizes signal-coverage across the campaign. |

Signal-tied subject map (only applies when subject_strategy is `signal` or `mixed`):

```typescript
const SIGNAL_TIED_SUBJECTS: Record<SignalType, (ctx: SubjectCtx) => string | null> = {
  funding:        (ctx) => `Re: ${ctx.company_name} ${ctx.funding_round_short || ''}`.trim(),
  new_role:       (ctx) => `${ctx.first_name}'s new role`,
  promotion:      (ctx) => `${ctx.company_name} promotion`,
  product_launch: (ctx) => ctx.product_name_short ? `${ctx.product_name_short} launch` : null,
  press:          (ctx) => ctx.press_event_short || null,
  acquisition:    (ctx) => ctx.acquirer_name ? `${ctx.acquirer_name} acquisition` : null,
  company_snippet: () => null,  // falls back to variant-default subject
};
```

Add new signal_type: `acquisition` — split from `press`. Reason: acquisition subject pattern differs from generic press. Signal selector priority order updated:

```
1. new_role (≤90d)
2. promotion (≤90d)
3. acquisition (≤90d)      ← NEW per Amendment 9
4. funding (≤90d)
5. product_launch (≤90d)
6. press (≤90d)
7. company_snippet (no time decay, fallback only)
```

If `SIGNAL_TIED_SUBJECTS[signal_type]` returns `null` → fall back to variant-default subject (anchor or category strategy).

Email 1 — Variant B (with signal):

```
Subject: <existing v4 subject — e.g., "the bombas playbook">

<first_name>, <signal_fact sentence>. <signal_bridge sentence>

We run direct mail for <vertical_anchor>. <vertical-anchor-proof-line from v4>.
<company_name> sits in the same lane on <ai_similarity_dimension>.

<ai_role_hook from v4>. Worth comparing notes on what worked for them?
```

Email 1 — Variant C (with signal_used = company_snippet or other fallback):

```
Subject: <existing v4 subject>

<first_name>, <signal_fact>. <signal_bridge>

<existing v4 Variant C body, with the ai_role_hook unchanged>
```

### Email 2 — threaded follow-up (Amendment 7 — replaced cold re-open)

Email 2 is a threaded reply to Email 1 (no new subject — Smartlead handles threading). Body is bumping the prior message, with a NEW stat (different from any stat in E1 via Amendment 6 stat rotation) and a signal-type back-reference (per §6.5).

Hard rule: word count 35-65 words MAX. Check 15 (new) rejects if over 65.

Template:
```
<first_name>, bumping this up. <one-sentence stat from rotation pool, MUST differ from any stat used in E1>.

<signal-type back-reference per §6.5 — abstract reference to E1 signal, NEVER restates fact verbatim>

<single short CTA — different from E1 CTA>
```

If signal_used = fallback in E1 → no back-reference in E2, drop that paragraph entirely.

### Email 2 — Variant C threaded follow-up

Same threaded structure. Uses Variant C stat from rotation pool.

Email 3 + Email 4: unchanged from v4. Channel-risk pivot + audit close.

---

## 8. Cache strategy

### Read path

```python
def read_or_fetch(domain, person_id=None):
    cache_path = f"data/signals/{domain}.json"
    if person_id:
        cache_path = f"data/signals/{domain}--{person_id}.json"

    if exists(cache_path):
        data = json.load(cache_path)
        age_days = (now - parse(data["fetched_at"])).days
        ttl = 7 if cache_is_empty(data) else 90

        if age_days <= ttl:
            data["cache_status"] = "fresh"
            return data
        else:
            data["cache_status"] = "stale"
            # Fall through to refetch

    # Cache miss or stale → fetch
    data = fetch_from_serper_and_pnd(domain, person_id)
    data["cache_status"] = "fetched"
    save(cache_path, data)
    return data
```

### Cache invalidation

- No manual invalidation needed — TTL handles it
- If schema version bumps → invalidate matching sidecars on next read (compare `schema_version` field)
- If a campaign explicitly wants fresh data: pass `--force-refresh` flag to extractor, ignores TTL

### Cross-client benefit

Same domain in a future client's campaign reads the same cache (subject to TTL). Big win if BW + a future client both touch e.g., Faherty.com — second client's run pays $0 in Serper for that domain.

### Disk footprint

Estimate: 50KB per company sidecar (with raw responses). 10KB per person sidecar. 5000 unique companies × 50KB = 250MB. Reasonable. `data/signals/` is gitignored.

---

## 9. Error handling

| Error | Detection | Behavior |
|---|---|---|
| Serper 429 rate limit | HTTP 429 | Exponential backoff, retry up to 3 times. If still failing, log + cache empty result with 7-day TTL. |
| Serper 500/502 | HTTP 5xx | Retry once. If still failing, log + skip (no cache write — allows retry on next run). |
| Serper returns empty results | result_count == 0 | Cache empty result with 7-day TTL. `found: false` in sidecar. |
| PND endpoint down | HTTP 5xx | Same as Serper 5xx — log + skip, person-level sidecar not written. |
| PND returns nothing | empty response | Cache empty result with 7-day TTL. `found: false`. |
| Invalid domain (DNS fails) | upstream resolver fails | Log lead row + mark `signal_used: fallback`. Renderer treats as no-signal. |
| Bridge prompt produces banned word | Check 11 detects post-render | Renderer retries once with stricter prompt. If second attempt also fails → fall back to no-signal render. Log the violation. |
| All queries exhaust budget mid-run | Tier-downgrade rules in §5 | Drop T3 → T2 → T1 as needed. Never zero queries. |
| Cache file corrupt (invalid JSON) | parse fails | Log, delete corrupt file, refetch. |

---

## 10. Testing strategy

Each component testable in isolation.

### Signal extractor tests
- `test_tier_assignment.ts` — given a row with (conf, title), correct tier is computed. Includes boundary cases (0.79 conf → T2 not T1).
- `test_cache_hit_fresh.ts` — read returns existing sidecar without firing API.
- `test_cache_miss.ts` — write happens, sidecar shape valid.
- `test_cache_stale_refetch.ts` — old sidecar (>90d) triggers refetch.
- `test_failed_fetch_short_ttl.ts` — empty result cached with 7-day TTL.
- Use a mock Serper client (`scripts/_test_serper_mock.ts`) so unit tests don't burn live credits.

### Renderer tests
- `test_signal_pick_priority.ts` — given a sidecar with funding + press + snippet, funding wins (priority order).
- `test_fallback_no_signal.ts` — empty sidecar → Variant B uses anchor only, Variant C uses snippet.
- `test_bridge_rejection.ts` — feed renderer a mocked AI response with "smart" — renderer's internal Check 11 rejects + retries.
- `test_capitalization.ts` — every rendered body's sentence starts pass [A-Z] check.

### Validator tests
- `test_check_11_editorial_words.ts` — bridge with "smart", "best", "savvy" etc. → rejected.
- `test_check_12_capitalization.ts` — body with lowercase sentence start → rejected.
- `test_check_13_freshness.ts` — signal_freshness_days > 90 → rejected.

### Integration tests
- `test_pipeline_e2e.ts` — runs full extractor → renderer → validator on a fixture set of 5 mock leads. Asserts:
  - All 5 produce final output
  - Tier mix matches expectation
  - No banned words in any rendered email
  - Cache files written
  - Re-run uses cache (no second fetch)

- `test_cache_cross_client.ts` — proves the cross-client economic argument from §8. Asserts:
  - Run extractor for BW Apparel that touches `faherty.com` → fires Serper queries, writes sidecar
  - Run extractor for a hypothetical Client-Y home campaign that also touches `faherty.com` → reads existing sidecar, fires ZERO Serper queries for that domain
  - Confirm sidecar `cache_status: fresh` on second read
  - Person-level sidecars (`<domain>--<person-id>.json`) NOT shared — separate person at Faherty in Client-Y still fires PND query

  This test is the proof-of-economic-value for Approach 2. If it ever breaks, the cross-client compounding benefit is lost.

### Live smoke test (manual gate)
Before any real campaign uses the new pipeline:
- Run extractor + renderer on 5 known leads from existing BW v4 data
- Compare side-by-side v4 vs v5 rendered emails
- Team approves one round before scaling to a full campaign

---

## 11. Migration path (how this slots into the existing pipeline)

| v4 step | v5 step | Change |
|---|---|---|
| Prospeo pull | (unchanged) | — |
| Qualifier subagent | (unchanged) | — |
| Enrichment subagent (clay-personalization-prompts.md) | (KEPT, scope reduced) | Subagent still runs to produce `ai_similarity_dimension`, `ai_brand_category`, `ai_role_hook`. These drive variant routing + Email 1 closing. The signal layer ADDS the signal-fact + signal-bridge sentences to Email 1 + Email 2 — it does not replace the existing AI variables. |
| `render-multivertical.ts` | `render-with-signals.ts` | New file. v4 file stays in place as backup for one cycle. New file reads BOTH the clay-personalization AI vars (existing) AND the signal sidecar JSON (new) to render Email 1 + Email 2. Email 3 + Email 4 templates unchanged. |
| `validate-final.ts` (10 checks) | `validate-final.ts` (14 checks) | Extend in-place. New checks 11-14 added. Existing 1-10 unchanged. |
| `split-by-campaign.ts` | (unchanged) | — |

**Key clarification:** the existing clay-personalization subagent is NOT retired. It still produces `ai_similarity_dimension` (drives B/C routing), `ai_brand_category` (drives Variant C copy), and `ai_role_hook` (closes Email 1). The signal layer is ADDITIVE — adds a signal-fact + signal-bridge in front of the existing Email 1 body, plus a signal-back-reference sentence in Email 2.

### v4 → v5 cutover

1. Build + test extractor in isolation against existing BW v4 leads (read-only smoke test, doesn't write production CSVs)
2. Build + test renderer against signal sidecars
3. Run side-by-side on 20 sample BW Apparel leads — compare v4 vs v5
4. Team approves v5 quality bar
5. Re-render full BW Apparel campaign with v5 (this is sub-project D)
6. Retire v4 enrichment subagent once v5 ships

---

## 12. What's intentionally NOT in this design (YAGNI)

- **Variant A revival** — even with grounded signal data, Variant A's catalog-observation framing was retired for other reasons. Out of scope.
- **Cross-lead signal sharing** — if two leads at same company share funding signal, both reference it independently. We don't try to "vary" the bridge sentence between them for anti-pattern detection. Out of scope (could be future enhancement).
- **Signal sentiment** — we don't detect if a press mention is positive or negative. Bridge sentence stays neutral.
- **Auto-language adaptation** — all bridge sentences are English. No multi-language support.
- **Async fetching** — extractor runs sequentially per lead within a single process. No queue/worker architecture. At 8 queries × 200 leads × 200ms = ~5 min per campaign. Acceptable.
- **Real-time signal monitoring** — signals are pulled at extract-time and locked. We don't re-poll mid-campaign for fresher data.
- **Multi-source signal verification** — we trust Serper's first relevant result + the PND response. No cross-source validation.

---

## 13. Open items (resolve in review or later)

### [OPEN-1] PND endpoint shape (user fetching)
We've designed against an abstract `PND.lookupPerson(linkedinUrl)` → returns `{recent_role_changes, recent_promotions}`. When user shares actual endpoint docs + sample response:
- Confirm response shape matches our schema assumptions
- Adjust extractor's PND parser
- Adjust person-level sidecar JSON schema
- Confirm quota + cost per call

If PND endpoint isn't person-lookup but something else (posts? employees?), this design changes — specifically T1/T2 query allocation + person-level sidecar.

### [OPEN-2] Serper query templates — RESOLVED in §5

Templates locked. See "Serper query templates per signal type" table in §5. 6 candidate templates per signal type (funding, press, launch, snippet) + default tier allocation + signal-selection priority order.

### [OPEN-3] Universal-truth heuristic for Check 14
The "soft warn" check for universal-truth phrasing is qualitative. Could miss cases. Could false-positive on valid bridge sentences that happen to use category-pattern language. Tune threshold during implementation/testing.

### [OPEN-4] Person-level cache cross-company collision
If person changes companies (Sarah moves from Bombas to AG), do we re-fetch their LinkedIn? Person ID is tied to original company in our schema. Resolve:
- Person sidecar key includes BOTH original-domain + person-id
- If person later appears in a campaign for a NEW company, fetch fresh against the new context
- Old sidecar marked stale on company-change detection (requires PND to return current employer)

### [OPEN-5] Validator strictness on Check 11 — RESOLVED in §6

Banned list expanded with morphological variants (smartly, savviness, best-in-class, leading-edge, top-tier, brilliantly, smarter, smartest, etc.). See "Expanded banned word list" in §6.

### [OPEN-6] Email 2 signal-back-reference template — RESOLVED in §6.5 (above §7)

---

## 14. Success criteria

This sub-project ships when:

1. Signal extractor produces valid sidecars for all qualified BW Apparel leads (179 leads)
2. Renderer produces valid Email 1 + Email 2 for all 179
3. Validator 15 checks all pass (was 14 — Check 15 added per Amendment 7 for E2 word cap)
4. Cache hit rate on second run = 100% (no API calls)
5. Manual team review of 20 random rendered emails — bridge sentences sound natural, fact-grounded, no editorial words
6. Side-by-side comparison (v4 vs v5) on 10 leads — team prefers v5
7. **Twain comparison gates (Amendment 4-9 acceptance)** — v5 output on the 5 Twain fixture leads (`data/signals/signal_campaign_20260526_1456.csv`) must pass:
   - Banned-word leaks: **ZERO** (Twain had leaks on 4 of 5 leads)
   - Stat repetition: each stat appears ≤1 time per lead's sequence (Twain failed: 4/5 used "3-8x ROAS" three or more times)
   - Hedge density: ≤1 hedge per sentence, ≤4 hedges total per email (Twain averaged 6 per email)
   - Anchor specificity: every Variant B email names a specific BW client. Generic "peer brand" references = fail.
   - Eligibility respected: any lead with `eligible=false` has zero emails generated. Sarah Zurell scenario must not be reproduced.

If any of these fail on the BW Apparel smoke set → STOP. Do not proceed to full re-render. Iterate the bridge prompt + banned lists, re-smoke.

Then ready for sub-project D (re-render the 4 existing campaigns with this layer).

---

## 15. Estimated effort (revised — more realistic)

| Component | Hours | Calendar |
|---|---|---|
| Sidecar JSON schema + cache layer | 3-5 hours | Day 1 |
| Signal extractor (Serper integration, 4 signal types × ~2 templates each + selection logic) | 6-9 hours | Day 2 |
| **Wait for PND endpoint docs from user** | (blocking — typically 1-2 days IRL) | Day 3-4 |
| Signal extractor (PND integration, once endpoint known) | 3-5 hours | Day 5 |
| Signal-aware renderer (E1 + E2 templates + selection priority + fallback paths) | 5-7 hours | Day 6 |
| Validator extensions (Checks 11-14 + banned-word tokenizer + cross-tests with real signal data) | 3-4 hours | Day 6-7 |
| Unit tests (~13 tests including cross-client cache test) | 5-7 hours | Day 7-8 |
| Integration tests (e2e + cross-client) | 2-3 hours | Day 8 |
| Live smoke test on 20 BW Apparel leads → team review round 1 | 2-3 hours | Day 8-9 |
| **Team review iteration round 2** (almost always needed — refine bridge prompts, adjust banned words found in real data) | 3-5 hours | Day 9-10 |
| **Total** | **35-50 hours** | **1.5-2 weeks calendar** |

Critical path: PND endpoint shape from user. Everything else parallelizable but linear in calendar time due to single-developer reality.

**Why this is +50-100% over the previous estimate:**
- PND integration unblocks late (1-2 days of "wait" time, not 2-3 hours of work)
- Validator extensions need real test fixtures with real signal data, not just mocked AI responses
- Live smoke test review almost always takes 2 rounds — first round finds bridge sentences that pass validators but fail human "sounds natural" check, requires prompt refinement + re-render
- Banned-word list always grows on first real-data contact (real Serper responses surface new editorial patterns to ban)

Padding the estimate is how mid-pipeline rework is avoided.

---

## 16. Dependencies on other sub-projects

| Dep | Status |
|---|---|
| Sub-project A (standardize current pipeline) | NOT blocking — v5 builds alongside v4, doesn't depend on A's standardization |
| Sub-project C (target-audience-to-campaign generator) | DOWNSTREAM — C depends on B being done |
| Sub-project D (re-render existing campaigns) | DOWNSTREAM — D uses B's output |
| Sub-project E (better campaign names) | INDEPENDENT — can happen anytime |

This sub-project (B) can ship independently. Other sub-projects each get their own design spec.

---

## 17. Twain competitor-output learnings + applied amendments

*Added 2026-05-26 after reviewing Twain output on 5 BW Apparel leads (fixture: `data/signals/signal_campaign_20260526_1456.csv`). 9 amendments applied to spec + plan.*

### What Twain does right (we adopt)

- **Signal density** — extracts 3-5 distinct insights per lead even though only one ends up in copy. Useful for sequence-level rotation.
- **Signal-tied subject lines** — "Gordon Brothers acquisition", "{first_name}'s new role" — direct fact pointers, not generic "playbook".
- **Warnings field** — explicit eligibility check per lead. Sarah Zurell in fixture flagged "no longer the CMO".
- **Insight intermediate artifact** — fact extraction separated from message rendering. Our sidecar JSON already does this.

### What Twain does wrong (we mechanically block)

1. "Saw [company] is..." pattern repeated across multiple emails — banned by Check 11b (first-person observation pattern).
2. Universal-truth dressed as observation ("Brands at this stage usually...", "DM tends to pull ahead") — banned by Check 14 + Amendment 4 banned-word additions.
3. **Ignores own Warnings field** — Sarah Zurell flagged "no longer the CMO" yet Twain wrote full 5-email sequence. Our pipeline mechanically refuses ineligible leads (Amendment 1).
4. Industry tag from data provider is wrong (Chinese Laundry tagged engineering, Bloom tagged retail/food) — Amendment 8 category resolver.
5. Stat repetition: "3-8x ROAS" in 4 of 5 emails — Amendment 6 stat rotation tracker.
6. Hedge spam — 2-3 hedges per email — Amendment 5 hedge budget (≤1 per sentence).
7. Same signal/case-study for multiple leads at same company — Amendment 3 company-level rotation.
8. Generic "peer brand" references with no named BW client — Amendment 5 forbids generic anchors.
9. Email 2 re-opens cold instead of threading — Amendment 7 replaces Email 2 template.

### The 9 amendments

| # | Amendment | Affects |
|---|---|---|
| 1 | Lead Eligibility Validator (new pre-flight task) | New script `scripts/validate-lead-eligibility.ts` + new Task 8.5 in plan. Blocks ineligible leads from enrichment queue. |
| 2 | Persist ALL extracted signals, not just selected | Sidecar schema gains `available_signals[]`. Renderer reads, picks one, others available for rotation. |
| 3 | Company-level signal rotation across leads in same campaign | `selectSignalWithRotation()` in `_signal_selector.ts`. Multiple leads at same domain get different signal types. |
| 4 | Expanded banned-word + banned-start lists (proven from Twain output) | `_lib_signals.ts` BANNED_STARTS + BANNED_WORDS_COMPOUND grow. New Check 11b (first-person observation) + 11c (vague-fact). |
| 5 | Bridge prompt: explicit anti-Twain instructions | `_bridge_writer.ts` prompt template gains negative examples + hedge budget rule + anchor specificity rule. |
| 6 | Stat rotation rule across Emails 1-4 | New `_stat_rotator.ts` + new Task 11.5. Each stat appears max once per lead's sequence. |
| 7 | Email 2: threaded follow-up, not cold re-open | Email 2 template rewritten in `render-with-signals.ts`. 65-word cap. New Check 15 in validator. |
| 8 | Industry resolver — don't trust upstream tags | New `_category_resolver.ts` + new Task 11.6. AI-resolves category from company name + description. Cross-checks vertical_anchor_map. |
| 9 | Signal-tied subject lines as third subject family | `SIGNAL_TIED_SUBJECTS` map in renderer. Campaign config gains `subject_strategy: 'anchor' \| 'category' \| 'signal' \| 'mixed'`. |

### Open design question (NOT auto-resolved)

Twain uses 5-step sequences. Our spec is 4-step. Question raised in user review: is a 5th touch worth deliverability risk on cold sends? **Default: hold at 4 touches** unless explicit user decision to change. Email 3 channel-risk + Email 4 audit close already cover the arc.

### Amendment details follow inline through the spec

- §3 architecture diagram updated for eligibility validator (Component 0) + stat rotator + category resolver
- §4 sidecar schema gains `available_signals[]` field
- §6 banned word + sentence-start lists expanded (Amendment 4)
- §6.5 / §7 Email 2 template replaced (Amendment 7)
- §7 subject line strategy gains third family (Amendment 9)
- §13 Check list grows to 15 checks (was 14)
- §14 success criteria adds Twain-comparison gates (eligibility respected, banned-word leak rate, stat repetition rate, hedge density, anchor specificity)

### Fixture for Task 18 smoke comparison

`data/signals/signal_campaign_20260526_1456.csv` — 5 Twain-rendered leads (Arlo x2, L.A. Burdick, Bloom Nutrition, Chinese Laundry's Sarah Zurell). Used as "what NOT to produce" baseline during Task 18 smoke comparison. v5 output must pass: zero banned-word leaks, ≤1 hedge per sentence, ≤1 use of same stat per sequence, every Variant B email names a specific BW client, every ineligible lead has zero emails generated.

---

## 18. Sub-project D handoff contract

Sub-project D will re-render the 4 existing BW campaigns (Apparel, Home, Denim/Athletic, Footwear) using the v5 pipeline this spec defines. To make D's spec straightforward, B locks the output schema D will consume:

### What D inherits from B (input contract)

**Files D reads:**
- `data/signals/<domain>.json` — company-level signal sidecars
- `data/signals/<domain>--<person-id>.json` — person-level signal sidecars (T1/T2 only)
- `profiles/<client>/campaigns/<campaign>/leads-with-signals.csv` — extractor output
- `profiles/<client>/campaigns/<campaign>/leads-final-v5.csv` — renderer output (master final file)
- `profiles/<client>/campaigns/<campaign>/messages-final-v5.md` — human-readable email bundle

**Schema D depends on:**

`leads-final-v5.csv` columns (in addition to all v4 columns):
- `enrichment_tier` (string: "T1" | "T2" | "T3")
- `signal_used` (string: "new_role" | "promotion" | "funding" | "product_launch" | "press" | "company_snippet" | "fallback")
- `signal_freshness_days` (integer; 0 if fallback)
- `signal_fact` (string; the third-person fact sentence used in E1)
- `signal_bridge` (string; the bridge sentence used in E1)
- `signal_e2_back_reference` (string; the E2 back-reference sentence, empty if signal_used = "fallback")

**Validator contract:**
- D's outputs must pass v5 validator (Checks 1-14)
- D may NOT rewrite the validator. If D needs additional checks (Check 15+), they live in a separate file and don't modify validate-final.ts.

**Cache contract:**
- D reads B's cache as-is. D does not write to `data/signals/` unless extending the same schema_version.
- If D needs fresher data than 90d cache, D passes `--force-refresh` flag to extractor — does not bypass cache directly.

**Subagent contract:**
- D does not rebuild the clay-personalization subagent. It uses the same prompts B inherited (those produce `ai_similarity_dimension`, `ai_brand_category`, `ai_role_hook`).

### What D OWNS (out of scope for B)

- Re-running extractor on existing v4 lead lists (the 386 qualified BW leads + future client lists)
- Side-by-side v4 vs v5 quality comparison reports per campaign
- Decision logic for which campaigns to re-render and which to leave on v4
- Rollback path if v5 quality is worse than v4 on a specific campaign
- Per-campaign launch coordination after re-render

### Versioning rule

If B's output schema changes after D ships, B's `schema_version` bumps and D adapts. If D needs B to emit a new column, that's a B-spec change, not a D-spec change. Schema bumps go through normal review.

---

*End of design. Awaiting user review.*
