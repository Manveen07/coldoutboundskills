import { describe, it, expect } from 'vitest';
import {
  findBannedWords,
  findBannedStarts,
  findFirstPersonObservation,
  findVagueFact,
} from '../scripts/_lib_banned';

describe('banned word matcher', () => {
  it('catches simple banned words', () => {
    const result = findBannedWords('You are smart and the best.');
    expect(result).toContain('smart');
    expect(result).toContain('best');
  });

  it('catches morphological variants', () => {
    const result = findBannedWords('Your team works smartly with best-in-class leading-edge tooling.');
    expect(result).toContain('smartly');
    expect(result).toContain('best-in-class');
    expect(result).toContain('leading-edge');
  });

  it('catches compound phrases', () => {
    const result = findBannedWords('Bringing fresh eyes at perfect timing.');
    expect(result).toContain('fresh eyes');
    expect(result).toContain('perfect timing');
  });

  it('catches Amendment 4 additions', () => {
    const result = findBannedWords(
      'This caught my eye. Brands like yours tends to grow. It usually drives engagement. Brands at this stage win.'
    );
    expect(result).toContain('caught my eye');
    expect(result).toContain('tends to');
    expect(result).toContain('usually drives');
    expect(result).toContain('brands at this stage');
  });

  it('does NOT match embedded substrings', () => {
    const result = findBannedWords('My smartphone has best practices documented.');
    expect(result).not.toContain('smart');
    expect(result).not.toContain('best');
  });

  it('returns empty for clean text', () => {
    const result = findBannedWords('Your Series B closed in March 2026 led by Acme Ventures.');
    expect(result).toEqual([]);
  });
});

describe('banned sentence-start matcher', () => {
  it('catches first-word "Saw"', () => {
    const result = findBannedStarts('Saw your post yesterday.');
    expect(result).toContain('Saw');
  });

  it('catches "Noticed"', () => {
    const result = findBannedStarts('Noticed your funding round.');
    expect(result).toContain('Noticed');
  });

  it('catches multi-token starts like "I saw"', () => {
    const result = findBannedStarts('I saw your launch announcement.');
    expect(result).toContain('I saw');
  });

  it('catches Amendment 4 additions', () => {
    const r1 = findBannedStarts('Saw that you launched.');
    expect(r1).toContain('Saw that');

    const r2 = findBannedStarts("I don't see a lot of brands doing this.");
    expect(r2).toContain("I don't see");

    const r3 = findBannedStarts("I'm guessing this is a busy quarter.");
    expect(r3).toContain("I'm guessing");

    const r4 = findBannedStarts('I imagine you are slammed right now.');
    expect(r4).toContain('I imagine');
  });

  it('catches across multiple sentences', () => {
    const result = findBannedStarts('Your Series B closed last week. Noticed it on Crunchbase.');
    expect(result).toContain('Noticed');
  });

  it('returns empty for clean third-person', () => {
    const result = findBannedStarts('Your Series B closed in March 2026 led by Acme Ventures.');
    expect(result).toEqual([]);
  });
});

describe('first-person observation matcher (Check 11b)', () => {
  it('catches "I see" anywhere in text', () => {
    const result = findFirstPersonObservation('Brands like X are growing. I see them often in our pipeline.');
    expect(result.map((s) => s.toLowerCase())).toContain('i see');
  });

  it('catches "I noticed"', () => {
    const result = findFirstPersonObservation('At the time, I noticed your announcement.');
    expect(result.map((s) => s.toLowerCase())).toContain('i noticed');
  });

  it('catches "I caught"', () => {
    const result = findFirstPersonObservation('Yesterday I caught your podcast appearance.');
    expect(result.map((s) => s.toLowerCase())).toContain('i caught');
  });

  it("catches \"I'm guessing\"", () => {
    const result = findFirstPersonObservation("So I'm guessing Q2 is the push.");
    expect(result.map((s) => s.toLowerCase())).toContain("i'm guessing");
  });

  it('catches "I imagine"', () => {
    const result = findFirstPersonObservation('Honestly, I imagine the team is busy.');
    expect(result.map((s) => s.toLowerCase())).toContain('i imagine');
  });

  it('catches "I am guessing" / "I am imagining" / "I could imagine"', () => {
    const r1 = findFirstPersonObservation('So I am guessing this is a tough quarter.');
    expect(r1.map((s) => s.toLowerCase())).toContain('i am guessing');

    const r2 = findFirstPersonObservation('At this point I am imagining the worst.');
    expect(r2.map((s) => s.toLowerCase())).toContain('i am imagining');

    const r3 = findFirstPersonObservation('I could imagine a scenario where this helps.');
    expect(r3.map((s) => s.toLowerCase())).toContain('i could imagine');
  });

  it('returns empty for clean text', () => {
    const result = findFirstPersonObservation('Your Series B closed in March 2026 led by Acme Ventures.');
    expect(result).toEqual([]);
  });

  it('is case-insensitive', () => {
    const result = findFirstPersonObservation('Honestly, i SEE patterns here.');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].toLowerCase()).toBe('i see');
  });
});

describe('vague-fact matcher (Check 11c)', () => {
  it('returns true for bare "Spring sale"', () => {
    expect(findVagueFact('Spring sale')).toBe(true);
  });

  it('returns true for "summer launch"', () => {
    expect(findVagueFact('summer launch')).toBe(true);
  });

  it('returns true for "Q1 promotion" (case-insensitive Q matches q)', () => {
    expect(findVagueFact('Q1 promotion')).toBe(true);
  });

  it('returns false when proper noun follows', () => {
    expect(findVagueFact('Spring Icon Tote launched March 2026')).toBe(false);
  });

  it('returns false for non-season facts', () => {
    expect(findVagueFact('Aloe Care Health acquired')).toBe(false);
  });

  it('returns false when extra trailing words present', () => {
    expect(findVagueFact('Spring sale collection')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(findVagueFact('')).toBe(false);
  });

  it('returns true for "holiday drop"', () => {
    expect(findVagueFact('holiday drop')).toBe(true);
  });
});
