import { describe, it, expect } from 'vitest';
import {
  extractFundingFact,
  extractPressFact,
  extractLaunchFact,
  extractSnippetFact,
  extractAcquisitionFact,
} from '../scripts/_fact_extractor';

describe('extractFundingFact', () => {
  it('extracts fact from first organic result with date', () => {
    const raw = {
      organic: [{
        title: 'Test Co raises $18M Series B',
        snippet: 'Test Co announced an $18M Series B round led by Sequoia in March 2026.',
        date: '2026-03-15',
        link: 'https://techcrunch.com/story',
      }],
    };
    const fact = extractFundingFact(raw, 'Test Co');
    expect(fact).not.toBeNull();
    expect(fact!.fact).toMatch(/series b/i);
    expect(fact!.fact_date).toBe('2026-03-15');
    expect(fact!.freshness_days).toBeGreaterThanOrEqual(0);
  });

  it('returns null when no funding-relevant results', () => {
    const raw = { organic: [{ title: 'Test Co careers page', snippet: 'Jobs at Test Co', date: '2024-01-01', link: 'https://somerandomblog.com/story' }] };
    const fact = extractFundingFact(raw, 'Test Co');
    expect(fact).toBeNull();
  });

  it('returns null when organic is empty', () => {
    expect(extractFundingFact({ organic: [] }, 'X')).toBeNull();
  });

  it('rejects negative funding snippets (Bug 4)', () => {
    const raw = {
      organic: [{
        title: 'Acme funding history',
        snippet: 'Acme has not raised any funding rounds yet according to public records.',
        date: '2026-04-01',
      }],
    };
    expect(extractFundingFact(raw, 'Acme')).toBeNull();
  });

  it('returns positive funding fact (Bug 4 regression guard)', () => {
    const raw = {
      organic: [{
        title: 'Acme funding',
        snippet: 'Acme raised $18M Series B in March 2026 led by Sequoia.',
        date: '2026-03-15',
        link: 'https://techcrunch.com/story',
      }],
    };
    const fact = extractFundingFact(raw, 'Acme');
    expect(fact).not.toBeNull();
    expect(fact!.fact).toMatch(/series b/i);
  });
});

describe('extractSnippetFact', () => {
  it('extracts company snippet from organic[0]', () => {
    const raw = {
      organic: [{
        title: 'Havertys Furniture - Quality Home Furniture',
        snippet: 'Havertys is a quality furniture retailer across 120+ stores with free delivery.',
        link: 'https://havertys.com',
      }],
    };
    const fact = extractSnippetFact(raw, 'Havertys Furniture');
    expect(fact).not.toBeNull();
    expect(fact!.fact).toContain('120+ stores');
  });

  it('rejects snippets starting with stopword phrases', () => {
    const raw = {
      organic: [{
        title: 'Paul Fredrick',
        snippet: 'Perfect Fit Guarantee. Explore The Latest Styles. Shop men\'s clothing online.',
      }],
    };
    expect(extractSnippetFact(raw, 'Paul Fredrick')).toBeNull();
  });

  it('still accepts clean snippets that do not match stopwords', () => {
    const raw = {
      organic: [{
        title: 'Acme Brand',
        snippet: 'Acme Brand is a New York-based DTC retailer of premium home furnishings.',
      }],
    };
    const fact = extractSnippetFact(raw, 'Acme Brand');
    expect(fact).not.toBeNull();
    expect(fact!.fact).toContain('DTC retailer');
  });

  it('rejects copyright-only snippets', () => {
    const raw = {
      organic: [{
        title: 'Some Site',
        snippet: '© 2026 Some Site Inc. All rights reserved.',
      }],
    };
    expect(extractSnippetFact(raw, 'Some Site')).toBeNull();
  });
});

describe('extractPressFact', () => {
  it('extracts press release fact from matching snippet', () => {
    const raw = {
      organic: [{
        title: 'Acme Corp announces new partnership with Globex',
        snippet: 'Acme Corp announced a strategic partnership with Globex on April 10, 2026.',
        date: '2026-04-10',
        link: 'https://techcrunch.com/story',
      }],
    };
    const fact = extractPressFact(raw, 'Acme Corp');
    expect(fact).not.toBeNull();
    expect(fact!.fact).toMatch(/partnership/i);
    expect(fact!.fact_date).toBe('2026-04-10');
  });
});

describe('extractLaunchFact', () => {
  it('extracts launch fact from matching snippet', () => {
    const raw = {
      organic: [{
        title: 'Brand X launches new spring collection',
        snippet: 'Brand X launches its new spring collection featuring sustainable materials.',
        date: '2026-02-20',
      }],
    };
    const fact = extractLaunchFact(raw, 'Brand X');
    expect(fact).not.toBeNull();
    expect(fact!.fact).toMatch(/new spring collection|launches/i);
    expect(fact!.fact_date).toBe('2026-02-20');
  });
});

