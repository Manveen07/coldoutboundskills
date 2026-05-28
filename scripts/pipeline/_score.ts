import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { Lead } from './_pull';
import { runSubagentBatch, type SubagentDispatcher } from './_subagent_runner';
import { fetchWithCache, readCache, writeCache, hashKey } from './_cache';

export interface Score {
  company: string;
  domain: string;
  qualified: boolean;
  confidence: number;
  reason: string;
}

export interface ScoredLead extends Lead {
  icp_qualified: string;
  icp_confidence: string;
  icp_reason: string;
}

export function buildScoringPrompt(icpPrompt: string, leads: Lead[]): string {
  const leadJson = leads.map((l, i) =>
    `${i + 1}. {"name":"${l.full_name}","title":"${l.current_job_title}","company":"${l.company_name}","domain":"${l.company_domain}","industry":"${l.company_industry}","headcount":"${l.company_headcount_range}"}`
  ).join('\n');

  return `${icpPrompt}

## Companies to evaluate

${leadJson}

## Output
Return ONLY a JSON array of ${leads.length} objects in the same order:
{"company": "", "domain": "", "qualified": true/false, "confidence": 0.0-1.0, "reason": "one sentence"}`;
}

export function applyScoresToLeads(leads: Lead[], scores: Score[]): ScoredLead[] {
  const map = new Map<string, Score>();
  for (const s of scores) {
    const d = (s.domain ?? '').toLowerCase().replace(/^www\./, '');
    if (d) map.set(d, s);
  }
  return leads.map(lead => {
    const d = (lead.company_domain ?? '').toLowerCase().replace(/^www\./, '');
    const s = map.get(d);
    if (!s) return { ...lead, icp_qualified: 'unknown', icp_confidence: '0', icp_reason: 'not scored' };
    return {
      ...lead,
      icp_qualified: String(s.qualified),
      icp_confidence: String(s.confidence),
      icp_reason: s.reason,
    };
  });
}

export interface ScoreOptions {
  leads: Lead[];
  client: string;
  icpPromptPath: string;
  dispatch: SubagentDispatcher;
  batchSize?: number;
  cacheDir?: string;
}

function safeKey(s: string): string {
  return s.replace(/[^a-z0-9-]/gi, '_');
}

export async function scoreLeads(opts: ScoreOptions): Promise<ScoredLead[]> {
  const icpPromptPath = resolve(process.cwd(), opts.icpPromptPath);
  if (!existsSync(icpPromptPath)) throw new Error(`ICP prompt not found: ${icpPromptPath}`);
  const icpPrompt = readFileSync(icpPromptPath, 'utf8');
  const promptHash = hashKey(icpPrompt);
  const cacheDir = opts.cacheDir ?? resolve(process.cwd(), `data/research-cache/score/${safeKey(opts.client)}`);
  const batchSize = opts.batchSize ?? 10;

  // Dedup by domain so each domain scored once
  const uniqueLeads: Lead[] = [];
  const seenDomains = new Set<string>();
  for (const l of opts.leads) {
    const d = (l.company_domain ?? '').toLowerCase().replace(/^www\./, '');
    if (!d || seenDomains.has(d)) continue;
    seenDomains.add(d);
    uniqueLeads.push(l);
  }

  // Check cache per domain
  const allScores: Score[] = [];
  const toScore: Lead[] = [];
  for (const lead of uniqueLeads) {
    const cacheKey = hashKey(opts.client, lead.company_domain, promptHash);
    const cached = readCache<Score>(cacheDir, cacheKey);
    if (cached) {
      allScores.push(cached);
    } else {
      toScore.push(lead);
    }
  }

  // Batch the not-yet-scored leads and dispatch sub-agent
  for (let i = 0; i < toScore.length; i += batchSize) {
    const batch = toScore.slice(i, i + batchSize);
    const prompt = buildScoringPrompt(icpPrompt, batch);
    const results = await runSubagentBatch<Score[]>([prompt], opts.dispatch, { batchSize: 1, maxRetries: 3 });
    const batchScores = results[0].data ?? [];
    for (let j = 0; j < batchScores.length; j++) {
      const lead = batch[j];
      const score = batchScores[j];
      if (!score) continue;
      allScores.push(score);
      const cacheKey = hashKey(opts.client, lead.company_domain, promptHash);
      writeCache(cacheDir, cacheKey, score);
    }
  }

  return applyScoresToLeads(opts.leads, allScores);
}
