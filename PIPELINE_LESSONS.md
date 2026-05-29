# Cold Email Pipeline — Lessons Learned

Mistakes from showcase-2026-05-28 run (300 leads, 1200 emails). Do not repeat.

## Mistake 1: Confabulated leads from prompts

**What happened:** When dispatching ICP-scoring sub-agents, I wrote prompt lead lists from memory ("Lisa Liebermann at Levi" etc) instead of dumping from actual CSV. Sub-agent scored fictional names. Domain whitelist matched 0 real CSV rows.

**Rule:** NEVER write lead lists from memory in prompts. Always:
```bash
awk -F',' 'NR>1 {print $4" | "$5" | "$12" | "$13}' raw.csv
```
Copy real output verbatim into sub-agent prompt.

**Validator:** `_validate-emails.ts` doesn't catch this — happens upstream. Add `_validate-leads.ts` that diffs scored domains vs raw CSV domains. Reject scores with >5% missing-domain rate.

## Mistake 2: Thin prompt → category-filler emails

**What happened:** BW home batches B/C got 1-fragment descriptors ("DTC sleep brand"). Sub-agent had no anchor, fell back to "handmade rug story converts better on paper." Batches A/D/E got rich data → real hooks.

**Rule:** Every lead prompt MUST have:
- Date (year/month explicit, e.g. "March 2026")
- Concrete noun ($ amount, % growth, store count, named exec, product name)
- Anchor comp (closest BW/Mythic client brand)
- Role hook (one line on why their seat matters)

**Pipeline:** `_email-pipeline.ts` Serper pre-fetches per lead. Fact-richness gate (`isFactRich`) requires date + concrete noun + URL. Skipped leads → `skipped-thin.json`. **Don't dispatch thin leads.**

## Mistake 3: Banned-phrase leaks

**What happened:** 4 emails leaked "leverage" ("the leverage is usually in segmentation"), 1 leaked "pipeline" ("partnerships pipeline is full"). Sub-agent treated banned list as soft guideline.

**Rule:** Banned list goes in prompt + validator catches leaks post-output. Hard-fail = re-dispatch with sterner prompt.

**Code:** `_validate-emails.ts` checks `no_banned_phrases` rule. Currently catches: leverage, synergy, ROI (with spaces), pipeline, "i noticed", "i came across", "hope this finds".

**Add to banned list when seen:** "honestly", "frankly", "to be candid", "wanted to reach out", "circling back" (overused).

## Mistake 4: Format drift on E1 opener

**What happened:** Sub-agent variants opened "hey devon," instead of "devon," (~10 leads). Validator regex was too strict. Both forms are fine.

**Rule:** Allow `^(hey |hi )?[a-z]+,` in validator. Document acceptable openers in prompt:
- `[first],` (canonical)
- `hi [first],` (acceptable)
- `hey [first],` (acceptable casual)

Reject: `Hi [First],` (uppercase), `[first]!` (exclamation), `Hello [first]` (formal).

## Mistake 5: Non-ASCII first names break regex

**What happened:** Zoë (umlaut) failed `^[a-z]+,` validator. Real name on CSV, valid email.

**Rule:** Validator regex must support unicode: `^(hey |hi )?[\p{Ll}]+,` with `u` flag. Or normalize prompt-side: strip diacritics from first name before passing to sub-agent (zoë → zoe).

## Mistake 6: E1 missing question mark

**What happened:** Sub-agent occasionally ended E1 with statement instead of question. Validator caught it but only post-hoc.

**Rule:** Prompt should say "E1 final sentence MUST end with `?`. Not optional. If you cannot phrase question, rewrite the lead's angle."

## Mistake 7: Prospeo vertical_industries collision

**What happened:** BW `athletic/footwear/denim/food_bev` shared same Prospeo industry codes. Pulls returned same apparel-leaning pool. Pages 2+3 returned mostly off-vertical leads (Shoshanna in footwear, Calvin Klein in denim).

**Rule:** Each vertical needs OWN industry filter set in `client-profile.yaml`. Specifically:
- footwear: NAICS 316210 ("Footwear Manufacturing") + Sports Equipment
- denim: Apparel Wholesale + specific denim NAICS
- food_bev: Wine & Spirits + DTC food NAICS, NOT generic Apparel

