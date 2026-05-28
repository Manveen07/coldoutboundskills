import { fetchWithCache, hashKey } from './_cache';
import { resolve } from 'path';

export interface ScrapeResult {
  recent_initiative: string | null;
  tech_signals: string[];
  social_proof: string[];
  tone_observations: string;
}

const TECH_PATTERNS: Record<string, RegExp> = {
  'Klaviyo':        /klaviyo\.com/i,
  'Attentive':      /attentive\.com/i,
  'Triple Whale':   /triplewhale/i,
  'Northbeam':      /northbeam/i,
  'Rockerbox':      /rockerbox/i,
  'Google Ads':     /googleadservices|gtag\/js/i,
  'Meta Pixel':     /facebook\.net\/.*\/fbevents/i,
  'Google Analytics 4': /google-analytics\.com\/g\/collect|gtag\(.*GA-/i,
  'Brandwatch':     /brandwatch\.com/i,
  'Shopify':        /cdn\.shopify\.com/i,
  'Salesforce':     /salesforce\.com|exacttarget/i,
};

export function detectTechSignals(html: string): string[] {
  const found: string[] = [];
  for (const [name, pattern] of Object.entries(TECH_PATTERNS)) {
    if (pattern.test(html)) found.push(name);
  }
  return found;
}

const INITIATIVE_PATTERNS = [
  /<h1[^>]*>([^<]{10,120}(?:campaign|collection|launch|introducing|debut)[^<]{0,80})<\/h1>/i,
  /<h2[^>]*>([^<]{10,120}(?:campaign|collection|launch|introducing|debut)[^<]{0,80})<\/h2>/i,
  /(?:new|introducing|launching)\s+(?:202[4-9])[\s\S]{0,80}?(?:collection|campaign|line|product|menu)/i,
];

export function extractRecentInitiative(html: string): string | null {
  for (const p of INITIATIVE_PATTERNS) {
    const m = html.match(p);
    if (m) return (m[1] ?? m[0]).replace(/\s+/g, ' ').trim();
  }
  return null;
}

const SOCIAL_PROOF_PATTERNS = [
  /(\d{2,}\+?\s+(?:brands|customers|clients|stores|locations|years))/gi,
  /(?:trusted by|featured in|named\s+(?:by|in))\s+([^.,<>]{5,80})/gi,
];

export function extractSocialProof(html: string): string[] {
  const found: string[] = [];
  for (const p of SOCIAL_PROOF_PATTERNS) {
    const matches = html.matchAll(p);
    for (const m of matches) {
      const proof = (m[1] ?? m[0]).replace(/\s+/g, ' ').trim();
      if (proof.length < 120 && !found.includes(proof)) found.push(proof);
    }
  }
  return found.slice(0, 5);
}

export async function scrapeCompany(domain: string, cacheDir?: string): Promise<ScrapeResult> {
  const dir = cacheDir ?? resolve(process.cwd(), 'data/research-cache/scrape');
  const cacheKey = hashKey(domain);

  const result = await fetchWithCache(dir, cacheKey, 30, async () => {
    const baseUrl = `https://${domain.replace(/^www\./, '')}`;
    const pages = ['', '/about', '/team'];
    const combined: string[] = [];
    for (const path of pages) {
      try {
        const res = await fetch(baseUrl + path, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ColdEmailResearch/1.0)' },
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) combined.push(await res.text());
      } catch {
        // Skip failed page fetches silently
      }
    }
    const html = combined.join('\n');
    return {
      recent_initiative: extractRecentInitiative(html),
      tech_signals: detectTechSignals(html),
      social_proof: extractSocialProof(html),
      tone_observations: combined.length > 0 ? 'fetched' : 'fetch_failed',
    } as ScrapeResult;
  });

  return result.raw;
}
