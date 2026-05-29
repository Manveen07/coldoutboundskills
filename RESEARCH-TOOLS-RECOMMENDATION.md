# Research-Tool Recommendations for Cold Email Personalization

*For: deciding which external research tools to bolt onto the pipeline · Date: 2026-05-26*

User asked: do we need Serper / Surfer / RapidAPI / BuiltWith / Clay / etc. to get better personalization, better cold emails, more insights on leads?

Short answer: **Yes — but only a couple. The rest are either wrong category or overkill at our current scale.**

This doc ranks the candidate tools, recommends two adds, and rejects the rest with reasons. Read top to bottom — the ranked priority matters.

---

## TL;DR — the three I'd add (in order)

| Priority | Tool | What for | Cost | When to add |
|---|---|---|---|---|
| **#1** | **BuiltWith API** | Pre-Prospeo filter: is the brand on Shopify + Klaviyo? | ~$35-99/mo | Add NOW. Biggest qual-rate lift. |
| **#2** | **Serper API** | Per-lead research: fetch homepage + press releases + recent news during AI enrichment | ~$5 per 1k queries (~$0.005/lead) | Add after BuiltWith. Improves Variant B/C personalization quality. |
| **#3** | **RapidAPI** (already partly used) | Selected scrapers we already rely on (Google Maps for SMB pulls, LinkedIn data for competitor-engagers skill) | Pay per use | Already on the radar. Keep where it makes sense. |

**Skip:** SurferSEO (wrong category — that's an SEO tool, not personalization).
**Skip for now:** Clay (powerful all-in-one but $$$$, redundant with what we built).

---

## The personalization quality gap (what's missing right now)

Our current per-lead enrichment uses only:
- Prospeo metadata (title, company, industry tag, headcount, location)
- AI subagent reasoning over that metadata + minimal site context

What this misses:
- **Tech stack** (Shopify? Klaviyo? Listrak? Bronto?) — biggest single signal for "are they even a real DTC brand?"
- **Recent news / funding / launches** — "noticed your Series B last quarter" type personalization
- **Catalog cadence** (frequency of new product drops) — would justify Variant A coming back
- **Store count / footprint** — qualifies "store-plus-DTC mix" claims in Variant B
- **AOV signal** (catalog price points, not guesses)

Right now the AI subagent reasons about most of these from name + industry alone. That's why `ai_similarity_dimension` often falls back to NULL (→ Variant C) on borderline leads. With more grounded data, more leads route to B with confident proof.

---

## #1 — BuiltWith API (HIGHEST PRIORITY)

**What it does:** Tells you the tech stack on any domain. Detects Shopify, BigCommerce, Magento, Klaviyo, Listrak, Iterable, Stripe, Recharge, AfterPay, Tapcart, Postscript, etc.

**Why it matters for us (BW case):**

The single biggest lever for raising qual rate is **filtering OUT brands that aren't actually DTC.** In the v1 BW run, home category qualified at 14%. Most rejects were:
- B2B-only (Workscapes — commercial furniture dealer)
- Wholesale / to-the-trade
- Department-store carriers with no own DTC ecom
- Marketplaces

If we pre-filter for "site runs Shopify + Klaviyo" before sending to Prospeo, we kill ~70% of the off-ICP volume before burning credits.

**Math:**
- 50 Prospeo credits, blended pull → 945 raw → 386 qualified (40.8%)
- With BuiltWith Shopify+Klaviyo pre-filter → estimated 945 raw → 700 pre-qualified → ~500-560 qualified (~73-80% qual rate)
- Same lead count for half the Prospeo credits

**Cost:** ~$35-99/mo for 1k-10k domain lookups. Free tier sometimes available.

**Integration sketch (~1 day work):**

```typescript
// scripts/builtwith-prefilter.ts
async function checkTechStack(domain: string): Promise<{ shopify: boolean; klaviyo: boolean }> {
  const res = await fetch(`https://api.builtwith.com/v21/api.json?KEY=${KEY}&LOOKUP=${domain}`);
  const data = await res.json();
  const techs = data.Results[0]?.Result?.Paths[0]?.Technologies?.map(t => t.Name.toLowerCase()) || [];
  return {
    shopify: techs.some(t => t.includes("shopify")),
    klaviyo: techs.some(t => t.includes("klaviyo")),
  };
}

