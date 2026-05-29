#!/usr/bin/env tsx
// Two-pass E1 format validator.
//
// Spec:
//   Block 1: "{first}," or "Hi {first}," + dated/specific fact + non-obvious implication
//   Block 2: tension/insight, 50% unsure tone (might/curious/maybe)
//   Block 3: solution + ONE service angle + exactly ONE proof point (verified brand+stat OR anonymous stat, never both, never two)
//   Block 4: question CTA (value-offer or thinking-prompt, not meeting ask), ends in ?
//
// Pass 1 (regex): structure, banned phrases, first-name presence, ? ending, word count,
//                 proof-string count, "congrats" flag, lowercase opener flag, "DM" misuse
// Pass 2 (LLM): implication present in para 1, service-proof pairing correct in para 3
//
// Outputs:
//   - regex-report.json (all 300, per-rule breakdown)
//   - llm-judge-input.json (subset that passed regex → goes to LLM judge)
//   - tier classification: pass | soft-fail (regex-pass but LLM flags) | hard-fail-regex | hard-fail-pairing

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

const args = process.argv.slice(2);
function arg(name: string, def?: string): string {
  const i = args.indexOf(`--${name}`);
  if (i === -1) {
    if (def !== undefined) return def;
    throw new Error(`missing --${name}`);
  }
  return args[i + 1];
}

const inDir = arg('in');
const outReport = arg('report', resolve(inDir, '../e1-regex-report.json'));
const judgeInputPath = arg('judge-input', resolve(inDir, '../e1-judge-input.json'));

interface Lead {
  file: string;
  index: number;
  client: string;
  vertical: string;
  lead: string;
  domain: string;
  first_name: string;
  signal_fact: string; // from dossier or facts
  email1_subject: string;
  email1_body: string;
}

// Anchor brand library — verified-brand proofs
const BW_PROOFS_RE = /(serena & lily|serena and lily|DWR|design within reach|schoolhouse|crate & barrel|crate and barrel|mcgee & co|peacock alley|bombas|staud|reformation|vera bradley|anthropologie|title nine|birkenstock|kuru|\bAG\b|paige)/i;
const MYTHIC_PROOFS_RE = /(spectrum|metlife|ally|subway|meineke|cone health|harley-davidson|harley|unitedhealthcare)/i;
const ANON_STAT_RE = /(103%|3-8x|3 to 8x|20-30%|20 to 30%|3 to 8 ?x roas|3-8 ?x roas|productivity lift)/i;

const BANNED = ['leverage', 'synergy', ' ROI ', 'pipeline', 'i noticed', 'i came across', 'hope this finds'];
const CONGRATS_RE = /\b(congrats|congratulations)\b/i;
const DM_MISUSE_RE = /\b(DM|direct message)\b/i; // bw context: "DM" is wrong → should be "direct mail"

