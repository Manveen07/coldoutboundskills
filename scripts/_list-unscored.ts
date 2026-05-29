import { parseCsv } from './_csv_io';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const raw = parseCsv(readFileSync(resolve(process.cwd(), 'profiles/mythic/campaigns/growth-codes/data/leads-raw-qsr.csv'), 'utf8')).rows;
const scored = JSON.parse(readFileSync(resolve(process.cwd(), 'data/mythic-qsr-scores.json'), 'utf8'));

const scoredDomains = new Set<string>();
for (const batch of Object.values(scored)) {
  for (const s of batch as any[]) {
    scoredDomains.add((s.domain || '').toLowerCase().replace(/^www\./, ''));
  }
}

const seen = new Set<string>();
const unscored: any[] = [];
for (const row of raw) {
  const d = (row.company_domain || '').toLowerCase().replace(/^www\./, '');
  if (!d || seen.has(d) || scoredDomains.has(d)) continue;
  seen.add(d);
  unscored.push({ name: row.full_name, title: row.current_job_title, company: row.company_name, domain: d, industry: row.company_industry });
}
console.log('Unscored unique domains:', unscored.length);
unscored.forEach((u, i) => process.stdout.write((i+1) + '. ' + JSON.stringify(u) + '\n'));
