import { describe, it, expect } from 'vitest';
import {
  extractFundingFact,
  extractPressFact,
  extractLaunchFact,
  extractAcquisitionFact,
  extractSnippetFact,
} from '../_fact_extractor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeOrganic(items: Array<{ title?: string; snippet?: string; date?: string }>) {
  return { organic: items.map((i) => ({ title: i.title ?? '', snippet: i.snippet ?? '', date: i.date })) };
}

// ---------------------------------------------------------------------------
// extractFundingFact — baseline / pre-existing behaviour
// ---------------------------------------------------------------------------
describe('extractFundingFact', () => {
  it('returns null when no organic results', () => {
    expect(extractFundingFact({}, 'Acme')).toBeNull();
  });

  it('returns null when no funding pattern matches', () => {
    const raw = makeOrganic([{ snippet: 'A great product launch today.' }]);
    expect(extractFundingFact(raw, 'Acme')).toBeNull();
  });

  it('skips negation items and returns next valid match', () => {
    const raw = makeOrganic([
      { snippet: 'Acme has not raised any funding.', title: 'Acme funding' },
      { snippet: 'Acme raised $5M in seed funding.', date: '2024-01-15' },
    ]);
    const result = extractFundingFact(raw, 'Acme');
    expect(result).not.toBeNull();
    expect(result!.fact).toContain('$5M');
  });

  it('attaches fact_date and freshness_days when date present', () => {
    const raw = makeOrganic([{ snippet: 'Acme raised $10M in series A.', date: '2024-06-01' }]);
    const result = extractFundingFact(raw, 'Acme');
    expect(result!.fact_date).toBe('2024-06-01');
    expect(typeof result!.freshness_days).toBe('number');
  });

  // -------------------------------------------------------------------------
  // Fix #1 — Rule 1: First-sentence truncation
  // -------------------------------------------------------------------------
  it('Rule 1: returns only first sentence from multi-sentence snippet', () => {
    const raw = makeOrganic([
      {
        snippet:
          'Frankies Bikinis raised $18M in funding. The company has 95 active competitors. Its top competitors are funded brands.',
      },
    ]);
    const result = extractFundingFact(raw, 'Frankies Bikinis');
    expect(result).not.toBeNull();
    expect(result!.fact).toBe('Frankies Bikinis raised $18M in funding.');
  });

  // -------------------------------------------------------------------------
  // Fix #1 — Rule 2: Pronoun-residue rejection — skip to next item
  // -------------------------------------------------------------------------
  it('Rule 2: skips item whose first sentence starts with "Its " and uses next valid item', () => {
    const raw = makeOrganic([
      { snippet: 'Its top competitors include 10 funded brands. Acme raised $5M in seed.' },
      { snippet: 'Acme raised $5M in seed funding.' },
    ]);
    const result = extractFundingFact(raw, 'Acme');
    expect(result).not.toBeNull();
    expect(result!.fact).toBe('Acme raised $5M in seed funding.');
  });

  it('Rule 2: skips "Their " pronoun-led item, returns third item', () => {
    const raw = makeOrganic([
      { snippet: 'Acme has not raised any funding rounds.' },           // negation — skip
      { snippet: 'Their latest round raised $8M in series B.' },       // pronoun — skip
      { snippet: 'Acme secured $12M in series C investment.' },        // valid
    ]);
    const result = extractFundingFact(raw, 'Acme');
    expect(result).not.toBeNull();
    expect(result!.fact).toBe('Acme secured $12M in series C investment.');
  });

  it('Rule 2: snippet starting with "The company " is rejected, continues', () => {
    const raw = makeOrganic([
      { snippet: 'The company raised $3M in seed funding. Founded in 2020.' },  // pronoun — skip
      { snippet: 'BrandX raised $3M in a seed round.' },
    ]);
    const result = extractFundingFact(raw, 'BrandX');
    expect(result).not.toBeNull();
    expect(result!.fact).toBe('BrandX raised $3M in a seed round.');
  });

  // -------------------------------------------------------------------------
  // Fix #1 — Rule 3: Ellipsis strip
  // -------------------------------------------------------------------------
  it('Rule 3: strips trailing "..." from fact', () => {
    const raw = makeOrganic([{ snippet: 'Acme raised $7M in series A...' }]);
    const result = extractFundingFact(raw, 'Acme');
    expect(result).not.toBeNull();
    expect(result!.fact).toBe('Acme raised $7M in series A');
  });

  it('Rule 3: strips trailing unicode ellipsis from fact', () => {
    const raw = makeOrganic([{ snippet: 'Acme raised $7M in series A…' }]);
    const result = extractFundingFact(raw, 'Acme');
    expect(result).not.toBeNull();
    expect(result!.fact).toBe('Acme raised $7M in series A');
  });

  it('Rule 3: preserves single trailing period', () => {
    const raw = makeOrganic([{ snippet: 'Acme raised $7M in series A.' }]);
    const result = extractFundingFact(raw, 'Acme');
    expect(result).not.toBeNull();
    expect(result!.fact).toBe('Acme raised $7M in series A.');
  });
});