interface RegexResult {
  domain: string;
  lead: string;
  vertical: string;
  client: string;
  pass: boolean;
  failures: string[];
  warnings: string[];
  block_count: number;
  word_count: number;
  proofs_found: string[];
  has_first_name: boolean;
  ends_with_question: boolean;
  has_banned: string[];
  has_congrats: boolean;
  has_dm_misuse: boolean;
  has_fact_keyword_match: boolean;
  e1_subject: string;
  e1_body_preview: string;
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function extractFirstName(leadStr: string): string {
  // "Katie Benak / OrthoNebraska" or "Carlotta Laurenti / Golden Goose"
  const before = leadStr.split('/')[0].trim();
  return before.split(' ')[0].toLowerCase();
}

function runRegex(lead: Lead): RegexResult {
  const body = lead.email1_body;
  const blocks = body.split(/\n\n+/).filter(b => b.trim().length > 0);
  const failures: string[] = [];
  const warnings: string[] = [];

  // Block count: must be 3-4
  if (blocks.length < 3) failures.push(`HARD: only ${blocks.length} blocks (need 3-4)`);
  if (blocks.length > 5) failures.push(`HARD: ${blocks.length} blocks (too many)`);

  // First name in opener
  const fn = lead.first_name;
  const openerLower = (blocks[0] || '').toLowerCase().slice(0, 50);
  const hasFirstName = openerLower.includes(fn);
  if (!hasFirstName && fn) failures.push(`HARD: first name "${fn}" not in opener`);

  // Lowercase opener (soft warning for premium audience)
  const firstChar = (blocks[0] || '').trim()[0] || '';
  if (firstChar && firstChar === firstChar.toLowerCase() && /[a-z]/.test(firstChar)) {
    warnings.push(`SOFT: lowercase opener (audience-specific policy)`);
  }

  // E1 ends with ?
  const endsQ = /\?\s*$/.test(body.trim());
  if (!endsQ) failures.push(`HARD: doesn't end with ?`);

  // Banned phrases
  const bodyLower = body.toLowerCase();
  const banned = BANNED.filter(b => bodyLower.includes(b.toLowerCase()));
  if (banned.length) failures.push(`HARD: banned phrases: ${banned.join(', ')}`);

  // Congrats
  const hasCongrats = CONGRATS_RE.test(body);
  if (hasCongrats) warnings.push(`SOFT: contains "congrats" (audience-specific policy)`);

  // DM misuse (BW context)
  const hasDmMisuse = lead.client === 'belardi-wong' && DM_MISUSE_RE.test(body);
  if (hasDmMisuse) failures.push(`HARD: contains "DM" (BW context: ambiguous, prefer "direct mail")`);

  // Word count
  const wc = countWords(body);
  if (wc > 120) warnings.push(`SOFT: ${wc} words (over 100 ideal)`);
  if (wc < 50) failures.push(`HARD: only ${wc} words (under 50)`);

  // Para 3 service+proof: count proofs
  const para3 = blocks[2] || '';
  const proofsFound: string[] = [];
  const proofsRE = lead.client === 'mythic' ? MYTHIC_PROOFS_RE : BW_PROOFS_RE;
  const verifiedMatch = para3.match(proofsRE);
  const anonMatch = para3.match(ANON_STAT_RE);
  if (verifiedMatch) proofsFound.push(`verified: ${verifiedMatch[0]}`);
  if (anonMatch) proofsFound.push(`anon: ${anonMatch[0]}`);

  // Hard fail: 0 proofs in para 3
  // Soft fail: 2+ proofs (violates "exactly ONE")
  // Note: para 3 might not exist if structure is wrong — already caught above
  if (blocks.length >= 3 && proofsFound.length === 0) {
    failures.push(`HARD: para 3 has no service angle / no proof point`);
  } else if (proofsFound.length > 1) {
    warnings.push(`SOFT: para 3 has ${proofsFound.length} proofs (spec = ONE)`);
  }

  // Fact keyword match: does opener mention something from dossier or signal_fact?
  const factKeywords = extractFactKeywords(lead.signal_fact);
  const opener = (blocks[0] || '').toLowerCase();
  const factMatch = factKeywords.some(k => opener.includes(k.toLowerCase()));

  const hardFails = failures.filter(f => f.startsWith('HARD'));
  return {
    domain: lead.domain,
    lead: lead.lead,
    vertical: lead.vertical,
    client: lead.client,
    pass: hardFails.length === 0,
    failures,
    warnings,
    block_count: blocks.length,
    word_count: wc,
    proofs_found: proofsFound,
    has_first_name: hasFirstName,
    ends_with_question: endsQ,
    has_banned: banned,
    has_congrats: hasCongrats,
    has_dm_misuse: hasDmMisuse,
    has_fact_keyword_match: factMatch,
    e1_subject: lead.email1_subject,
    e1_body_preview: body.slice(0, 200),
  };
}

function extractFactKeywords(fact: string): string[] {
  if (!fact) return [];
  // Extract: years, $ amounts, named products/programs, capitalized phrases
  const out: string[] = [];
  const yearM = fact.match(/202[5-6]/g);
  if (yearM) out.push(...yearM);
  const dollarM = fact.match(/\$[\d.,]+[MBK]?/g);
  if (dollarM) out.push(...dollarM);
  const pctM = fact.match(/\d+(?:\.\d+)?%/g);
  if (pctM) out.push(...pctM);
  // Capitalized 2+ word phrases (named products/programs)
  const capM = fact.match(/[A-Z][a-z]+(?: [A-Z][a-z]+)+/g);
  if (capM) out.push(...capM.slice(0, 5));
  return out.filter(Boolean);
}

// Main: walk all email JSONs, run regex on each E1
const results: RegexResult[] = [];
const judgeInputs: any[] = [];

const files = readdirSync(inDir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
for (const f of files) {
  try {
    const j = JSON.parse(readFileSync(join(inDir, f), 'utf8'));
    const arr = Array.isArray(j) ? j : [j];
    for (let i = 0; i < arr.length; i++) {
      const it = arr[i];
      if (!it.email1?.body) continue;
      const lead: Lead = {
        file: f,
        index: i,
        client: it.client || '',
        vertical: it.vertical || '',
        lead: it.lead || '',
        domain: it.domain || '',
        first_name: extractFirstName(it.lead || ''),
        signal_fact: it.dossier_summary || '',
        email1_subject: it.email1?.subject || '',
        email1_body: it.email1?.body || '',
      };
      const r = runRegex(lead);
      results.push(r);
      // If regex pass: queue for LLM judge
      if (r.pass) {
        judgeInputs.push({
          file: f,
          index: i,
          domain: lead.domain,
          lead: lead.lead,
          vertical: lead.vertical,
          client: lead.client,
          signal_fact: lead.signal_fact,
          email1_body: lead.email1_body,
        });
      }
    }
  } catch {}
}

// Tier breakdown
const total = results.length;
const regexPass = results.filter(r => r.pass).length;
const regexHardFail = total - regexPass;

// Sub-categories of hard fail
const noProofs = results.filter(r => !r.pass && r.failures.some(f => f.includes('no service angle'))).length;
const noQuestion = results.filter(r => !r.pass && r.failures.some(f => f.includes("doesn't end with ?"))).length;
const noFirstName = results.filter(r => !r.pass && r.failures.some(f => f.includes('first name'))).length;
const bannedHits = results.filter(r => !r.pass && r.has_banned.length > 0).length;
const dmMisuse = results.filter(r => !r.pass && r.has_dm_misuse).length;
const badStructure = results.filter(r => !r.pass && r.failures.some(f => f.includes('blocks'))).length;

// Soft warning tallies (not failures)
const congrats = results.filter(r => r.has_congrats).length;
const lowercaseOpener = results.filter(r => r.warnings.some(w => w.includes('lowercase opener'))).length;
const multiProof = results.filter(r => r.warnings.some(w => w.includes('proofs'))).length;
const factMatch = results.filter(r => r.has_fact_keyword_match).length;

const summary = {
  total,
  regex_pass: regexPass,
  regex_hard_fail: regexHardFail,
  breakdown_hard_fails: {
    no_service_angle_or_proof: noProofs,
    no_question_ending: noQuestion,
    no_first_name: noFirstName,
    banned_phrase: bannedHits,
    dm_misuse: dmMisuse,
    bad_structure: badStructure,
  },
  soft_warnings: {
    has_congrats: congrats,
    lowercase_opener: lowercaseOpener,
    multiple_proofs_para3: multiProof,
    fact_keyword_match_opener: factMatch,
  },
  judge_input_count: judgeInputs.length,
};

writeFileSync(outReport, JSON.stringify({ summary, results }, null, 2), 'utf8');
writeFileSync(judgeInputPath, JSON.stringify(judgeInputs, null, 2), 'utf8');

console.log('\n=== E1 REGEX VALIDATION ===');
console.log(JSON.stringify(summary, null, 2));
console.log(`\nFull report: ${outReport}`);
console.log(`LLM judge queue (regex-pass subset): ${judgeInputPath}`);