**Code fix:** Update `profiles/belardi-wong/client-profile.yaml` `vertical_industries` per-vertical map. Test with 1-page pull per vertical before scaling.

## Mistake 8: Pulling more Prospeo pages doesn't fix industry collision

**What happened:** Spent 5 credits on p3 pull for BW thin verticals. Same pool returned (apparel-heavy). Wasted credits.

**Rule:** If page 1 returns wrong-vertical leads, DO NOT pull page 2/3. Fix industry filter first. Verify with single page pull.

## Mistake 9: WebSearch inside sub-agent burns tokens

**What happened:** Initial batches had sub-agents run WebSearch + WebFetch. ~50-60k tokens per batch. Quality good but expensive.

**Rule:** Default = Serper pre-bake on main thread, sub-agent gets facts inline. ~40-45k tokens per batch, same quality.

**When to use WebSearch in sub-agent:** Never for production. Maybe for ad-hoc one-off research where Serper budget is tighter than token budget.

## Mistake 10: No validation between batches

**What happened:** Saved batches as they came in without checking format. Found hard fails only after aggregating 300 leads.

**Rule:** Validate each batch JSON immediately after sub-agent returns. If hard fail, re-dispatch THAT batch. Don't move on with broken outputs in pile.

**Workflow:**
```
1. Dispatch batch → wait for return
2. Save JSON → run validator on just that file
3. If hard fail: re-dispatch with stricter prompt
4. If pass: move to next batch
```

## Mistake 11: Serper fact false positives

**What happened:** Pipeline gate accepted facts with score ≥6 but some were noise (Fellow → "Optica Fellows class", Nearly Natural → "student discount", Live Comfortably → unrelated news about Ohio cost of living).

**Rule:** Tighter Serper scoring:
- Require company name appears in fact title (not just snippet)
- Reject if fact source domain is `studentbeans.com`, `couponcode.com`, `glassdoor.com`, `linkedin.com/posts` (low-signal sources)
- Require fact mentions year (2025/2026) AND verb (launches/announces/acquires/expands/opens/raises/partners/names/appoints)
- Min score threshold raised to 8 (not 6)

**Code update needed:** `scoreHit()` in `_email-pipeline.ts` — add low-signal source blocklist, raise gate threshold.

## Mistake 12: Token cost from inflated WebSearch context

**What happened:** ~50-60k tokens/batch with WebSearch. ~$0.50/batch on Sonnet. 22 batches = ~$11.

**Rule:** Serper pre-bake = ~40k tokens/batch + $0.005 Serper. ~20% token savings, ~$0.50 total Serper for 100 leads. Use Serper by default.

## Standard pipeline (codified)

```bash
# 1. Pull from Prospeo (use correct vertical_industries per category)
npx tsx scripts/pipeline/_pull-missing-verticals.ts

# 2. ICP score (sub-agent batches, real CSV data only)
# Always: awk -F',' 'NR>1{print $4" | "$5" | "$12" | "$13}' raw.csv | head -25
# Copy verbatim into prompt.

# 3. Build qualified inputs from intersection of raw + scores
npx tsx scripts/pipeline/_build-qualified-inputs.ts

# 4. Pipeline: Serper prebake + fact-rich gate + batch prompts
npx tsx scripts/pipeline/_email-pipeline.ts \
  --leads qualified.csv --vertical retail --client mythic

# 5. Dispatch each batch-N-prompt.txt to sub-agent
# 6. Save JSON output to data/runs/.../emails/

# 7. Validate immediately per batch
npx tsx scripts/pipeline/_validate-emails.ts --in emails/ --report r.json
# Re-dispatch any hard fails

# 8. Aggregate to per-vertical CSVs
npx tsx scripts/pipeline/_aggregate-showcase.ts
```

## Pre-flight checklist (run before every batch dispatch)

- [ ] Lead list dumped from actual CSV (no memory writing)
- [ ] Each lead has Serper-fetched fact (no thin leads)
- [ ] Each lead has anchor comp + role hook in prompt
- [ ] Banned vocab list in prompt
- [ ] Format rules in prompt (lowercase opener, ?, no em dash, no !)
- [ ] Batch size ≤ 5

