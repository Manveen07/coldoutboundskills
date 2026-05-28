#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Recovery commands for the standardized pipeline.
//
// Usage:
//   npx tsx scripts/pipeline/recover.ts --client mythic --category qsr --stage extract
//   npx tsx scripts/pipeline/recover.ts --client mythic --category qsr --stage write
//   npx tsx scripts/pipeline/recover.ts --clear-cache --confirm-domain=mythic.us
// ---------------------------------------------------------------------------

import { resolve } from 'path';
import { clearCacheDomain } from './_cache';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined; };
  const getEq = (flag: string) => {
    const item = args.find(a => a.startsWith(`${flag}=`));
    return item ? item.split('=')[1] : undefined;
  };
  return {
    client: get('--client'),
    category: get('--category'),
    stage: get('--stage'),
    clearCache: args.includes('--clear-cache'),
    confirmDomain: getEq('--confirm-domain'),
  };
}

async function main() {
  const args = parseArgs();

  if (args.clearCache) {
    if (!args.confirmDomain) {
      console.error('--clear-cache requires --confirm-domain=<exact-domain> to prevent accidents');
      process.exit(1);
    }
    const dirs = [
      resolve(process.cwd(), 'data/research-cache/serper'),
      resolve(process.cwd(), 'data/research-cache/scrape'),
      resolve(process.cwd(), 'data/research-cache/person'),
    ];
    let total = 0;
    for (const d of dirs) total += clearCacheDomain(d, args.confirmDomain);
    console.log(`Cleared ${total} cache entries for ${args.confirmDomain}`);
    return;
  }

  if (!args.client || !args.category || !args.stage) {
    console.error('Usage: --client X --category Y --stage extract|score|write');
    process.exit(1);
  }

  if (args.stage === 'extract' || args.stage === 'write' || args.stage === 'score') {
    console.log(`Re-${args.stage} from cache: re-run pipeline with --offline flag to use cached data only.`);
    console.log(`  npx tsx scripts/pipeline/run.ts --client ${args.client} --category ${args.category} --offline`);
    return;
  }

  console.error(`Unknown stage: ${args.stage}`);
  process.exit(1);
}

main().catch(e => { console.error('FATAL:', e?.message ?? e); process.exit(1); });
