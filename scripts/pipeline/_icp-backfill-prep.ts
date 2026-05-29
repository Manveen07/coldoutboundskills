#!/usr/bin/env tsx
// Build ICP scoring batch prompts for unscored leads.
// Each lead in the prompt carries dossier_summary + e1 subject + facts_used so
// the sub-agent can produce reasoning that ties to the email's actual angle.
// Writes prompts to data/runs/showcase-2026-05-28/icp-backfill-prompts/batch-NN.txt

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { resolve, join } from 'path';

const root = process.cwd();
const emailsDir = resolve(root,'data/runs/showcase-2026-05-28/emails');
const scoringDirs = [
  resolve(root,'data/runs/showcase-2026-05-28/scoring'),
  resolve(root,'data/runs/showcase-2026-05-28/scoring-p2'),
];
const promptsDir = resolve(root,'data/runs/showcase-2026-05-28/icp-backfill-prompts');
if (!existsSync(promptsDir)) mkdirSync(promptsDir,{recursive:true});

const bwIcp = readFileSync(resolve(root,'profiles/belardi-wong/icp-prompt-allverticals.txt'),'utf8');
const mythicIcp = readFileSync(resolve(root,'profiles/mythic/icp-prompt.txt'),'utf8');

const norm = (d:string) => d.toLowerCase().replace(/^www\./,'').trim();

const scored = new Set<string>();
for (const dir of scoringDirs) {
  for (const f of readdirSync(dir)) {
    const j = JSON.parse(readFileSync(join(dir,f),'utf8'));
    for (const r of (Array.isArray(j)?j:[j])) if (r.domain) scored.add(norm(r.domain));
  }
}

interface Lead {
  lead: string;
  domain: string;
  title: string;
  client: string;
  vertical: string;
  dossier: string;
  e1_subject: string;
  facts: string[];
}

const bwLeads: Lead[] = [];
const mythicLeads: Lead[] = [];
for (const f of readdirSync(emailsDir).filter(x=>x.endsWith('.json'))) {
  const j = JSON.parse(readFileSync(join(emailsDir,f),'utf8'));
  for (const l of (Array.isArray(j)?j:[j])) {
    if (!l.domain || scored.has(norm(l.domain))) continue;
    const lead: Lead = {
      lead: l.lead || '',
      domain: norm(l.domain),
      title: l.title || '',
      client: l.client,
      vertical: l.vertical,
      dossier: (l.dossier_summary || '').slice(0, 600),
      e1_subject: l.email1?.subject || '',
      facts: l.e1_facts_used || [],
    };
    if (l.client === 'belardi-wong') bwLeads.push(lead);
    else if (l.client === 'mythic') mythicLeads.push(lead);
  }
}

console.log(`bw unscored: ${bwLeads.length}, mythic unscored: ${mythicLeads.length}`);

// Clear old batches first
for (const f of readdirSync(promptsDir).filter(x=>x.endsWith('.txt'))) {
  unlinkSync(join(promptsDir, f));
}

const BATCH = 20;
function buildPrompts(leads: Lead[], icp: string, clientLabel: string, startBatch: number): number {
  let batchN = startBatch;
  for (let i=0; i<leads.length; i+=BATCH) {
    const slice = leads.slice(i, i+BATCH);
    const leadBlock = slice.map((l,k) => {
      const factLine = l.facts.length ? `\n   facts used in email: ${l.facts.join(' | ')}` : '';
      return `### Lead ${k+1}
   name: ${l.lead}
   domain: ${l.domain}
   title: ${l.title}
   vertical: ${l.vertical}
   email1 subject: ${l.e1_subject}
   dossier: ${l.dossier}${factLine}`;
    }).join('\n\n');

    const prompt = `# ICP Scoring + Relevance Task — ${clientLabel} batch ${batchN}

You are evaluating ${slice.length} leads against the ${clientLabel} ICP. For EACH lead produce a score AND a short relevance rationale that ties the lead's specific dossier facts to why this company is a fit for ${clientLabel} right now. The rationale must read like a one-paragraph case for putting this lead in the campaign so a reader looking at the CSV alongside the email can understand the connection.

## ICP Definition

${icp}

## Leads to Score

${leadBlock}

## Output

Return ONE JSON array (no preamble, no markdown fence). Each element MUST follow this shape exactly:

{
  "domain": "<domain>",
  "full_name": "<lead name>",
  "icp_qualified": true | false,
  "icp_confidence": 0.0-1.0,
  "icp_reason": "<one short sentence: the core ICP yes/no decision under 25 words>",
  "relevance_summary": "<2-3 sentence explanation of WHY this specific company is relevant right now — must cite the dossier signal that the email picks up on (e.g., the launch, the funding, the new hire, the rebrand). Should make clear how ${clientLabel}'s service maps to the moment.>"
}

Hard rules:
- relevance_summary MUST mention at least one specific fact from the lead's dossier (the launch, store opening, hire, fundraise, rebrand, anniversary, partnership, etc.).
- relevance_summary MUST connect that fact to ${clientLabel}'s service (catalog/direct mail for BW; brand+performance audit for Mythic).
- If the lead is NOT a fit, relevance_summary explains specifically why the dossier signal does not map to a service moment.
- Use icp_confidence to express data quality: < 0.6 means thin dossier or borderline call.

Return the JSON array only.
`;
    writeFileSync(join(promptsDir, `batch-${String(batchN).padStart(2,'0')}.txt`), prompt, 'utf8');
    batchN++;
  }
  return batchN;
}

const next = buildPrompts(bwLeads, bwIcp, 'belardi-wong', 1);
buildPrompts(mythicLeads, mythicIcp, 'mythic', next);

console.log(`wrote prompts to ${promptsDir}`);
console.log(`total batches: ${readdirSync(promptsDir).length}`);