// Use as Prospeo pre-filter: skip any Prospeo result whose domain fails Shopify+Klaviyo check
```

Put it in front of `prospeo-trial-search.ts`. Caches domain lookups so we don't re-pay for the same brand.

**Verdict:** **Add immediately.** Biggest qual-rate lift for least integration effort.

---

## #2 — Serper API (SECOND PRIORITY)

**What it does:** Google search API. Take a query string, get back the structured Google SERP (titles, snippets, URLs, knowledge panel). 1k queries for ~$5.

**Why it matters for us:**

Right now AI enrichment runs blind on title + company name + Prospeo industry tag. Adding Serper lets each lead's enrichment subagent fetch:
- Homepage snippet ("we sell premium organic skincare since 2018")
- Recent press releases / news ("Aroma360 expands to Sephora retail")
- Store-locator pages ("12 retail locations" → qualifies "store-plus-DTC mix" claim)
- Press mentions ("featured in Vogue") — quality signal for premium positioning

**How it integrates into the AI personalization step:**

```typescript
// Inside enrichment subagent prompt, for each lead:
//   1. Serper query: "{company_name} site:.com" → snippet
//   2. Serper query: "{company_name} press release 2025" → recent news
//   3. Serper query: "{company_name} retail stores" → store count
//   4. Subagent reasons over: Prospeo metadata + 3 Serper snippets + ICP rules
//   5. Outputs the 4 AI variables with NULL fallback as before
```

Each lead costs ~3 Serper queries = $0.015. For 1k leads that's $15. Trivial vs the personalization quality lift.

**What it unblocks:**

- **Bring Variant A back from dormant.** A was retired because subagent fabricated catalog observations. With Serper data, A can reference *actual recent press* ("noticed your new Spring/Summer collection drop") — grounded, not fabricated.
- **Higher Variant B confidence.** Sim-dim won't fall back to NULL as often.
- **Better Variant C category names.** Right now it sometimes outputs vague like "premium home decor"; with Serper snippets it can output "premium organic baby + maternity skincare".

**Verdict:** **Add second.** Best per-dollar personalization improvement.

**Caveat:** RapidAPI hosts Serper too (sometimes cheaper). Worth comparing before subscribing direct.

---

## #3 — RapidAPI (already in use, keep)

**What it does:** Marketplace of APIs. We already use it (per `.env.example`) for:
- Google Maps scraping (`google-maps-list-builder` skill)
- LinkedIn data (`competitor-engagers` skill)

**Why it stays:**

- Already integrated, already paid for
- Sometimes hosts Serper, BuiltWith, etc. at cheaper rates than direct
- Useful for one-off researchers (LinkedIn post-engagement, news monitoring)

**What's NOT useful from RapidAPI right now:**

- Email finders (Prospeo + Blitz already cover this)
- Apollo wrappers (we moved off Apollo to Prospeo)

**Verdict:** Already in toolbox. Don't add more skills against it until BuiltWith + Serper are integrated.

---

## ❌ SurferSEO — wrong category

**What it does:** SEO content optimization (analyzes Google-ranking pages, tells you what keywords/terms to include).

**Why it's wrong for us:**

- We're not optimizing landing pages or blog content
- It's a content-marketing tool, not a personalization research tool
- Confusion is understandable because it has "Surfer" in the name — but this is SEO, not cold email research

**Verdict:** Skip. User probably meant Serper (which is what they confirmed with the "serper" follow-up).

---

## 🟡 Clay — powerful but overkill at our scale

**What it does:** All-in-one enrichment + workflow platform. Connects 50+ data sources (Apollo, LinkedIn, Clearbit, etc.). Has AI prompts built in. Used by mid-market sales teams.

**Why it's tempting:**

- Replaces a lot of our custom scripts with point-and-click workflows
- Pre-built integrations for the data sources we'd be wiring manually
- Visual enrichment pipelines

**Why I'd skip it for now:**

- **Cost:** Starts ~$149/mo, real value comes at $349+/mo tiers
- **Lock-in:** Workflows live in Clay, hard to migrate out
- **We've already built the pipeline.** Custom Claude Code subagents + Prospeo + BuiltWith + Serper covers ~95% of what Clay does for our use case
- **AI prompts are less hardened than ours.** We've spent weeks dialing in NULL fallbacks, no-fabrication rules, word limits. Clay's defaults won't match.

**When Clay makes sense:** when we're running 5+ clients in parallel and the manual subagent dispatching becomes the bottleneck. Not today.

**Verdict:** Re-evaluate at Q4 2026 if client count scales past 3.

---

## 🟡 Apollo — Prospeo alternative, redundant

**What it does:** People + company database with email finder. Was our original list-building source before Prospeo trial.

**Why we moved off:** Cost per credit was less favorable for the title-first searches we run.

**Verdict:** Keep as backup if Prospeo Free tier exhausts and Starter $39/mo doesn't scale. Don't add proactively.

---

## 🟡 Clearbit / ZoomInfo — enterprise-grade, wrong fit

**What they do:** Premium enrichment with deep firmographics, hierarchical org charts, intent data.

**Why we skip:**

- Pricing aimed at enterprise sales orgs ($1k+/mo)
- Built for outbound *prospecting* not lead enrichment-after-pull
- Overkill for our use case (we're not selling enterprise SaaS)

**Verdict:** Skip unless client requirements change to enterprise B2B.

---

## 🟡 Crunchbase / PitchBook — funding signals only

**What they do:** Private-company funding rounds, valuations, investors.

**Why niche:**

- Funding signal is great personalization fodder ("noticed your Series B")
- But Crunchbase has rate-limited free tier; PitchBook is enterprise pricing
- Serper queries can scrape funding-round headlines from Google News for ~free

**Verdict:** Get this signal via Serper instead. Skip dedicated subscription.

---

## Integration roadmap (if we add BuiltWith + Serper)

### Phase 1 — BuiltWith pre-filter (1 week)
- Subscribe to BuiltWith API
- Write `scripts/builtwith-prefilter.ts` — domain → {shopify, klaviyo, listrak}
- Modify `prospeo-trial-search.ts` to skip results where Shopify=false
- Cache lookups in `data/builtwith-cache.json`
- Test: pull 1 credit of home + check qual rate vs un-prefiltered baseline

### Phase 2 — Serper enrichment (1 week)
- Subscribe to Serper (or RapidAPI Serper)
- Write `scripts/serper-enrich.ts` — company → {homepage_snippet, press_releases, retail_count}
- Modify enrichment subagent prompts in `clay-personalization-prompts.md` to consume Serper context
- Re-render BW v1 leads (or a sample) with Serper context added
- A/B compare: Email 1 reply rate v4 (no Serper) vs v5 (with Serper)

### Phase 3 — Revive Variant A (week 3)
- With Serper grounding press releases, the dormant Variant A "format observation" can come back grounded
- Update `variants.yaml` to re-enable Variant A as third sequence option for high-confidence leads only
- Renderer routes top-confidence (≥0.85) → A, mid → B, low → C
- Validator adds Check 11: A leads must reference a real Serper-sourced fact

---

## Cost summary if we add both

| Item | Monthly cost |
|---|---|
| BuiltWith API (5k lookups/mo) | ~$50/mo |
| Serper (200k queries/mo, generous) | ~$50/mo |
| **Net add** | **~$100/mo** |

Recoups itself if it raises qual rate from 40% → 60% across a 2k-lead campaign:
- Saves ~12 Prospeo credits per campaign (= $5)
- Higher reply rate compounds — even a +0.3% positive-reply lift on 2k leads is 6 extra conversations

ROI breaks even on first campaign improved.

---

## What I would NOT do

- ❌ Subscribe to Clay before client count > 3
- ❌ Subscribe to ZoomInfo / Clearbit at our scale
- ❌ Buy SurferSEO (wrong category)
- ❌ Add LinkedIn scrapers — risky, ToS-grey-area, scrapers break weekly
- ❌ Try to replace Prospeo with anything before Starter $39/mo plan is tested

---

## Recommended next move

1. **This sprint:** subscribe to BuiltWith. Build pre-filter. Test on next category pull (Apparel category, when team approves expansion past Home pilot).
2. **Next sprint:** subscribe to Serper. Wire into enrichment subagents. Re-render BW v5 with Serper grounding.
3. **Defer:** Clay, Crunchbase, LinkedIn scrapers — re-evaluate at Q4 2026.

---

*Open question for the team: which one to fund first if we can only do one? My vote: BuiltWith — qual rate lift dwarfs personalization lift at our current scale.*