describe('extractAcquisitionFact', () => {
  it('detects acquisition snippet', () => {
    const raw = {
      organic: [{
        title: 'BigCo acquired SmallCo in April 2026',
        snippet: 'BigCo acquired SmallCo for $500M in April 2026 to expand its portfolio.',
        date: '2026-04-15',
      }],
    };
    const fact = extractAcquisitionFact(raw, 'BigCo');
    expect(fact).not.toBeNull();
    expect(fact!.fact).toMatch(/acquired/i);
    expect(fact!.fact_date).toBe('2026-04-15');
  });

  it('returns null when no acquisition language', () => {
    const raw = {
      organic: [{
        title: 'BigCo quarterly earnings report',
        snippet: 'BigCo reported strong Q1 earnings with 15% growth.',
        date: '2026-04-01',
      }],
    };
    const fact = extractAcquisitionFact(raw, 'BigCo');
    expect(fact).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fix #1 — Rule 1: First-sentence truncation
// ---------------------------------------------------------------------------
describe('Fix #1 Rule 1 — first-sentence truncation', () => {
  it('funding: multi-sentence snippet returns only first sentence', () => {
    const raw = {
      organic: [{
        snippet: 'Frankies Bikinis raised $18M in funding. The company has 95 active competitors. Its top competitors are funded brands.',
        date: '2026-01-01',
        link: 'https://techcrunch.com/story',
      }],
    };
    const fact = extractFundingFact(raw, 'Frankies Bikinis');
    expect(fact).not.toBeNull();
    expect(fact!.fact).toBe('Frankies Bikinis raised $18M in funding.');
  });

  it('launch: multi-sentence snippet returns only first sentence', () => {
    const raw = {
      organic: [{
        snippet: 'Acme launches its spring collection. They are targeting Gen Z shoppers. Free shipping available.',
        date: '2026-02-01',
      }],
    };
    const fact = extractLaunchFact(raw, 'Acme');
    expect(fact).not.toBeNull();
    expect(fact!.fact).toBe('Acme launches its spring collection.');
  });
});

// ---------------------------------------------------------------------------
// Fix #1 — Rule 2: Pronoun-residue rejection
// ---------------------------------------------------------------------------
describe('Fix #1 Rule 2 — pronoun-residue rejection', () => {
  it('funding: item with "Its top" first sentence is skipped; third organic item returned', () => {
    const raw = {
      organic: [
        { snippet: 'Its top competitors raised $8M. Acme raised $5M in seed.', link: 'https://somerandomblog.com/story' },
        { snippet: 'Their latest round closed at $10M in series B.', link: 'https://somerandomblog.com/story' },
        { snippet: 'Acme secured $12M in series C investment.', link: 'https://techcrunch.com/story' },
      ],
    };
    const fact = extractFundingFact(raw, 'Acme');
    expect(fact).not.toBeNull();
    expect(fact!.fact).toBe('Acme secured $12M in series C investment.');
  });

  it('funding: "The company" pronoun-led first sentence skipped', () => {
    const raw = {
      organic: [
        { snippet: 'The company raised $3M in seed funding. Founded in 2020.', link: 'https://somerandomblog.com/story' },
        { snippet: 'BrandX raised $3M in a seed round.', link: 'https://techcrunch.com/story' },
      ],
    };
    const fact = extractFundingFact(raw, 'BrandX');
    expect(fact).not.toBeNull();
    expect(fact!.fact).toBe('BrandX raised $3M in a seed round.');
  });

  it('snippetFact: pronoun-led "Its " snippet returns null', () => {
    const raw = {
      organic: [{ snippet: 'Its top competitors include 10 funded brands.' }],
    };
    expect(extractSnippetFact(raw, 'Acme')).toBeNull();
  });

  it('snippetFact: "The company" snippet returns null', () => {
    const raw = {
      organic: [{ snippet: 'The company has 200 employees across 5 offices.' }],
    };
    expect(extractSnippetFact(raw, 'Acme')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fix #1 — Rule 3: Ellipsis strip
// ---------------------------------------------------------------------------
describe('Fix #1 Rule 3 — ellipsis strip', () => {
  it('funding: trailing "..." stripped', () => {
    const raw = {
      organic: [{ snippet: 'Acme raised $7M in series A...', link: 'https://techcrunch.com/story' }],
    };
    const fact = extractFundingFact(raw, 'Acme');
    expect(fact).not.toBeNull();
    expect(fact!.fact).toBe('Acme raised $7M in series A');
  });

  it('funding: trailing unicode ellipsis stripped', () => {
    const raw = {
      organic: [{ snippet: 'Acme raised $7M in series A…', link: 'https://techcrunch.com/story' }],
    };
    const fact = extractFundingFact(raw, 'Acme');
    expect(fact).not.toBeNull();
    expect(fact!.fact).toBe('Acme raised $7M in series A');
  });

  it('funding: single trailing period preserved', () => {
    const raw = {
      organic: [{ snippet: 'Acme raised $7M in series A.', link: 'https://techcrunch.com/story' }],
    };
    const fact = extractFundingFact(raw, 'Acme');
    expect(fact).not.toBeNull();
    expect(fact!.fact).toBe('Acme raised $7M in series A.');
  });

  it('acquisition: trailing "..." stripped', () => {
    const raw = {
      organic: [{ snippet: 'BigCo acquired SmallCo for undisclosed terms...' }],
    };
    const fact = extractAcquisitionFact(raw, 'BigCo');
    expect(fact).not.toBeNull();
    expect(fact!.fact).not.toMatch(/\.\.\.$/);
  });
});
