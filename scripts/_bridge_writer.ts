// ---------------------------------------------------------------------------
// Bridge writer (Task 11) — AI subagent integration + pre-validation
// against banned lists. Amendment 5 anti-Twain rules baked into prompt.
// ---------------------------------------------------------------------------

import {
  findBannedWords,
  findBannedStarts,
  findFirstPersonObservation,
} from './_lib_banned';

export interface BridgeContext {
  signal_used: string;
  signal_fact: string;
  company_name: string;
  first_name: string;
}

export interface BridgeResult {
  valid: boolean;
  bridge: string;
  reason?: string;
}

export type AiInvoker = (
  prompt: string,
  context?: { person_id?: string }
) => Promise<string>;

/**
 * Bridge-writer prompt template. Amendment 5 anti-Twain rules are baked in:
 *  - Third-person fact framing only (no "Saw", "I see", "I noticed", etc.)
 *  - Category-level patterns only (no editorializing about the company)
 *  - Banned words list mirrored from `_lib_banned.ts`
 *  - Hedge budget: ≤1 soft word per sentence
 *  - Anchor specificity: no "peer brand" / "same consumer" placeholders
 *  - One sentence, ≤25 words, period at end, starts with capital letter
 */
export const BRIDGE_PROMPT_TEMPLATE = `You write ONE bridge sentence (≤25 words) that follows a signal fact in a cold email.

HARD RULES:
- Third-person fact framing only. Never start with "Saw", "Noticed", "Caught", "I see", "I noticed", "I saw", "I caught", "Saw that", "I don't see", "I'm guessing", "I imagine".
- State a category-level pattern true for the signal TYPE only. NEVER editorialize about the company.
- Banned words: smart, smarter, smartest, smartly, best, savvy, savviness, leading, leading-edge, top-tier, top-rated, great, exceptional, brilliant, brilliantly, amazing, awesome, fantastic, impressive, best-in-class, best-of-breed, fresh eyes, fresh perspective, fresh take, the right person, the right time, perfect timing, caught my eye, tends to, tend to, usually see, usually drives, often see, brands at this stage, brands at that stage, brands in this category, brands in that category.
- One sentence. Period at end. Start with capital letter.

NEVER use these patterns (critical, Amendment 5):
- "Saw [company] is..." → use "[company]'s [event] [date]..." instead
- "I see you..." → use "Your [event]..." instead
- "I don't see X on your end" → drop the observation, state the category pattern only
- "Brands at this stage usually..." → use "Brands at the [specific funding stage / revenue band / channel mix] you're at..."
- "X tends to..." / "X usually drives..." → use "X has driven..." with specific reference

Hedge budget: ONE soft word ("likely", "probably", "often", "usually") MAXIMUM per sentence. Stack of hedges = rejection.

Anchor references: NEVER write "a brand targeting the same consumer" or "a peer brand". Use the specific BW client name from the input context. If no specific anchor available, omit the case-study sentence entirely.

INPUT:
  signal_type: {signal_used}
  signal_fact (already written, will appear before your sentence): "{signal_fact}"
  company: {company_name}
  recipient first name: {first_name}

Write ONE bridge sentence that follows the signal_fact naturally.`;

/**
 * Build the bridge-writer prompt by interpolating context fields into
 * the template. Each placeholder is replaced exactly once.
 *
 * Exported so `prepare-bridge-prompts.ts` can reuse the same template
 * when materializing per-lead prompts for subagent dispatch.
 */
export function buildBridgePrompt(ctx: BridgeContext): string {
  return BRIDGE_PROMPT_TEMPLATE.replace('{signal_used}', ctx.signal_used)
    .replace('{signal_fact}', ctx.signal_fact)
    .replace('{company_name}', ctx.company_name)
    .replace('{first_name}', ctx.first_name);
}

/**
 * Call the AI subagent to write a bridge sentence, then run 4 validation
 * gates in order: banned words → banned starts → first-person observation
 * (Check 11b, Amendment 4) → ≤25 words.
 *
 * On failure, retries once with a stricter prompt addendum that names the
 * specific violation. After `maxRetries` attempts, returns `valid: false`
 * with the last failure reason.
 */
export async function writeBridgeSentence(
  ctx: BridgeContext,
  aiInvoke: AiInvoker,
  maxRetries = 2,
  invokerContext?: { person_id?: string }
): Promise<BridgeResult> {
  const basePrompt = buildBridgePrompt(ctx);

  let lastReason = '';
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const prompt =
      attempt === 0
        ? basePrompt
        : basePrompt +
          '\n\nPREVIOUS ATTEMPT VIOLATED RULES. Try again, stricter. Reason: ' +
          lastReason;

    const bridge = (await aiInvoke(prompt, invokerContext)).trim();

    // Gate 1: banned words
    const bannedWords = findBannedWords(bridge);
    if (bannedWords.length > 0) {
      lastReason = `banned word(s) found: ${bannedWords.join(', ')}`;
      continue;
    }

    // Gate 2: banned sentence-starts
    const bannedStarts = findBannedStarts(bridge);
    if (bannedStarts.length > 0) {
      lastReason = `banned sentence-start(s) found: ${bannedStarts.join(', ')}`;
      continue;
    }

    // Gate 3: first-person observation (Check 11b — Amendment 4)
    const firstPerson = findFirstPersonObservation(bridge);
    if (firstPerson.length > 0) {
      lastReason = `first-person observation pattern(s) found: ${firstPerson.join(', ')}`;
      continue;
    }

    // Gate 4: ≤25 words
    const wordCount = bridge.split(/\s+/).filter(Boolean).length;
    if (wordCount > 25) {
      lastReason = `over 25 words (got ${wordCount})`;
      continue;
    }

    return { valid: true, bridge };
  }

  return { valid: false, bridge: '', reason: lastReason };
}
