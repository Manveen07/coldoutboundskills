import { serperSearch } from './_serper_client';
import { extractFundingFact, extractPressFact, extractSnippetFact } from './_fact_extractor';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const env = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
let key = '';
for (const line of env.split('\n')) {
  const t = line.trim();
  if (t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...v] = t.split('=');
  if (k.trim() === 'SERPER_API_KEY') key = v.join('=').trim().replace(/^["']|["']$/g, '');
}

const r1 = await serperSearch('"Captain D\'s" raised funding 2025 2026', key, 'debug');
console.log('F1 organic count:', r1.raw?.organic?.length);
console.log('F1 first result:', JSON.stringify(r1.raw?.organic?.[0], null, 2));
const f = extractFundingFact(r1.raw, "Captain D's");
console.log('Funding fact:', f);

const r2 = await serperSearch('"Captain D\'s" press release 2026', key, 'debug');
console.log('\nP1 organic count:', r2.raw?.organic?.length);
console.log('P1 first result:', JSON.stringify(r2.raw?.organic?.[0], null, 2));
const p = extractPressFact(r2.raw, "Captain D's");
console.log('Press fact:', p);

const r3 = await serperSearch('"Captain D\'s" new campaign brand advertising 2025 2026', key, 'debug');
console.log('\nM1 organic count:', r3.raw?.organic?.length);
const s = extractSnippetFact(r3.raw, "Captain D's");
console.log('Snippet fact:', s);
