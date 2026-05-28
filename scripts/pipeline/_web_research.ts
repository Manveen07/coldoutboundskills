// ---------------------------------------------------------------------------
// _web_research.ts -- Free web research via Claude Code sub-agent
//
// Run BEFORE Serper. Sub-agent uses WebFetch/WebSearch (free) to surface as
// many signals as possible, leaving Serper to fill only the gaps. Estimated
// credit savings: 40-60% of Serper calls.
//
// Output: WebResearchDossier with what was found AND a `gaps` list naming
// the signal types still missing (funding, press, etc.). Serper stage reads
// the gaps and only fires queries for those types.
// ---------------------------------------------------------------------------

import type { Lead } from './_pull';
import { runSubagentBatch, type SubagentDispatcher } from './_subagent_runner';
import { fetchWithCache, hashKey } from './_cache';
import { resolve } from 'path';

export interface WebResearchDossier {
  funding_fact: string | null;
  press_facts: string[];
  expansion_fact: string | null;
  leadership_fact: string | null;
  category_observation: string | null;
  recent_initiative: string | null;
  gaps: string[]; // signal types NOT found, e.g. ['funding', 'press']
  source_urls: string[];
}

export function buildWebResearchPrompt(lead: Lead): string {
  return `You are a research analyst. Find concrete, citable facts about this lead's company. Use WebFetch and WebSearch tools.

LEAD:
- Name: ${lead.full_name}
- Title: ${lead.current_job_title}
- Company: ${lead.company_name}
- Domain: ${lead.company_domain}
- Industry: ${lead.company_industry}

TASKS (do these in order, stop early if you have strong findings):
1. Fetch https://${lead.company_domain}/ and any obvious /about, /news, /press, /newsroom pages. Pull the most recent campaign, leadership news, or expansion announcement.
2. Web search: "${lead.company_name}" funding 2025 OR 2026 site:techcrunch.com OR site:pitchbook.com OR site:crunchbase.com
3. Web search: "${lead.company_name}" announces OR expands OR launches 2026
4. Web search: "${lead.company_name}" new CMO OR VP marketing 2026

RULES:
- Only return facts you can cite to a specific URL.
- Prefer trade press (NRN, QSR Magazine, Restaurant Dive, AdWeek) and major business press (Reuters, WSJ, Bloomberg, Forbes).
- Skip facts older than 18 months.
- Do NOT fabricate. If nothing found for a category, leave it null and add it to "gaps".

OUTPUT FORMAT (JSON only):
{
  "funding_fact": "string or null",
  "press_facts": ["array of recent press items"],
  "expansion_fact": "string or null",
  "leadership_fact": "string or null",
  "category_observation": "string or null",
  "recent_initiative": "string or null",
  "gaps": ["funding", "press", ...],
  "source_urls": ["https://..."]
}`;
}

export interface WebResearchOptions {
  lead: Lead;
  dispatch: SubagentDispatcher;
  cacheDir?: string;
  ttlDays?: number;
}

export async function webResearch(opts: WebResearchOptions): Promise<WebResearchDossier> {
  const domain = (opts.lead.company_domain ?? '').toLowerCase().replace(/^www\./, '');
  const dir = opts.cacheDir ?? resolve(process.cwd(), 'data/research-cache/web');
  const cacheKey = hashKey('web', domain);
  const ttl = opts.ttlDays ?? 30;

  const result = await fetchWithCache(dir, cacheKey, ttl, async () => {
    const prompt = buildWebResearchPrompt(opts.lead);
    const r = await runSubagentBatch<WebResearchDossier>([prompt], opts.dispatch, {
      batchSize: 1,
      maxRetries: 2,
      parseJson: true,
    });
    if (!r[0].success || !r[0].data) {
      // Return empty dossier with all gaps so Serper picks up everything
      return {
        funding_fact: null, press_facts: [], expansion_fact: null,
        leadership_fact: null, category_observation: null, recent_initiative: null,
        gaps: ['funding', 'press', 'expansion', 'leadership', 'category', 'initiative'],
        source_urls: [],
      } as WebResearchDossier;
    }
    return r[0].data;
  });

  return result.raw;
}

/**
 * Decide which Serper query types still need to fire based on web research gaps.
 * If web research found a fact for a signal type, skip that Serper query.
 */
export function gapsToSerperQueryTypes(gaps: string[]): Set<string> {
  const types = new Set<string>();
  if (gaps.includes('funding')) types.add('funding');
  if (gaps.includes('press') || gaps.includes('expansion')) types.add('press');
  if (gaps.includes('category') || gaps.includes('initiative')) types.add('snippet');
  return types;
}
