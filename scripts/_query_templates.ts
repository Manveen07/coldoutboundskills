import type { EnrichmentTier } from './_lib_tier';

export type SignalType = 'funding' | 'press' | 'launch' | 'snippet' | 'new_role' | 'promotion';

export interface QueryEntry {
  id: string;
  query: string;
  signal_type: SignalType;
}

export interface QueryBatch {
  serper: QueryEntry[];
  pnd: boolean;
}

interface QueryContext {
  company: string;
  domain: string;
}

function fund(id: string, template: string): (ctx: QueryContext) => QueryEntry {
  return (ctx) => ({ id, signal_type: 'funding', query: template.replace(/{company}/g, `"${ctx.company}"`).replace(/{domain}/g, ctx.domain) });
}

function press(id: string, template: string): (ctx: QueryContext) => QueryEntry {
  return (ctx) => ({ id, signal_type: 'press', query: template.replace(/{company}/g, `"${ctx.company}"`).replace(/{domain}/g, ctx.domain) });
}

function launch(id: string, template: string): (ctx: QueryContext) => QueryEntry {
  return (ctx) => ({ id, signal_type: 'launch', query: template.replace(/{company}/g, `"${ctx.company}"`).replace(/{domain}/g, ctx.domain) });
}

function snippet(id: string, template: string): (ctx: QueryContext) => QueryEntry {
  return (ctx) => ({ id, signal_type: 'snippet', query: template.replace(/{company}/g, `"${ctx.company}"`).replace(/{domain}/g, ctx.domain) });
}

const F1 = fund('F1', '{company} raised funding 2025 2026');
const F2 = fund('F2', '{company} series A B C funding 2025 2026');
const P1 = press('P1', '{company} press release 2026');
const P2 = press('P2', '{company} announces 2026');
const L1 = launch('L1', '{company} launches new collection 2026');
const L2 = launch('L2', '{company} new product launch 2025 2026');
const S1 = snippet('S1', '{company} {domain} ecommerce stores retail');

export function getQueriesForTier(tier: EnrichmentTier, ctx: QueryContext): QueryBatch {
  switch (tier) {
    case 'T1':
      return { serper: [F1(ctx), F2(ctx), P1(ctx), P2(ctx), L1(ctx), L2(ctx), S1(ctx)], pnd: true };
    case 'T2':
      return { serper: [F1(ctx), P1(ctx), L1(ctx), S1(ctx)], pnd: true };
    case 'T3':
      return { serper: [F1(ctx), P1(ctx), S1(ctx)], pnd: false };
  }
}
