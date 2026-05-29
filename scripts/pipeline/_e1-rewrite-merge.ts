#!/usr/bin/env tsx
// Merge E1 rewrites back into emails/*.json (replace email1 only, keep e2-e4).
// Reads rewrites from data/runs/showcase-2026-05-28/e1-rewrite-results/batch-NN.json
// Backs up originals to emails_pre_e1_rewrite_backup/.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, cpSync } from 'fs';
import { resolve, join } from 'path';

const root = process.cwd();
const emailsDir = resolve(root, 'data/runs/showcase-2026-05-28/emails');
const resultsDir = resolve(root, 'data/runs/showcase-2026-05-28/e1-rewrite-results-v2');
const backupDir = resolve(root, 'data/runs/showcase-2026-05-28/emails_pre_e1_v2_backup');

if (!existsSync(backupDir)) {
  cpSync(emailsDir, backupDir, { recursive: true });
  console.log(`backed up emails -> ${backupDir}`);
}

interface Rewrite {
  file: string;
  index: number;
  lead: string;
  domain: string;
  client: string;
  vertical: string;
  email1_subject: string;
  email1_body: string;
  word_count?: number;
  facts_used?: string[];
}

const allRewrites: Rewrite[] = [];
if (existsSync(resultsDir)) {
  for (const f of readdirSync(resultsDir).filter(f => f.endsWith('.json'))) {
    try {
      const arr: Rewrite[] = JSON.parse(readFileSync(join(resultsDir, f), 'utf8'));
      allRewrites.push(...arr);
    } catch (e: any) {
      console.warn(`fail parse ${f}: ${e.message}`);
    }
  }
}

console.log(`loaded ${allRewrites.length} rewrites`);

// Group by file
const byFile = new Map<string, Rewrite[]>();
for (const r of allRewrites) {
  if (!byFile.has(r.file)) byFile.set(r.file, []);
  byFile.get(r.file)!.push(r);
}

let merged = 0;
for (const [file, rewrites] of byFile) {
  const path = join(emailsDir, file);
  if (!existsSync(path)) {
    console.warn(`missing source: ${file}`);
    continue;
  }
  const j = JSON.parse(readFileSync(path, 'utf8'));
  const arr = Array.isArray(j) ? j : [j];
  for (const r of rewrites) {
    if (r.index >= arr.length) {
      console.warn(`bad index ${r.index} in ${file}`);
      continue;
    }
    arr[r.index].email1 = {
      subject: r.email1_subject,
      body: r.email1_body,
    };
    if (r.facts_used) arr[r.index].e1_facts_used = r.facts_used;
    merged++;
  }
  const out = Array.isArray(j) ? arr : arr[0];
  writeFileSync(path, JSON.stringify(out, null, 2), 'utf8');
}

console.log(`merged ${merged} E1 rewrites into ${byFile.size} files`);
