// ---------------------------------------------------------------------------
// Banned-word + sentence-start matcher (Task 4, Amendment 4 extended)
// ---------------------------------------------------------------------------

export const BANNED_WORDS_SINGLE: readonly string[] = [
  'smart',
  'smarter',
  'smartest',
  'smartly',
  'best',
  'savvy',
  'savviness',
  'leading',
  'great',
  'exceptional',
  'brilliant',
  'brilliantly',
  'amazing',
  'awesome',
  'fantastic',
  'impressive',
];

export const BANNED_WORDS_COMPOUND: readonly string[] = [
  // Original compound phrases
  'best-in-class',
  'best-of-breed',
  'leading-edge',
  'top-tier',
  'top-rated',
  'fresh eyes',
  'fresh perspective',
  'fresh take',
  'the right person',
  'the right time',
  'perfect timing',
  // Amendment 4 additions
  'caught my eye',
  'tends to',
  'tend to',
  'usually see',
  'usually drives',
  'often see',
  'brands at this stage',
  'brands at that stage',
  'brands in this category',
  'brands in that category',
];

export const BANNED_STARTS: readonly string[] = [
  // Original starts
  'Saw',
  'Noticed',
  'Caught',
  'I see',
  'I noticed',
  'I saw',
  'I caught',
  // Amendment 4 additions
  'Saw that',
  "I don't see",
  "I'm guessing",
  'I imagine',
  'I am guessing',
  'I am imagining',
  'I could imagine',
];

/**
 * Precomputed once at module load: longest banned-start first so multi-token
 * starts (e.g. "Saw that") win over their single-token prefix ("Saw").
 */
const BANNED_STARTS_SORTED: readonly string[] = [...BANNED_STARTS].sort(
  (a, b) => b.length - a.length
);

/**
 * Allowlisted compounds — when these appear, they suppress the
 * single-token banned-word match for the leading banned word. Lets
 * idioms like "best practices" pass without flagging "best".
 */
const BANNED_WORD_ALLOWLIST_COMPOUNDS: readonly string[] = [
  'best practices',
];

/**
 * Returns the list of banned words/phrases found in `text`.
 * - Compound phrases are matched via lowercased substring inclusion.
 * - Single banned tokens are matched by splitting whitespace and
 *   stripping surrounding punctuation. Embedded matches (e.g. "smart"
 *   inside "smartphone") are NOT counted.
 * - Allowlisted compounds (e.g. "best practices") suppress the
 *   single-token match for their leading banned word at those positions.
 * - Result is deduplicated, preserving first-found order.
 */
export function findBannedWords(text: string): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  const lower = text.toLowerCase();

  // 1) Compound phrases via substring inclusion (lowercased)
  for (const phrase of BANNED_WORDS_COMPOUND) {
    const p = phrase.toLowerCase();
    if (lower.includes(p) && !seen.has(p)) {
      results.push(p);
      seen.add(p);
    }
  }

  // 2) Mask allowlisted compounds so their tokens are not single-counted.
  let masked = lower;
  for (const allow of BANNED_WORD_ALLOWLIST_COMPOUNDS) {
    const a = allow.toLowerCase();
    // Replace each occurrence with spaces of equal length to preserve offsets.
    masked = masked.split(a).join(' '.repeat(a.length));
  }

  // 3) Single tokens — split on whitespace, strip surrounding punctuation
  const tokens = masked
    .split(/\s+/)
    .map((t) => t.replace(/^[.,;:!?()"']+|[.,;:!?()"']+$/g, ''))
    .filter((t) => t.length > 0);

  const singleSet = new Set(BANNED_WORDS_SINGLE.map((w) => w.toLowerCase()));
  for (const tok of tokens) {
    if (singleSet.has(tok) && !seen.has(tok)) {
      results.push(tok);
      seen.add(tok);
    }
  }

  return results;
}

/**
 * Returns the list of banned sentence-start phrases found at the
 * beginning of any sentence in `text`. Sentences are split via
 * lookbehind on `.!?` followed by whitespace. Match is case-insensitive
 * but the original-cased banned-start string is preserved in the result.
 */
export function findBannedStarts(text: string): string[] {
  const results: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);

  for (const raw of sentences) {
    const sent = raw.trim();
    if (!sent) continue;
    const sentLower = sent.toLowerCase();

    for (const start of BANNED_STARTS_SORTED) {
      const startLower = start.toLowerCase();
      if (sentLower === startLower || sentLower.startsWith(startLower + ' ')) {
        results.push(start);
        break;
      }
    }
  }

  return results;
}

/**
 * Check 11b: first-person observation pattern.
 * Returns a deduplicated (case-insensitive) array of matched substrings,
 * preserving the original casing of the first occurrence.
 */
export function findFirstPersonObservation(text: string): string[] {
  const re = /\b(I see|I noticed|I caught|I'm guessing|I imagine|I am guessing|I am imagining|I could imagine)\b/gi;
  const results: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const matched = m[0];
    const key = matched.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      results.push(matched);
    }
  }
  return results;
}

/**
 * Check 11c: vague-fact rejection.
 * Returns true if `fact` is a vague seasonal pattern of the form
 * "{season|holiday|q1..q4} {sale|launch|promotion|drop|collection}"
 * with no proper noun, date, or extra qualifier.
 *
 * Strict-by-design — Task 18 will measure false-positive rate and
 * tune if >5%.
 */
export function findVagueFact(fact: string): boolean {
  if (!fact) return false;
  const trimmed = fact.trim();
  if (!trimmed) return false;
  return /^(spring|summer|fall|winter|holiday|q[1-4])\s+(sale|launch|promotion|drop|collection)$/i.test(
    trimmed
  );
}
