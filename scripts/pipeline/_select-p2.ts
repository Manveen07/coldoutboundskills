#!/usr/bin/env tsx
// Select top-N qualified leads per vertical from p2 scoring + raw CSVs.
// Writes data/runs/showcase-2026-05-28/topup-v2/{client}-{vertical}-p2.csv
// (the actual lead rows ready for Serper + email pipeline)

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

const root = process.cwd();
const scoringDir = resolve(root, 'data/runs/showcase-2026-05-28/scoring-p2');
const outDir = resolve(root, 'data/runs/showcase-2026-05-28/topup-v2');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

interface Spec {
  client: string;
  vertical: string;
  rawFile: string;
  scoringInline: Array<{ domain: string; qualified: boolean; confidence: number; reason: string }>;
  cap: number;
}

// Inline scoring results (saved from sub-agent runs)
const mythicRetailScores = [
  ["vuori.com",true,0.95],["goldengoose.com",true,0.9],["oceanstatejoblot.com",true,0.75],["avocadogreenmattress.com",true,0.85],
  ["tibi.com",true,0.72],["stitchfix.com",true,0.9],["orvis.com",true,0.9],["on.com",true,0.92],["splendid.com",true,0.78],
  ["biglots.com",true,0.8],["onequince.com",true,0.88],["untuckit.com",true,0.82],["levi.com",true,0.95],["jonesroadbeauty.com",true,0.78],
  ["glossier.com",true,0.9],["schoolhouseelectric.com",true,0.85],["casper.com",true,0.88],["dsw.com",true,0.85],["talbots.com",true,0.85],
];
const mythicFinancialScores = [
  ["bessemertrust.com",true,0.75],["voya.com",true,0.85],["aon.com",true,0.7],["togethercu.org",true,0.75],["hiscox.com",true,0.9],
  ["nasafcu.com",true,0.75],["amfam.com",true,0.95],["federatedinsurance.com",true,0.75],["aexp.com",true,0.95],["nerdwallet.com",true,0.8],
  ["capitalone.com",true,0.95],["wintrust.com",true,0.8],["vanguard.com",true,0.9],["mercuryinsurance.com",true,0.9],["wafdbank.com",true,0.85],
  ["lemonade.com",true,0.9],["robinhood.com",true,0.85],["prudential.com",true,0.95],["massmutual.com",true,0.95],["truist.com",true,0.9],
];
const mythicHealthcareScores = [
  ["pyramidhealthcarepa.com",true,0.75],["daphealth.org",true,0.78],["libertyhealth.com",true,0.72],["giveblood.org",true,0.7],
  ["kindbody.com",true,0.85],["gsderm.com",true,0.78],["vida.com",true,0.85],["onepeloton.com",true,0.9],["concentra.com",true,0.7],
  ["onemedical.com",true,0.9],["davita.com",true,0.8],["hims.com",true,0.95],["lifepointhealth.com",true,0.75],["athleticgreens.com",true,0.88],
  ["unitypoint.org",true,0.8],["anthem.com",true,0.78],["brighthealthcare.com",true,0.72],["ro.co",true,0.92],["anytimefitness.com",true,0.85],
  ["mavenclinic.com",true,0.78],["equinox.com",true,0.88],["curative.com",true,0.7],
];
const mythicHospitalityScores = [
  ["aubergeresorts.com",true,0.9],["marriottvacationsworldwide.com",true,0.85],["kiawahresort.com",true,0.85],["marriott.com",true,0.9],
  ["goldennugget.com",true,0.9],["makeready.com",true,0.85],["mvwc.com",true,0.85],["omnihotels.com",true,0.85],["hyatt.com",true,0.95],
  ["loewshotels.com",true,0.9],["belmond.com",true,0.9],["brinker.com",true,0.95],["firstwatch.com",true,0.85],["texasroadhouse.com",true,0.95],
  ["aubergeresorts.com",true,0.9],["salthospitality.com",true,0.8],["hilton.com",true,0.9],["highgate.com",true,0.85],["leye.com",true,0.9],
  ["standardhotels.com",true,0.9],["choicehotels.com",true,0.9],["beverlyhilton.com",true,0.9],
];
const bwAthleticScores = [
  ["wolfandshepherd.com",true,0.7],["sweatybetty.com",true,0.85],["bandier.com",true,0.8],["tracksmith.com",true,0.9],["lululemon.com",true,0.75],
  ["outdoorvoices.com",true,0.85],["newbalance.com",true,0.75],["salomon.com",true,0.75],["olukai.com",true,0.7],["brooksrunning.com",true,0.9],
  ["setactive.co",true,0.85],["adidas.com",true,0.7],["originmaine.com",true,0.7],
];
const bwFootwearScores = [
  ["wolfandshepherd.com",true,0.85],["allenedmonds.com",true,0.9],["vionicshoes.com",true,0.75],["sperry.com",true,0.72],["rothys.com",true,0.92],
  ["samedelman.com",true,0.75],["colehaan.com",true,0.88],["saucony.com",true,0.74],["tieks.com",true,0.92],["thefryecompany.com",true,0.82],
  ["toms.com",true,0.7],["margauxny.com",true,0.9],["mgemi.com",true,0.9],["marcfisherfootwear.com",true,0.75],
];
const bwDenimScores = [
  ["citizensofhumanity.com",true,0.92],["joesjeans.com",true,0.85],["7forallmankind.com",true,0.88],["frame-store.com",true,0.9],
  ["madewell.com",true,0.78],["dl1961.com",true,0.85],["luckybrand.com",true,0.72],["boyish.com",true,0.8],
];
const bwFoodBevScores = [
  ["presquilewine.com",true,0.75],["getvinebox.com",true,0.8],["winc.com",true,0.85],["nakedwines.com",true,0.85],["brightcellars.com",true,0.85],
  ["drinkcirkul.com",true,0.7],["athleticbrewing.com",true,0.72],["drinkhint.com",true,0.72],["tovala.com",true,0.82],["daily-harvest.com",true,0.85],
  ["magicspoon.com",true,0.78],["drinkolipop.com",true,0.7],["kettleandfire.com",true,0.78],
];