## Post-batch checklist (run after every sub-agent return)

- [ ] Validator pass on JSON
- [ ] Spot-check 1 lead — source URL still loads, fact still recent
- [ ] If hard fail: re-dispatch with stricter prompt
- [ ] Save to `data/runs/showcase-YYYY-MM-DD/emails/`

---

# READ-ALOUD RULE (added v2 — apply on first iteration)

Every sentence must pass spoken aloud as a peer-to-peer note. If it sounds like a press release, deck, or industry shorthand, rewrite in plain English.

## Hard rules

- **Max 22 words per sentence.** Split run-ons. 12-18 is sweet spot.
- **No industry acronyms in body**: LTO, AOR, QSR, CPG, RTO, AOV, LTV, GTM, MQL, SQL, SaaS. Spell out or describe. Brand-name acronyms (DXL, ALO) OK as proper nouns.
- **No deck-speak ban list**: playbook, lane, umbrella story, brand architecture, marketing math, category entry point, service-line motion, go-to-market motion, share of voice, demand work.
- **Drop modifier crutches**: "is a real", "is a meaningful", "is a smart way to", "is a clean", "is a strong signal that". Say the thing directly.
- **State abbrevs in body**: spell out (AL → Alabama, MD → Maryland). Acronym OK in city contexts (NYC, LA).

## Acronym translations (pre-bake into prompt)

| Acronym | Body wording |
|---|---|
| LTO | "limited menu item" / "limited drop" / "new menu item" |
| QSR | "fast-casual" / "chain restaurant" |
| AOV | "average order" / "ticket size" |
| LTV | "lifetime spend" |
| DTC | "direct" / "owned site" |
| NBA | "league-wide partnership across all 30 basketball teams" |
| AI (in product context) | "smart" (smart glasses, not AI glasses) |

## Anchor-category-match rule

Anchor brand must share category logic with the lead. Mismatched anchors break trust on read-aloud.

| Lead vertical | Allowed anchors |
|---|---|
| Mythic QSR / restaurant / food_bev / hospitality | Subway, Meineke, Harley-Davidson |
| Mythic healthcare | Cone Health, UnitedHealthcare |
| Mythic financial | MetLife, Ally |
| Mythic retail | Subway, Harley-Davidson |
| BW home / furniture | Serena & Lily, DWR, Crate & Barrel, McGee & Co, Schoolhouse |
| BW apparel / lifestyle | Anthropologie, Reformation, STAUD, Vera Bradley |
| BW denim | AG, Paige |
| BW beauty | Bombas, Reformation (premium DTC analogues) |
| BW footwear / athletic | Bombas, Title Nine |
| BW food_bev | use stat-only ("3-8x ROAS on mail", "103% LTV mail vs digital"), no anchor |

**Never mix categories.** No Cone Health in a restaurant email. No Harley in healthcare.

## Validator rules (soft, surfaces drift)

`_validate-emails.ts` now flags:
- `read_aloud_max_sentence_22_words` — sentence >22 words
- `read_aloud_no_deck_speak` — banned deck-speak terms
- `read_aloud_no_acronyms_in_body` — banned acronyms in E1 body
- `read_aloud_anchor_category_match` — anchor mismatched to vertical

Hard rules unchanged (lowercase opener, ends with ?, no em dash, no exclamation, no banned phrases). Soft rules surface drift for re-dispatch decision.

## Style targets (gold-standard examples)

The 10-lead QSR rewrite (Katie/Miller's, Jennifer/LEYE, Erin/Atlas, etc.) is reference voice. Sentence patterns:

- Statement of fact from dossier → 1-sentence implication → soft offer with stat or anchor → 1-line CTA question
- "Three brand moments running at once. The biggest remodel since 1975. Allen opening as the 94th location." — fragments OK
- "That is a different brand problem than a single restaurant launch." — replaces "is a real bet that X can run a playbook"
- "Is the Northeast launch getting its own campaign, or rolling into national?" — concrete, answerable in one line

## Why this matters

At 1K+ scale, jargon-heavy emails feel ML-generated. Read-aloud rule is the cheapest quality gate that separates peer-voice from sales copy. Adds ~5% to sub-agent runtime, zero API cost increase.
