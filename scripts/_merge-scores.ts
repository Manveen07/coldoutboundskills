import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const v1 = JSON.parse(readFileSync(resolve(process.cwd(), 'data/mythic-qsr-scores.json'), 'utf8'));
const v2 = JSON.parse(readFileSync(resolve(process.cwd(), 'data/mythic-qsr-scores-v2.json'), 'utf8'));

const merged: any[] = [];
const seen = new Set<string>();

// v1 is object with batch keys
for (const batch of Object.values(v1)) {
  for (const s of batch as any[]) {
    const d = (s.domain || '').toLowerCase().replace(/^www\./, '');
    if (d && !seen.has(d)) { seen.add(d); merged.push(s); }
  }
}
// v2 is flat array
for (const s of v2) {
  const d = (s.domain || '').toLowerCase().replace(/^www\./, '');
  if (d && !seen.has(d)) { seen.add(d); merged.push(s); }
}

writeFileSync(resolve(process.cwd(), 'data/mythic-qsr-scores-merged.json'), JSON.stringify(merged, null, 2), 'utf8');
console.log(`Merged: ${merged.length} unique domains scored`);
console.log(`Qualified (>= 0.7): ${merged.filter(s => s.qualified && s.confidence >= 0.7).length}`);
console.log(`Qualified (>= 0.6): ${merged.filter(s => s.qualified && s.confidence >= 0.6).length}`);