const m = (arr: any[][]) => arr.map(a => ({ domain: a[0], qualified: a[1], confidence: a[2], reason: '' }));

const SPECS: Spec[] = [
  { client: 'mythic',       vertical: 'retail',      rawFile: 'profiles/mythic/campaigns/growth-codes/data/leads-raw-retail-p2.csv',      scoringInline: m(mythicRetailScores),      cap: 15 },
  { client: 'mythic',       vertical: 'financial',   rawFile: 'profiles/mythic/campaigns/growth-codes/data/leads-raw-financial-p2.csv',   scoringInline: m(mythicFinancialScores),   cap: 17 },
  { client: 'mythic',       vertical: 'healthcare',  rawFile: 'profiles/mythic/campaigns/growth-codes/data/leads-raw-healthcare-p2.csv',  scoringInline: m(mythicHealthcareScores),  cap: 20 },
  { client: 'mythic',       vertical: 'hospitality', rawFile: 'profiles/mythic/campaigns/growth-codes/data/leads-raw-hospitality-p2.csv', scoringInline: m(mythicHospitalityScores), cap: 7 },
  { client: 'belardi-wong', vertical: 'athletic',    rawFile: 'profiles/belardi-wong/campaigns/lookalike-anchor/data/leads-raw-athletic-p2.csv', scoringInline: m(bwAthleticScores), cap: 7 },
  { client: 'belardi-wong', vertical: 'footwear',    rawFile: 'profiles/belardi-wong/campaigns/lookalike-anchor/data/leads-raw-footwear-p2.csv', scoringInline: m(bwFootwearScores), cap: 13 },
  { client: 'belardi-wong', vertical: 'denim',       rawFile: 'profiles/belardi-wong/campaigns/lookalike-anchor/data/leads-raw-denim-p2.csv',    scoringInline: m(bwDenimScores),    cap: 7 },
  { client: 'belardi-wong', vertical: 'food_bev',    rawFile: 'profiles/belardi-wong/campaigns/lookalike-anchor/data/leads-raw-fnb-p2.csv',      scoringInline: m(bwFoodBevScores),  cap: 13 },
];

// Build emailed-domain set
const emailsDir = resolve(root, 'data/runs/showcase-2026-05-28/emails');
const emailed = new Set<string>();
for (const f of readdirSync(emailsDir).filter(f => f.endsWith('.json'))) {
  try {
    const j = JSON.parse(readFileSync(join(emailsDir, f), 'utf8'));
    const arr = Array.isArray(j) ? j : [j];
    for (const it of arr) {
      const d = (it.domain || '').toLowerCase().replace(/^www\./, '').trim();
      if (d) emailed.add(d);
    }
  } catch {}
}

for (const s of SPECS) {
  const p = resolve(root, s.rawFile);
  if (!existsSync(p)) { console.warn(`miss: ${p}`); continue; }
  const lines = readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
  const headers = splitCsv(lines[0]);
  const idxDomain = headers.indexOf('company_domain');

  const okDomains = new Set(s.scoringInline.filter(x => x.qualified && x.confidence >= 0.7)
    .map(x => x.domain.toLowerCase().replace(/^www\./, '')));

  const out = [lines[0]];
  const seen = new Set<string>();
  let kept = 0;
  for (let i = 1; i < lines.length && kept < s.cap; i++) {
    const cols = splitCsv(lines[i]);
    const d = (cols[idxDomain] || '').toLowerCase().replace(/^www\./, '').trim();
    if (!okDomains.has(d)) continue;
    if (emailed.has(d) || seen.has(d)) continue;
    seen.add(d);
    out.push(lines[i]);
    kept++;
  }
  const outPath = join(outDir, `${s.client}-${s.vertical}-p2.csv`);
  writeFileSync(outPath, out.join('\n'), 'utf8');
  console.log(`${s.client}/${s.vertical}: ${out.length - 1} leads -> ${outPath}`);
}
