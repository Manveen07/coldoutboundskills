// ---------------------------------------------------------------------------
// Uniqueness classifier (Fix #5 call learnings) — classifies a signal fact
// as either a specific event (usable) or a generic category truth (reject).
//
// Used inside generateBridgeTasks to filter out facts that read as fake
// personalization because they are true of every company in the category.
// ---------------------------------------------------------------------------

import { AiInvoker } from './_bridge_writer';

export type UniquenessVerdict = 'specific_event' | 'generic_for_category';

export interface ClassifyFactInput {
  signal_type: string;      // e.g. "funding", "press", "product_launch"
  signal_fact: string;      // the extracted fact sentence
  company_name: string;
  primary_vertical: string; // e.g. "Swimwear", "Activewear"
}

export const UNIQUENESS_PROMPT_TEMPLATE = `You classify whether a fact extracted from a web search is a SPECIFIC EVENT or a GENERIC CATEGORY TRUTH.

SPECIFIC EVENT: Something that happened to this company specifically — a funding round, a named product launch, a named acquisition, a named partnership, press coverage of a particular thing.

GENERIC CATEGORY TRUTH: Something true of most companies in this category — "operates in the fashion industry", "has a DTC channel", "sells products online", "offers free shipping", "overnight port stay" (for cruise brands), "has multiple locations".

Rules:
- If the fact names a dollar amount, a named product, a named partner, a specific date, or a specific outcome → SPECIFIC EVENT
- If the fact could be written about 80%+ of companies in the same vertical → GENERIC CATEGORY TRUTH
- When uncertain → GENERIC CATEGORY TRUTH (fail safe)

INPUT:
  signal_type: {signal_type}
  company: {company_name}
  vertical: {primary_vertical}
  fact: "{signal_fact}"

Reply with exactly one word: specific_event OR generic_for_category`;

export function buildUniquenessPrompt(input: ClassifyFactInput): string {
  return UNIQUENESS_PROMPT_TEMPLATE
    .replace('{signal_type}', input.signal_type)
    .replace('{company_name}', input.company_name)
    .replace('{primary_vertical}', input.primary_vertical)
    .replace('{signal_fact}', input.signal_fact);
}

export async function classifyFactUniqueness(
  input: ClassifyFactInput,
  aiInvoke: AiInvoker,
): Promise<UniquenessVerdict> {
  const prompt = buildUniquenessPrompt(input);
  const response = await aiInvoke(prompt);
  const normalized = response.trim().toLowerCase();
  if (normalized.includes('specific_event')) {
    return 'specific_event';
  }
  return 'generic_for_category';
}
