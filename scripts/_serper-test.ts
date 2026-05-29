import { serperSearch } from './_serper_client';
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

console.log('Testing Serper...');
try {
  const result = await serperSearch('"Captain D\'s" funding 2025', key, 'serper-test');
  console.log('OK — organic results:', result.organic?.length ?? 0);
} catch (e: any) {
  console.error('FAIL:', e.message);
}
