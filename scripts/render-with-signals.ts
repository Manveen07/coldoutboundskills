// ---------------------------------------------------------------------------
// Signal-aware renderer (Task 12)
//
// Orchestrates the full per-lead render flow:
//   tier  → readSidecar → selectSignal → writeBridgeSentence
//   → degrade-on-invalid → build E1/E2/E3/E4
//
// Amendments baked in:
//   - Amendment 5: Bridge writer enforces anti-Twain rules (handled upstream)
//   - Amendment 6: StatRotator ensures distinct stats across E1 and E2 per lead
//   - Amendment 7: E2 is a threaded follow-up with signal-tied back-reference
//   - Amendment 9: Acquisition signal split from press (handled in selector)
//
// Subject strategy: hardcoded 'anchor' for v1; signal-tied subjects deferred
// to Task 21 cleanup.
// ---------------------------------------------------------------------------

import { readSidecar } from './_lib_signals';
import { computeTier, EnrichmentTier } from './_lib_tier';
import { selectSignal, SelectedSignal } from './_signal_selector';
import { writeBridgeSentence, AiInvoker } from './_bridge_writer';
import { StatRotator } from './_stat_rotator';

export interface LeadInput {
  person_id: string;
  first_name: string;
  full_name: string;
  current_job_title: string;
  company_name: string;
  company_domain: string;
  qual_confidence: number;
  primary_vertical: string;
  assigned_variant: 'B' | 'C';
  vertical_anchor?: string;
  ai_similarity_dimension?: string;
  ai_brand_category?: string;
  ai_role_hook: string;
  // Amendment 8 (optional override fields):
  company_description?: string;
  upstream_industry?: string;
}

export interface RenderedLead {
  person_id: string;
  enrichment_tier: EnrichmentTier;
  signal_used: string;
  signal_fact: string;
  signal_bridge: string;
  signal_freshness_days: number;
  signal_e2_back_reference: string;
  email1_subject: string;
  email1_body: string;
  email2_subject: string; // empty for threaded follow-up
  email2_body: string;
  email3_subject: string;
  email3_body: string;
  email4_subject: string;
  email4_body: string;
}

export interface RenderOptions {
  subjectStrategy?: SubjectStrategy;
}

type SubjectStrategy = 'anchor' | 'category' | 'signal' | 'mixed';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Anchor proof block per BW client vertical (6 anchors).
 * `{{company_name}}` is the only variable interpolated at render time.
 */
const ANCHOR_PROOF: Record<string, string> = {
  'Serena & Lily': "We've been running direct mail for Serena & Lily for 11 years. {{company_name}} reminds me of where they were around 2017",
  'Bombas': "We run direct mail for Bombas. Scaled from a single test into their core profitable acquisition channel. {{company_name}} sits in the same lane",
  'AG': "We run direct mail for AG, built on transactional-data targeting for higher-value denim buyers. {{company_name}} is in the same bracket",
  'Sundance': "We run direct mail for Sundance. Lifted new customer acquisition 36 points in six months. {{company_name}} reminds me of them",
  'Title Nine': "We run paid digital for Title Nine. Restructured funnel-based paid media for clean ROAS lift on prospecting. {{company_name}} sits in the same lane",
  'Birkenstock': "Birkenstock runs our Swift programmatic direct mail. Co-op transactional data lifted their ecommerce conversion. {{company_name}} could test the same play",
};

/**
 * Amendment 7 — Email 2 back-reference templates keyed on signal_used.
 * Empty string for company_snippet/fallback (no signal to reference back to).
 */
