import { describe, it, expect } from 'vitest';
import {
  check11_bannedWords,
  check11b_firstPersonObservation,
  check11c_vagueFact,
  check11d_bridgeNamesSubject,
  check12_capitalization,
  check13_freshness,
  check14_universalTruth,
  check15_email2WordCap,
} from '../scripts/validate-final';

describe('Check 11 - banned words + sentence-starts', () => {
  it('passes clean bridge sentence', () => {
    const row = {
      signal_bridge: 'Brands at that funding stage typically start asking the channel-mix question.',
      signal_fact: 'Your Series B closed in March.',
    };
    expect(check11_bannedWords(row).pass).toBe(true);
  });

  it('rejects banned word "smart"', () => {
    const row = {
      signal_bridge: 'Smart brands at that stage diversify channels.',
      signal_fact: 'Funding closed in March.',
    };
    const result = check11_bannedWords(row);
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/smart/i);
  });

  it('rejects banned start "Saw"', () => {
    const row = {
      signal_bridge: 'Saw your Series B last month.',
      signal_fact: '',
    };
    const result = check11_bannedWords(row);
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/saw/i);
  });
});

describe('Check 11b - first-person observation', () => {
  it('catches "I see" anywhere', () => {
    const row = { email1_body: 'Hello there. Brands move fast. I see this often.' };
    expect(check11b_firstPersonObservation(row).pass).toBe(false);
  });

  it('passes clean third-person', () => {
    const row = { email1_body: 'Hello there. Brands move fast.' };
    expect(check11b_firstPersonObservation(row).pass).toBe(true);
  });
});

describe('Check 11c - vague fact', () => {
  it('rejects bare "Spring sale"', () => {
    expect(check11c_vagueFact({ signal_fact: 'Spring sale' }).pass).toBe(false);
  });

  it('passes specific fact', () => {
    expect(check11c_vagueFact({ signal_fact: 'Spring Icon Tote launched March 2026' }).pass).toBe(true);
  });

  it('passes empty signal_fact', () => {
    expect(check11c_vagueFact({ signal_fact: '' }).pass).toBe(true);
  });
});

describe('Check 11d - bridge names subject in first 4 words', () => {
  it('passes when bridge starts with a noun cohort phrase', () => {
    const row = { person_id: 'p1', signal_bridge: 'Post-funding swimwear brands typically expand their direct mail.' };
    expect(check11d_bridgeNamesSubject(row).pass).toBe(true);
  });

  it('fails when bridge opens with article + abstract noun (no noun in first 4)', () => {
    const row = { person_id: 'p2', signal_bridge: 'The consideration window gets longer as the destination gets further.' };
    const result = check11d_bridgeNamesSubject(row);
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/11d/);
    expect(result.reason).toMatch(/The consideration window gets/);
  });

  it('skips empty signal_bridge (no issue raised)', () => {
    const row = { person_id: 'p3', signal_bridge: '' };
    expect(check11d_bridgeNamesSubject(row).pass).toBe(true);
  });

  it('passes when bridge starts with lowercase NOUN_SEEDS word', () => {
    const row = { person_id: 'p4', signal_bridge: 'brands at Series A often benchmark channel mix early.' };
    expect(check11d_bridgeNamesSubject(row).pass).toBe(true);
  });
});

describe('Check 12 - capitalization', () => {
  it('passes when all sentence starts capitalized', () => {
    expect(check12_capitalization({ email1_body: 'Hello. This is a test.' }).pass).toBe(true);
  });

  it('rejects lowercase sentence start', () => {
    expect(check12_capitalization({ email1_body: 'hello. this is bad.' }).pass).toBe(false);
  });

  it('passes when body is empty', () => {
    expect(check12_capitalization({}).pass).toBe(true);
  });
});

describe('Check 13 - freshness', () => {
  it('passes signal within 90 days', () => {
    expect(check13_freshness({ signal_used: 'funding', signal_freshness_days: 30 }).pass).toBe(true);
  });

  it('rejects signal over 90 days', () => {
    expect(check13_freshness({ signal_used: 'funding', signal_freshness_days: 100 }).pass).toBe(false);
  });

  it('passes fallback regardless of freshness', () => {
    expect(check13_freshness({ signal_used: 'fallback', signal_freshness_days: 500 }).pass).toBe(true);
  });

  it('passes company_snippet regardless (no time decay)', () => {
    expect(check13_freshness({ signal_used: 'company_snippet', signal_freshness_days: 0 }).pass).toBe(true);
  });
});

describe('Check 14 - universal-truth heuristic', () => {
  it('passes when bridge follows a specific fact', () => {
    const row = {
      signal_fact: 'Your Series B closed in March.',
      signal_bridge: 'Brands at that stage typically start asking the channel-mix question.',
    };
    expect(check14_universalTruth(row).pass).toBe(true);
  });

  it('rejects when bridge is pure universal truth with no preceding fact', () => {
    const row = {
      signal_fact: '',
      signal_bridge: 'For premium DTC, channel diversification matters.',
    };
    const result = check14_universalTruth(row);
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/universal truth/i);
  });

  it('passes when no signal at all (fallback)', () => {
    expect(check14_universalTruth({ signal_fact: '', signal_bridge: '' }).pass).toBe(true);
  });
});

describe('Check 15 - email2 word cap (Amendment 7)', () => {
  it('passes Email 2 of 35-65 words', () => {
    const body = 'Alex, bumping this up. Brands at that funding stage tend to move on benchmark decks fast. First quarter in role is when this kind of benchmark data gets attention. Want me to send the category benchmark deck?';
    const result = check15_email2WordCap({ email2_body: body });
    const wc = body.split(/\s+/).filter(Boolean).length;
    expect(wc).toBeLessThanOrEqual(65);
    expect(result.pass).toBe(true);
  });

  it('rejects Email 2 over 65 words', () => {
    // Build a body deliberately over 65 words
    const body = Array.from({ length: 70 }, (_, i) => `word${i}`).join(' ') + '.';
    const result = check15_email2WordCap({ email2_body: body });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/65/);
  });

  it('passes when email2_body is empty', () => {
    expect(check15_email2WordCap({}).pass).toBe(true);
  });
});
