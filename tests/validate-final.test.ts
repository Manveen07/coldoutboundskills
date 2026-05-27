import { describe, it, expect } from 'vitest';
import {
  check11_bannedWords,
  check11b_firstPersonObservation,
  check11c_vagueFact,
  check12_capitalization,
  check13_freshness,
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
