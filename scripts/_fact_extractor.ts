export interface ExtractedFact {
  fact: string;
  fact_date?: string;
  freshness_days?: number;
  source_query?: string;
}

const FUNDING_PATTERNS = /\b(series [a-d]|seed|raised|funding round|secures|investment|million in funding|\$[\d.]+m|\$[\d.]+ million)\b/i;
const PRESS_PATTERNS = /\b(announces|announced|press release|opening|launches|debuts|partnership|expands|expansion|opens|new location|new restaurant|new market|new cmo|new vp|hires|appointed|names)\b/i;
const LAUNCH_PATTERNS = /\b(launches|launched|debuts|debut|introduces|new collection|new line|new product)\b/i;
const ACQUISITION_PATTERNS = /\b(acquires|acquired|acquisition|to acquire|buys|bought)\b/i;

const NEGATION_PATTERNS = [
  /\bhas not raised\b/i,
  /\bnot raised any\b/i,
  /\bno funding rounds?\b/i,
  /\bhas not received any funding\b/i,
  /\bno disclosed funding\b/i,
  /\bhasn't raised\b/i,
];

const PRONOUN_RESIDUE = /^(its |their |the company |the brand |they )/i;

/**
 * Applies 3 post-extraction cleaning rules to a raw snippet/title string.
 * Rule 1: First-sentence truncation.
 * Rule 2: Pronoun-residue rejection (returns null).
 * Rule 3: Ellipsis strip.
 */
function cleanFact(raw: string): string | null {
  // Rule 1: extract first sentence only
  const m = raw.match(/^(.+?[.!?])(?:\s|$)/);
  const sentence = m ? m[1] : raw;

  // Rule 2: reject pronoun-led sentences
  if (PRONOUN_RESIDUE.test(sentence)) return null;

  // Rule 3: strip trailing ellipsis (2+ dots, or unicode ellipsis char), preserve single period
  return sentence.replace(/…$|\.{2,}$/, '').trim();
}