const E2_BACK_REF_TEMPLATES: Record<string, string> = {
  funding: "Brands at the funding stage you're at tend to move on benchmark decks fast.",
  new_role: "First quarter in role is when this kind of benchmark data gets attention.",
  promotion: "Role transitions are when channel-mix questions get the most attention.",
  product_launch: "Launches like this usually pull on acquisition data within the same quarter.",
  press: "Expansion at that pace usually surfaces the channel-mix question right after.",
  acquisition: "Brands integrating a new acquisition tend to surface acquisition-mix questions in the same quarter.",
  company_snippet: "",
  fallback: "",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function subjectForVariant(lead: LeadInput): string {
  if (lead.assigned_variant === 'B' && lead.vertical_anchor) {
    return `the ${lead.vertical_anchor.toLowerCase()} playbook`;
  }
  return `DM economics for ${lead.ai_brand_category || 'premium DTC'}`;
}

function buildEmail1(
  lead: LeadInput,
  sig: { signal_used: string; signal_fact: string },
  bridge: string,
  statRotator: StatRotator
): string {
  const factLine = sig.signal_fact ? `${sig.signal_fact} ${bridge}`.trim() : '';

  if (lead.assigned_variant === 'B' && lead.vertical_anchor) {
    const proof = (ANCHOR_PROOF[lead.vertical_anchor] || '').replace(
      /\{\{company_name\}\}/g,
      lead.company_name
    );
    return [
      `${lead.first_name}, ${factLine}`.trim(),
      ``,
      `${proof}.`,
      ``,
      `${lead.company_name} sits in the same lane on ${lead.ai_similarity_dimension || ''}.`,
      ``,
      `${lead.ai_role_hook}. Worth comparing notes on what worked for them?`,
    ]
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Variant C
  const stat1 = statRotator.nextFor(lead.person_id);
  return [
    `${lead.first_name}, ${factLine}`.trim(),
    ``,
    `One stat from our portfolio: ${stat1}.`,
    ``,
    `Your ${lead.ai_brand_category || 'premium'} positioning makes the math favorable: economics improve as AOV rises. ${lead.ai_role_hook}. Want me to walk you through DM economics for your AOV bracket?`,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Amendment 7 — threaded follow-up. Empty subject (replies inline).
 * Word-count cap (≤65) is enforced upstream by Check 15 in Task 14.
 */
function buildEmail2(
  lead: LeadInput,
  _sig: { signal_used: string },
  backRef: string,
  statRotator: StatRotator
): string {
  const stat2 = statRotator.nextFor(lead.person_id);
  const backRefLine = backRef ? `\n\n${backRef}` : '';
  return [
    `${lead.first_name}, bumping this up. Quick number from our portfolio: ${stat2}.${backRefLine}`,
    ``,
    `Want me to send the category benchmark deck?`,
  ].join('\n').trim();
}

function buildEmail3(lead: LeadInput): string {
  return [
    `${lead.first_name}, two years ago most premium DTC brands we work with had Meta and Google owning the majority of their acquisition mix. That share is dropping. CACs went unstable, auctions got harder to forecast, CFOs started asking why one platform owned that much of the P&L.`,
    ``,
    `Direct mail isn't a Meta replacement, it's the diversification. The data behind it: co-op transactional records across 4,000+ brands. Doesn't get re-priced when Apple changes the rules.`,
    ``,
    `How concentrated is ${lead.company_name}'s acquisition mix?`,
  ]
    .join('\n')
    .trim();
}

function buildEmail4(lead: LeadInput): string {
  return [
    `${lead.first_name}, last note from me. We can run a no-strings audit of ${lead.company_name}'s current direct mail or paid acquisition program. Last 2-3 drops or last quarter of spend, annotated PDF, recommendations on segmentation, format, and frequency. Five business days, no pitch attached.`,
    ``,
    `Useful, or should I close the loop with someone else on your team?`,
  ]
    .join('\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Render a single lead into a 4-email sequence using its signal sidecar.
 *
 * Flow:
 *  1. Compute enrichment tier from qual_confidence + title.
 *  2. Read company-level signal sidecar (PND blocked — Task 19).
 *  3. Select best in-window signal.
 *  4. If a real signal (not fallback) — generate bridge via AI invoker.
 *  5. If bridge invalid — degrade gracefully to fallback (no signal fact).
 *  6. Build E1 / E2 / E3 / E4 with anchor proof (B) or stat (C).
 *  7. Return RenderedLead with all 14 fields populated.
 */
export async function renderLead(
  lead: LeadInput,
  aiInvoke: AiInvoker,
  sidecarDir: string = 'data/signals',
  statRotator?: StatRotator,
  _options?: RenderOptions
): Promise<RenderedLead> {
  const rotator = statRotator ?? new StatRotator();

  // Step 1 — tier
  const enrichment_tier = computeTier({
    qual_confidence: lead.qual_confidence,
    title: lead.current_job_title,
  });

  // Step 2 — sidecar (company-level only; PND blocked)
  const companySidecar = readSidecar(lead.company_domain, sidecarDir) ?? {
    schema_version: '1.0',
    domain: lead.company_domain,
    fetched_at: new Date().toISOString(),
  };

  // Step 3 — signal selection
  let selected: SelectedSignal = selectSignal(companySidecar, null);

  // Step 4 — bridge generation for real signals
  let bridge = '';
  if (selected.signal_used !== 'fallback' && selected.signal_fact) {
    // Don't generate a bridge for company_snippet — snippet stands alone as
    // the fact line. The signal is the snippet itself, not a news event.
    if (selected.signal_used !== 'company_snippet') {
      const result = await writeBridgeSentence(
        {
          signal_used: selected.signal_used,
          signal_fact: selected.signal_fact,
          company_name: lead.company_name,
          first_name: lead.first_name,
        },
        aiInvoke,
        2,
        { person_id: lead.person_id }
      );
      if (result.valid) {
        bridge = result.bridge;
      } else {
        // Step 5 — degrade to fallback (Amendment 5 — fail closed)
        selected = {
          signal_used: 'fallback',
          signal_fact: null,
          signal_freshness_days: 0,
        };
        bridge = '';
      }
    }
  }

  // Step 6 — E2 back-reference (Amendment 7)
  const backRef = E2_BACK_REF_TEMPLATES[selected.signal_used] ?? '';

  // Step 7 — build emails
  const signalForBuilder = {
    signal_used: selected.signal_used,
    signal_fact: selected.signal_fact ?? '',
  };

  const email1_body = buildEmail1(lead, signalForBuilder, bridge, rotator);
  const email2_body = buildEmail2(lead, signalForBuilder, backRef, rotator);
  const email3_body = buildEmail3(lead);
  const email4_body = buildEmail4(lead);

  const email1_subject = subjectForVariant(lead);

  return {
    person_id: lead.person_id,
    enrichment_tier,
    signal_used: selected.signal_used,
    signal_fact: selected.signal_fact ?? '',
    signal_bridge: bridge,
    signal_freshness_days: selected.signal_freshness_days,
    signal_e2_back_reference: backRef,
    email1_subject,
    email1_body,
    email2_subject: '', // threaded — empty subject
    email2_body,
    email3_subject: `re: ${email1_subject}`,
    email3_body,
    email4_subject: `re: ${email1_subject}`,
    email4_body,
  };
}

async function runCli() {
  const inputCsv = process.argv[2];
  const outputCsv = process.argv[3];
  const responsesDir = process.argv[4];
  if (!inputCsv || !outputCsv) {
    console.error('Usage: tsx scripts/render-with-signals.ts <leads-with-signals.csv> <leads-final-v5.csv> <responses-dir>');
    process.exit(1);
  }
  if (!responsesDir) {
    console.error(`ERROR: <responses-dir> required.

Workflow:
  1. npx tsx scripts/extract-signals.ts <input> <leads-with-signals.csv>
  2. npx tsx scripts/prepare-bridge-prompts.ts <leads-with-signals.csv> <bridge-tasks.json>
  3. (In Claude Code chat) dispatch Task subagents to populate <responses-dir>
  4. npx tsx scripts/render-with-signals.ts <leads-with-signals.csv> <leads-final-v5.csv> <responses-dir>`);
    process.exit(1);
  }

  const { readFileSync, writeFileSync } = await import('fs');
  const text = readFileSync(inputCsv, 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n').filter(Boolean);
  const headers = lines[0].split(',');
  const rows = lines.slice(1).map(line => {
    const vals = line.split(',');
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => obj[h] = vals[i] ?? '');
    return obj;
  });

  const { makeFileBasedInvoker } = await import('./_file_based_invoker');
  const aiInvoke = makeFileBasedInvoker(responsesDir);

  const { StatRotator } = await import('./_stat_rotator');
  const rotator = new StatRotator();

  const rendered: Record<string, any>[] = [];
  for (const lead of rows) {
    try {
      const r = await renderLead({
        person_id: lead.person_id,
        first_name: lead.first_name,
        full_name: lead.full_name,
        current_job_title: lead.current_job_title,
        company_name: lead.company_name,
        company_domain: lead.company_domain,
        qual_confidence: parseFloat(lead.qual_confidence),
        primary_vertical: lead.primary_vertical,
        assigned_variant: lead.assigned_variant as 'B' | 'C',
        vertical_anchor: lead.vertical_anchor,
        ai_similarity_dimension: lead.ai_similarity_dimension,
        ai_brand_category: lead.ai_brand_category,
        ai_role_hook: lead.ai_role_hook,
      }, aiInvoke, 'data/signals', rotator);

      rendered.push({ ...lead, ...r });
    } catch (err) {
      console.error(`Render error for ${lead.person_id}: ${err}`);
    }
  }

  const outHeaders = [
    ...headers,
    'enrichment_tier', 'signal_used', 'signal_fact', 'signal_bridge',
    'signal_freshness_days', 'signal_e2_back_reference',
    'email1_subject', 'email1_body', 'email2_subject', 'email2_body',
    'email3_subject', 'email3_body', 'email4_subject', 'email4_body',
  ];
  const outLines = [outHeaders.join(',')];
  for (const r of rendered) {
    outLines.push(outHeaders.map(h => {
      const v = r[h] ?? '';
      const s = String(v);
      return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','));
  }
  writeFileSync(outputCsv, outLines.join('\n'));
  console.error(`Wrote ${rendered.length} rendered leads to ${outputCsv}`);
}

import { pathToFileURL } from 'url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(e => { console.error(e); process.exit(1); });
}
