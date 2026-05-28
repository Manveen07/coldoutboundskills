#!/usr/bin/env tsx
import { existsSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';

function countDir(dir: string): { files: number; bytes: number } {
  if (!existsSync(dir)) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    files++;
    try { bytes += statSync(resolve(dir, f)).size; } catch {}
  }
  return { files, bytes };
}

const dirs: Array<[string, string]> = [
  ['Prospeo',    'data/research-cache/prospeo'],
  ['Serper',     'data/research-cache/serper'],
  ['Scrape',     'data/research-cache/scrape'],
  ['Person',     'data/research-cache/person'],
  ['LeadMagic',  'data/research-cache/leadmagic'],
  ['Score',      'data/research-cache/score'],
];

console.log('='.repeat(60));
console.log('  CACHE STATS');
console.log('='.repeat(60));
let totalFiles = 0;
for (const [name, path] of dirs) {
  const stats = countDir(resolve(process.cwd(), path));
  totalFiles += stats.files;
  console.log(`  ${name.padEnd(12)} ${String(stats.files).padStart(6)} files  ${(stats.bytes / 1024).toFixed(1).padStart(8)} KB`);
}
console.log('-'.repeat(60));
console.log(`  TOTAL        ${String(totalFiles).padStart(6)} files`);
console.log('='.repeat(60));
console.log('Each cached Serper file = 1 credit saved on re-extraction.');
