export type EnrichmentTier = 'T1' | 'T2' | 'T3';

interface TierInput {
  qual_confidence: number;
  title: string;
}

const SENIOR_TITLES = /\b(vp|svp|evp|cmo|cro|ceo|cfo|coo|founder|chief|president)\b/i;
const DIRECTOR_TITLES = /\b(director|head of|senior manager|sr\.?\s*manager|sr\.?\s*director)\b/i;
const MANAGER_TITLES = /\bmanager\b/i;

export function computeTier(input: TierInput): EnrichmentTier {
  const { qual_confidence: conf, title } = input;

  if (conf < 0.70) {
    throw new Error(
      `Lead is below qualifier floor 0.70 (conf=${conf}). Should not reach enrichment.`
    );
  }

  const isSenior = SENIOR_TITLES.test(title);
  const isDirector = DIRECTOR_TITLES.test(title);
  const isManager = !isDirector && MANAGER_TITLES.test(title);

  if (conf >= 0.80 && isSenior) return 'T1';
  if (conf >= 0.90 && isDirector) return 'T1';
  if (conf >= 0.70 && isDirector) return 'T2';
  if (conf >= 0.80 && isManager) return 'T2';

  return 'T3';
}
