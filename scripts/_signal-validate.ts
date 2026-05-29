// Test signal extraction on 5 leads only -- ~15-40 Serper credits max
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { parseCsv, writeCsv } from './_csv_io';
import { readSidecar, writeSidecar, type SignalSidecar } from './_lib_signals';
import { computeTier } from './_lib_tier';
import { getMythicQueriesForTier } from './_query_templates';
import { serperSearch } from './_serper_client';
import { extractFundingFact, extractPressFact, extractSnippetFact } from './_fact_extractor';

function loadEnv(): Record<string, string> {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    const out: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const [k, ...v] = t.split('=');
      out[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
    }
    return out;
  } catch { return {}; }
}

const env = loadEnv();
const SERPER_KEY = env.SERPER_API_KEY;
const signalsDir = 'profiles/mythic/campaigns/growth-codes/data/signals-qsr-test';
if (!existsSync(signalsDir)) mkdirSync(signalsDir, { recursive: true });

const { rows } = parseCsv(readFileSync('profiles/mythic/campaigns/growth-codes/data/leads-scored-qsr.csv', 'utf8'));
const testLeads = rows.slice(0, 5);
let credits = 0;

for (const lead of testLeads) {
  const domain = (lead.company_domain ?? '').toLowerCase().replace(/^www\./, '');
  const tier = computeTier({ qual_confidence: parseFloat(lead.icp_confidence || '0.7'), title: lead.current_job_title });
  const queries = getMythicQueriesForTier(tier, { company: lead.company_name, domain });

  const sidecar: SignalSidecar = {
    schema_version: '1.0', domain, fetched_at: new Date().toISOString(),
    company_snippet: { fact: null, source_query: null, raw_serper_response: null },
    funding: { fact: null, found: false }, press: [], product_launch: { fact: null, found: false },
    acquisition: { fact: null, found: false }, available_signals: [], fetch_log: [],
  };

  for (const q of queries.serper) {
    const res = await serperSearch(q.query, SERPER_KEY, 'signal-validate');
    credits++;
    const raw = res.raw;
    if (q.signal_type === 'funding') {
      const fact = extractFundingFact(raw, lead.company_name);
      if (fact) { sidecar.funding = { fact, found: true }; if (!sidecar.available_signals.includes('funding')) sidecar.available_signals.push('funding'); }
    } else if (q.signal_type === 'press') {
      const fact = extractPressFact(raw, lead.company_name);
      if (fact) { sidecar.press.push({ fact, found: true } as any); if (!sidecar.available_signals.includes('press')) sidecar.available_signals.push('press'); }
    } else if (q.signal_type === 'snippet') {
      const fact = extractSnippetFact(raw, lead.company_name);
      if (fact) { sidecar.company_snippet = { fact, source_query: q.query, raw_serper_response: raw }; if (!sidecar.available_signals.includes('company_snippet')) sidecar.available_signals.push('company_snippet'); }
    }
    await new Promise(r => setTimeout(r, 200));
  }

  writeSidecar(domain, sidecar, signalsDir);
  console.log(`${lead.company_name} (${domain}, ${tier}): signals=${sidecar.available_signals.join(', ') || 'fallback'}`);
  if (sidecar.funding.fact) console.log('  Funding:', sidecar.funding.fact);
  if (sidecar.press[0]?.fact) console.log('  Press:', sidecar.press[0].fact);
  if (sidecar.company_snippet?.fact) console.log('  Snippet:', sidecar.company_snippet.fact);
}

console.log(`\nTotal Serper credits used: ${credits}`);