function freshnessDaysFromIso(iso: string): number {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 999;
  const ms = Date.now() - d.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function extractFundingFact(raw: any, company: string): ExtractedFact | null {
  const orgs = raw?.organic ?? [];
  for (const item of orgs) {
    const text = `${item.title || ''} ${item.snippet || ''}`;
    if (FUNDING_PATTERNS.test(text)) {
      if (NEGATION_PATTERNS.some((p) => p.test(text))) continue;
      if (!isFromTrustedDomain(item, TRUSTED_FUNDING_DOMAINS)) continue;
      const raw_fact = item.snippet?.trim() || item.title?.trim() || '';
      const fact = cleanFact(raw_fact);
      if (fact === null) continue;
      return {
        fact,
        fact_date: item.date,
        freshness_days: item.date ? freshnessDaysFromIso(item.date) : undefined,
      };
    }
  }
  return null;
}

export function extractPressFact(raw: any, company: string): ExtractedFact | null {
  const orgs = raw?.organic ?? [];
  for (const item of orgs) {
    const text = `${item.title || ''} ${item.snippet || ''}`;
    if (PRESS_PATTERNS.test(text)) {
      if (!isFromTrustedDomain(item, TRUSTED_PRESS_DOMAINS)) continue;
      const raw_fact = item.snippet?.trim() || item.title?.trim() || '';
      const fact = cleanFact(raw_fact);
      if (fact === null) continue;
      return {
        fact,
        fact_date: item.date,
        freshness_days: item.date ? freshnessDaysFromIso(item.date) : undefined,
      };
    }
  }
  return null;
}

export function extractLaunchFact(raw: any, company: string): ExtractedFact | null {
  const orgs = raw?.organic ?? [];
  for (const item of orgs) {
    const text = `${item.title || ''} ${item.snippet || ''}`;
    if (LAUNCH_PATTERNS.test(text)) {
      const raw_fact = item.snippet?.trim() || item.title?.trim() || '';
      const fact = cleanFact(raw_fact);
      if (fact === null) continue;
      return {
        fact,
        fact_date: item.date,
        freshness_days: item.date ? freshnessDaysFromIso(item.date) : undefined,
      };
    }
  }
  return null;
}

export function extractAcquisitionFact(raw: any, company: string): ExtractedFact | null {
  const orgs = raw?.organic ?? [];
  for (const item of orgs) {
    const text = `${item.title || ''} ${item.snippet || ''}`;
    if (ACQUISITION_PATTERNS.test(text)) {
      const raw_fact = item.snippet?.trim() || item.title?.trim() || '';
      const fact = cleanFact(raw_fact);
      if (fact === null) continue;
      return {
        fact,
        fact_date: item.date,
        freshness_days: item.date ? freshnessDaysFromIso(item.date) : undefined,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Trusted source allowlist — funding and press facts must come from these domains.
// Snippet facts (S1 queries) are exempt — they pull from any source.
// Add domains here to trust a new publisher for funding/press signals.
// ---------------------------------------------------------------------------
const TRUSTED_FUNDING_DOMAINS = new Set([
  'techcrunch.com', 'crunchbase.com', 'businesswire.com', 'prnewswire.com',
  'globenewswire.com', 'sec.gov', 'wsj.com', 'bloomberg.com', 'reuters.com',
  'axios.com', 'forbes.com', 'fortune.com', 'ft.com', 'cnbc.com',
  'venturebeat.com', 'pymnts.com', 'restaurantbusinessonline.com',
  'qsrmagazine.com', 'nrn.com', 'foodandwine.com',
  'pitchbook.com', 'bizjournals.com', 'inc.com', 'fastcompany.com',
  'franchisetimes.com', 'restaurantdive.com', 'fooddive.com',
  'yahoo.com', 'msn.com', 'apnews.com', 'nytimes.com', 'washingtonpost.com',
  'usatoday.com', 'nationsprestaurantnews.com', 'foodbev.com',
]);

const TRUSTED_PRESS_DOMAINS = new Set([
  ...TRUSTED_FUNDING_DOMAINS,
  'prnewswire.com', 'businesswire.com', 'globenewswire.com',
  'marketwatch.com', 'adweek.com', 'mediapost.com', 'marketingweek.com',
  'restaurantbusinessonline.com', 'qsrmagazine.com', 'nrn.com',
  'foodandwine.com', 'eater.com', 'nation.com',
  'restaurantdive.com', 'fooddive.com', 'franchisetimes.com',
  'bizjournals.com', 'inc.com', 'fastcompany.com', 'pitchbook.com',
  'yahoo.com', 'msn.com', 'apnews.com', 'nytimes.com', 'washingtonpost.com',
  'usatoday.com', 'nationsnrestaurantnews.com',
]);

function domainFromLink(link: string | undefined): string {
  if (!link) return '';
  try { return new URL(link).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function isFromTrustedDomain(item: any, allowlist: Set<string>): boolean {
  const domain = domainFromLink(item.link);
  if (!domain) return false; // no link = skip (can't verify source)
  // Also accept subdomains: finance.yahoo.com matches yahoo.com
  if (allowlist.has(domain)) return true;
  const parts = domain.split('.');
  if (parts.length > 2) {
    const apex = parts.slice(-2).join('.');
    if (allowlist.has(apex)) return true;
  }
  return false;
}

const SNIPPET_STOPWORD_STARTS = [
  /^perfect fit\b/i,
  /^explore\s/i,
  /^©/,
  /^shop\s/i,
  /^buy\s/i,
  /^free shipping\b/i,
  /^free returns\b/i,
  /^discover\s/i,
  /^operates in the\b/i,
  /^the latest\b/i,
  /^view our\b/i,
];
const SNIPPET_COPYRIGHT_ONLY = /^©.*\d{4}/;

export function extractSnippetFact(raw: any, company: string): ExtractedFact | null {
  const orgs = raw?.organic ?? [];
  if (orgs.length === 0) return null;
  const first = orgs[0];
  const snippet = (first.snippet?.trim() || first.title?.trim() || '');
  if (!snippet) return null;
  if (SNIPPET_COPYRIGHT_ONLY.test(snippet)) return null;
  if (SNIPPET_STOPWORD_STARTS.some((p) => p.test(snippet))) return null;
  const fact = cleanFact(snippet);
  if (fact === null) return null;
  return { fact };
}