// ---------------------------------------------------------------------------
// extractPressFact
// ---------------------------------------------------------------------------
describe('extractPressFact', () => {
  it('returns null when no press pattern matches', () => {
    const raw = makeOrganic([{ snippet: 'Nothing relevant here.' }]);
    expect(extractPressFact(raw, 'Acme')).toBeNull();
  });

  it('returns first sentence only', () => {
    const raw = makeOrganic([
      { snippet: 'Acme announces new store opening. The brand has 50 locations. They plan to expand.' },
    ]);
    const result = extractPressFact(raw, 'Acme');
    expect(result!.fact).toBe('Acme announces new store opening.');
  });

  it('skips pronoun-led items and tries next', () => {
    const raw = makeOrganic([
      { snippet: 'The brand announces a new partnership. More details inside.' },
      { snippet: 'Acme announces a major retail partnership.' },
    ]);
    const result = extractPressFact(raw, 'Acme');
    expect(result!.fact).toBe('Acme announces a major retail partnership.');
  });
});

// ---------------------------------------------------------------------------
// extractLaunchFact
// ---------------------------------------------------------------------------
describe('extractLaunchFact', () => {
  it('returns first sentence only', () => {
    const raw = makeOrganic([
      { snippet: 'Acme launches new collection this fall. They are targeting Gen Z shoppers.' },
    ]);
    const result = extractLaunchFact(raw, 'Acme');
    expect(result!.fact).toBe('Acme launches new collection this fall.');
  });

  it('strips trailing ellipsis', () => {
    const raw = makeOrganic([{ snippet: 'Acme launches new product line...' }]);
    const result = extractLaunchFact(raw, 'Acme');
    expect(result!.fact).toBe('Acme launches new product line');
  });
});

// ---------------------------------------------------------------------------
// extractAcquisitionFact
// ---------------------------------------------------------------------------
describe('extractAcquisitionFact', () => {
  it('returns first sentence only', () => {
    const raw = makeOrganic([
      { snippet: 'Acme acquires rival startup. The acquisition price was not disclosed.' },
    ]);
    const result = extractAcquisitionFact(raw, 'Acme');
    expect(result!.fact).toBe('Acme acquires rival startup.');
  });

  it('skips pronoun-led item, returns next valid', () => {
    const raw = makeOrganic([
      { snippet: 'They acquired a competitor last quarter. Big news.' },
      { snippet: 'Acme acquired StyleCo in a deal worth $50M.' },
    ]);
    const result = extractAcquisitionFact(raw, 'Acme');
    expect(result!.fact).toBe('Acme acquired StyleCo in a deal worth $50M.');
  });
});

// ---------------------------------------------------------------------------
// extractSnippetFact
// ---------------------------------------------------------------------------
describe('extractSnippetFact', () => {
  it('returns null when no organic results', () => {
    expect(extractSnippetFact({}, 'Acme')).toBeNull();
  });

  it('returns null for copyright-only snippet', () => {
    const raw = makeOrganic([{ snippet: '© 2024 Acme Inc.' }]);
    expect(extractSnippetFact(raw, 'Acme')).toBeNull();
  });

  it('returns null for stopword snippet', () => {
    const raw = makeOrganic([{ snippet: 'Shop our latest collection now.' }]);
    expect(extractSnippetFact(raw, 'Acme')).toBeNull();
  });

  it('Rule 1: returns first sentence only', () => {
    const raw = makeOrganic([
      { snippet: 'Acme is a premium swimwear brand. They ship worldwide. Free returns included.' },
    ]);
    const result = extractSnippetFact(raw, 'Acme');
    expect(result!.fact).toBe('Acme is a premium swimwear brand.');
  });

  it('Rule 2: pronoun-led snippet returns null (no loop in extractSnippetFact)', () => {
    const raw = makeOrganic([
      { snippet: 'Its top competitors include 10 funded brands.' },
    ]);
    expect(extractSnippetFact(raw, 'Acme')).toBeNull();
  });

  it('Rule 2: "The company" pronoun-led snippet returns null', () => {
    const raw = makeOrganic([{ snippet: 'The company has 200 employees.' }]);
    expect(extractSnippetFact(raw, 'Acme')).toBeNull();
  });

  it('Rule 3: strips trailing ellipsis', () => {
    const raw = makeOrganic([{ snippet: 'Acme is a premium swimwear brand...' }]);
    const result = extractSnippetFact(raw, 'Acme');
    expect(result!.fact).toBe('Acme is a premium swimwear brand');
  });

  it('returns clean snippet when no boundary found', () => {
    const raw = makeOrganic([{ snippet: 'Acme — premium swimwear since 2015' }]);
    const result = extractSnippetFact(raw, 'Acme');
    expect(result!.fact).toBe('Acme — premium swimwear since 2015');
  });
});
