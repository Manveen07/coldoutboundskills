import { describe, it, expect, vi } from 'vitest';
import { writeBridgeSentence } from '../scripts/_bridge_writer';

describe('writeBridgeSentence', () => {
  it('returns valid bridge when AI response passes checks', async () => {
    const aiInvoke = vi.fn().mockResolvedValue(
      'Your Series B closed in March. Brands at that funding stage typically start asking the channel-mix question.'
    );
    const result = await writeBridgeSentence(
      {
        signal_used: 'funding',
        signal_fact: 'X raised $18M Series B in March 2026.',
        company_name: 'X',
        first_name: 'Alex',
      },
      aiInvoke
    );

    expect(result.valid).toBe(true);
    expect(result.bridge).toBeTruthy();
    expect(result.bridge).not.toMatch(/\bsmart\b/i);
  });

  it('rejects + retries once when banned word present', async () => {
    let attempt = 0;
    const aiInvoke = vi.fn().mockImplementation(() => {
      attempt++;
      if (attempt === 1) {
        return Promise.resolve('Smart brands at that stage benchmark fast.');
      }
      return Promise.resolve(
        'Brands at the funding stage you are at typically benchmark fast.'
      );
    });

    const result = await writeBridgeSentence(
      {
        signal_used: 'funding',
        signal_fact: 'X raised $18M Series B.',
        company_name: 'X',
        first_name: 'Alex',
      },
      aiInvoke
    );

    expect(attempt).toBe(2);
    expect(result.valid).toBe(true);
  });

  it('marks invalid after 2 failed attempts', async () => {
    const aiInvoke = vi.fn().mockResolvedValue('Smart brands diversify fast.');
    const result = await writeBridgeSentence(
      {
        signal_used: 'funding',
        signal_fact: 'X raised funding.',
        company_name: 'X',
        first_name: 'A',
      },
      aiInvoke
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/banned word/i);
  });

  it('rejects banned sentence-start "Saw"', async () => {
    const aiInvoke = vi.fn().mockResolvedValue(
      'Saw your Series B last month. Time to test.'
    );
    const result = await writeBridgeSentence(
      {
        signal_used: 'funding',
        signal_fact: 'X raised Series B.',
        company_name: 'X',
        first_name: 'A',
      },
      aiInvoke
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/sentence-start|saw/i);
  });

  it('rejects first-person observation "I see"', async () => {
    const aiInvoke = vi.fn().mockResolvedValue(
      'Brands at your stage move fast. I see this pattern often.'
    );
    const result = await writeBridgeSentence(
      {
        signal_used: 'funding',
        signal_fact: 'X raised Series B.',
        company_name: 'X',
        first_name: 'A',
      },
      aiInvoke
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/first-person|i see/i);
  });

  it('rejects when over 25 words', async () => {
    const aiInvoke = vi.fn().mockResolvedValue(
      'Companies at this exact funding stage tend to begin actively benchmarking their direct mail acquisition data within the first quarter following their announcement.'
    );
    const result = await writeBridgeSentence(
      {
        signal_used: 'funding',
        signal_fact: 'X raised funding.',
        company_name: 'X',
        first_name: 'A',
      },
      aiInvoke
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/word/i);
  });
});
