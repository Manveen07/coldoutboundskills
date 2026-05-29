import { readFileSync } from 'fs';
import { resolve } from 'path';

const env = Object.fromEntries(
  readFileSync(resolve(process.cwd(), '.env'), 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const SERPER_KEY = env.SERPER_API_KEY;
if (!SERPER_KEY) { console.error('SERPER_API_KEY missing in .env'); process.exit(1); }

try {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: 'test', gl: 'us' }),
  });
  console.log('Status:', res.status);
  console.log('Body:', await res.text());
} catch (err: any) {
  console.error('Error type:', err.constructor?.name);
  console.error('Error code:', err.code);
  console.error('Error cause:', err.cause?.code, err.cause?.message);
  console.error('Error message:', err.message);
}
