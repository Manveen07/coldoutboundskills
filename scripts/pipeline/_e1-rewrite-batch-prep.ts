#!/usr/bin/env tsx
// Prep batch prompt files for E1 rewrites across all 300 leads.
// Reads emails/*.json, splits into batches of 10, writes prompt files.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

const root = process.cwd();
const emailsDir = resolve(root, 'data/runs/showcase-2026-05-28/emails');
const outDir = resolve(root, 'data/runs/showcase-2026-05-28/e1-rewrite-prompts-v2');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

interface Lead {
  file: string;
  index: number;
  client: string;
  vertical: string;
  lead: string;
  domain: string;
  title: string;
  first_name: string;
  dossier: string;
}

function extractFirstName(leadStr: string): string {
  const before = leadStr.split('/')[0].trim();
  return before.split(' ')[0].toLowerCase();
}

const all: Lead[] = [];
const files = readdirSync(emailsDir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
for (const f of files) {
  try {
    const j = JSON.parse(readFileSync(join(emailsDir, f), 'utf8'));
    const arr = Array.isArray(j) ? j : [j];
    for (let i = 0; i < arr.length; i++) {
      const it = arr[i];
      if (!it.email1?.body || !it.lead) continue;
      all.push({
        file: f,
        index: i,
        client: it.client || '',
        vertical: it.vertical || '',
        lead: it.lead || '',
        domain: it.domain || '',
        title: it.title || '',
        first_name: extractFirstName(it.lead),
        dossier: it.dossier_summary || '',
      });
    }
  } catch {}
}

console.log(`loaded ${all.length} leads`);

// Group by client for context. Batches of 10. Keep verticals mixed within batch OK.
const BATCH_SIZE = 10;
const batches: Lead[][] = [];
for (let i = 0; i < all.length; i += BATCH_SIZE) batches.push(all.slice(i, i + BATCH_SIZE));

const HEADER_MYTHIC = `Mythic = Charlotte brand+performance agency. Free Growth Codes audit by Scott Luther. Anchors: Spectrum, MetLife, Ally, Subway, Meineke, Cone Health, Harley-Davidson, UnitedHealthcare.`;
const HEADER_BW = `Belardi Wong = premium DTC direct mail/catalog agency. 25 yrs, 300+ brands. Anchors: Serena & Lily, DWR, Schoolhouse, Crate & Barrel, Peacock Alley, Bombas, STAUD, Reformation, Vera Bradley, Anthropologie. AG, Paige (denim). Stats: 103% LTV mail-acquired vs digital, 3-8x ROAS, 20-30% productivity year one. DWR specific: 20%+ productivity year one.`;

function buildPrompt(leads: Lead[]): string {
  const leadBlock = leads.map((l, i) => `LEAD ${i+1}
File: ${l.file} | Index: ${l.index}
Lead: ${l.lead}
Client: ${l.client} | Vertical: ${l.vertical}
Title: ${l.title}
Domain: ${l.domain}
First name: ${l.first_name}
DOSSIER (use ONLY these facts): ${l.dossier}
`).join('\n');

  return `Rewrite ${leads.length} Email 1 cold emails. DO NOT use WebSearch.

GOAL: peer-to-peer, senior strategist note. NOT sales copy. Short, crisp. Reader thinks "this person knows my business."

HARD BAR per email:
- 60-90 words total
- 3 paragraphs separated by \\n\\n (4 only if natural)
- Lowercase opener: "{firstname}," or "hi {firstname},"
- ONE specific signal hook from DOSSIER
- ONE sentence of insight/implication
- ONE soft offer line (service angle + ONE proof — verified anchor brand OR anonymous stat, never both)
- One question they'd want to answer (specific, 1-line answerable)

NO-INVENTED-FACTS RULE (CRITICAL):
- Use ONLY facts present in the dossier
- DO NOT introduce dates, durations ("five years post-merger"), locations, headcounts, revenue numbers, or specifics not in dossier
- DO NOT add geographic hooks (Charlotte HQ, NC HQ, etc) unless explicitly in dossier
- Implications/inferences are fine; new factual claims are not
- If dossier is thin (1-2 facts), email gets shorter — do NOT pad with invented detail

CAPITALIZATION POLICY:
- Lowercase first-name opener: "debbie," or "hi debbie,"
- Sentences start with capital letters (normal English)
- Proper nouns Capitalized (Stitch Fix, Q2, Mythic, Belardi Wong, DWR, MetLife)
- Numbers stay normal ($530B+, 9.4%, 2026)

VOICE RULES:
- Peer-to-peer
- Drop sales phrases: "the tricky part", "real inflection", "the harder marketing problem", "the question is whether", "the clearest signal"
- Max 1 unsure-tone marker ("curious if", "wondering if") per email
- No em dashes, no exclamations
- No congrats / congratulations
- No "leverage", "synergy", "ROI", "pipeline", "I noticed", "I came across", "hope this finds"

READ-ALOUD RULE (CRITICAL):
Every sentence must pass spoken aloud as a peer-to-peer note. Before finalizing each line, read it out loud once. If it sounds like a press release, a marketing deck, or industry shorthand, rewrite it in plain English.
- Max sentence length 22 words. Split long sentences.
- No industry acronyms in body (LTO, NA, AOR, QSR, CPG, RTO, LTV, AOV, DTC, B2B, B2C). Spell it out or describe it.
- No deck-speak: BAN "playbook", "lane", "umbrella story", "brand architecture", "marketing math", "category entry point", "service-line motion", "go-to-market motion", "share of voice" (use "share of attention" if needed), "demand work" (use "performance work").
- No abstract nouns where a verb works: "is a strong signal that X can run a playbook" -> "shows X is doing Y".
- Drop modifier crutches: "is a real", "is a meaningful", "is a smart way to", "is a clean", "is a strong signal". Say the thing directly.
- Replace state abbreviations with full state names in body (AL -> Alabama, MD -> Maryland).
- Contractions OK in casual register; only use "you are" / "do not" if it reads more naturally than "you're" / "don't" in that line.

PROOF-LINE PRIORITY RULE (CRITICAL):
Anchor is the strongest proof when it fits the lead's category cleanly. Mismatched anchor breaks trust. Use this order:

1. CLEAN same-category anchor FIRST (best): "Mythic works with chain restaurants like Subway and Meineke on the same multi-unit brand pressure." Use ONE anchor from the map below, only if same category.
2. Adjacent-category description SECOND (when no clean anchor match exists in map): "Mythic works with multi-unit consumer brands in crowded categories where new menu drops alone don't shift share." No name-drop.
3. Stat-only THIRD (when even category description feels generic): "Mythic clients in this space typically see X" or BW stat "103% LTV mail vs digital."

Hard rule: NEVER name-drop a category-mismatched anchor (no Cone Health in a restaurant email, no Harley in healthcare). Drop the anchor before forcing a wrong one.

ANCHOR-CATEGORY MATCH MAP:
- Mythic restaurant/QSR/food_bev lead -> Subway, Meineke (franchise multi-unit consumer)
- Mythic healthcare lead -> Cone Health, UnitedHealthcare
- Mythic financial lead -> MetLife, Ally
- Mythic hospitality lead -> Harley-Davidson, Subway
- Mythic retail lead -> Subway, Harley-Davidson
- BW home/furniture -> Serena & Lily, DWR, Crate & Barrel, McGee & Co, Schoolhouse
- BW apparel/lifestyle -> Anthropologie, Reformation, STAUD, Vera Bradley
- BW denim -> AG, Paige
- BW beauty -> Bombas (lifestyle DTC analogue), Reformation (premium DTC)
- BW footwear/athletic -> Bombas, Title Nine
- BW food_bev -> stat-only ("3-8x ROAS on mail" / "103% LTV mail vs digital"), no anchor

Hard rule: NEVER mix categories (no Cone Health in a restaurant email, no Harley in healthcare). If lead vertical has no clean anchor match in the map, USE STAT-ONLY proof.

SIGNAL PRIORITY (when fetching the dossier hook):
1. Person-level signals FIRST: new role / promotion / lead's own post or quote (rarer, more flattering when present)
2. THEN company-level: acquisition / funding / product launch / press
3. Falls back to company snippet if no signal in either tier
Use the highest-priority signal that exists. Person-signal beats company-signal when both are available.

STAT-DECORATION RULE:
Numbers go in body ONLY when the number IS the proof (e.g., "103% LTV mail vs digital" is the proof line).
Do NOT pepper body with decoration stats like "$5B+ in revenue" or "20-30% productivity year one" unless the number is the load-bearing claim of the sentence. Read aloud: would a peer say this number? If no, drop it.

REFERENCE STANDARDS (target this quality):

Jordan's example:
"robert,\\n\\nDropping Furniture from the logo and moving to WE GET YOU is a real bet on Jordan's becoming an experiential brand first, retailer second. The omnichannel translation is the hard part, since the IMAX moment doesn't ship in a box.\\n\\nBelardi Wong runs catalog and direct mail for premium home brands like DWR and Crate & Barrel. DWR saw 20%+ productivity year one.\\n\\nIs the rebrand changing how you think about offline acquisition channels?"

RCA example:
"maureen,\\n\\nThe Restore Pathway launch at Devon is interesting because primary mental health is a fundamentally different referral motion than SUD. The clinical credibility translates, but the family decision-maker and the urgency cycle don't.\\n\\nMythic ran brand and demand work for Cone Health through a similar service-line expansion. Scott Luther leads a free Growth Codes audit if useful.\\n\\nAre you treating Restore as a new brand entry or extending the RCA equity into the category?"

Aim for THAT level of product-specific insight.

CLIENT CONTEXT:
${HEADER_MYTHIC}
${HEADER_BW}

${leadBlock}

OUTPUT strict JSON array of ${leads.length} objects: {file, index, lead, domain, client, vertical, email1_subject, email1_body, word_count, facts_used: ["specific phrases from dossier you used"]}

Each facts_used entry MUST be traceable to the dossier. If you invented any fact, rewrite without it.`;
}

for (let i = 0; i < batches.length; i++) {
  const path = join(outDir, `batch-${String(i+1).padStart(2, '0')}.txt`);
  writeFileSync(path, buildPrompt(batches[i]), 'utf8');
}

console.log(`wrote ${batches.length} batch prompts to ${outDir}`);
console.log(`avg ${BATCH_SIZE} leads per batch, total ${all.length} leads`);
