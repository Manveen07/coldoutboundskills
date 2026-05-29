#!/usr/bin/env tsx
// Add paragraph breaks to email bodies for skim-readability.

import { readFileSync, writeFileSync, readdirSync } from 'fs';
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
const dryRun = args.includes('--dry-run');

function addBreaks(body: string): string {
  if (!body) return body;
  if (body.includes('\n\n')) return body;

  // Protect abbreviations from splitting (Dr., Mr., Mrs., Inc., LLC., U.S., e.g., i.e., vs., etc., U.S.A., St., Jr., Sr., Ave., Co.)
  const ABBR_RE = /\b(Dr|Mr|Mrs|Ms|Inc|LLC|Co|Corp|Ltd|St|Ave|Blvd|Rd|Jr|Sr|U\.S|U\.K|i\.e|e\.g|vs|etc|approx|incl|max|min|no|cf|al|et)\./gi;
  const guarded = body.replace(ABBR_RE, (m) => m.replace(/\./g, '\x00'));
  const sentences = guarded.split(/(?<=[.?])\s+/).map(s => s.replace(/\x00/g, '.'));
  if (sentences.length <= 2) return body;

  const paragraphs: string[] = [];
  let cur = '';
  let curWords = 0;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i].trim();
    const sWords = s.split(/\s+/).length;
    if (cur === '') {
      cur = s;
      curWords = sWords;
      paragraphs.push(cur);
      cur = '';
      curWords = 0;
      continue;
    }
    cur = cur ? `${cur} ${s}` : s;
    curWords += sWords;
    if (curWords >= 20 || i === sentences.length - 1) {
      paragraphs.push(cur);
      cur = '';
      curWords = 0;
    }
  }
  if (cur) paragraphs.push(cur);

  return paragraphs.join('\n\n');
}

let totalEmails = 0;
let totalChanged = 0;

const files = readdirSync(inDir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
for (const f of files) {
  const path = join(inDir, f);
  try {
    const raw = readFileSync(path, 'utf8');
    const j = JSON.parse(raw);
    const arr = Array.isArray(j) ? j : [j];
    let changed = false;
    for (const it of arr) {
      for (const key of ['email1', 'email2', 'email3', 'email4']) {
        const e = it[key];
        if (!e || !e.body) continue;
        totalEmails++;
        const orig = e.body;
        const next = addBreaks(orig);
        if (next !== orig) {
          e.body = next;
          changed = true;
          totalChanged++;
        }
      }
    }
    if (changed && !dryRun) {
      const out = Array.isArray(j) ? arr : arr[0];
      writeFileSync(path, JSON.stringify(out, null, 2), 'utf8');
    }
  } catch (e: any) {
    console.warn(`fail: ${f} -- ${e.message}`);
  }
}

console.log('emails scanned: ' + totalEmails);
console.log('emails reformatted: ' + totalChanged);
console.log(dryRun ? '(DRY RUN -- no writes)' : 'writes done');
