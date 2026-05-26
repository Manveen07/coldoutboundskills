export interface ExtractedFact {
  fact: string;
  fact_date?: string;
  freshness_days?: number;
  source_query?: string;
}

const FUNDING_PATTERNS = /\b(series [a-d]|seed|raised|funding round|secures|investment|million in funding|\$[\d.]+m|\$[\d.]+ million)\b/i;
const PRESS_PATTERNS = /\b(announces|announced|press release|opening|launches|debuts|partnership)\b/i;
const LAUNCH_PATTERNS = /\b(launches|launched|debuts|debut|introduces|new collection|new line|new product)\b/i;
const ACQUISITION_PATTERNS = /\b(acquires|acquired|acquisition|to acquire|buys|bought)\b/i;

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
      return {
        fact: item.snippet?.trim() || item.title?.trim() || '',
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
      return {
        fact: item.snippet?.trim() || item.title?.trim() || '',
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
      return {
        fact: item.snippet?.trim() || item.title?.trim() || '',
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
      return {
        fact: item.snippet?.trim() || item.title?.trim() || '',
        fact_date: item.date,
        freshness_days: item.date ? freshnessDaysFromIso(item.date) : undefined,
      };
    }
  }
  return null;
}

export function extractSnippetFact(raw: any, company: string): ExtractedFact | null {
  const orgs = raw?.organic ?? [];
  if (orgs.length === 0) return null;
  const first = orgs[0];
  return { fact: first.snippet?.trim() || first.title?.trim() || '' };
}
