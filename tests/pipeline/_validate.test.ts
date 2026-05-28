import { describe, it, expect } from 'vitest';
import { validateMechanical, buildSemanticPrompt, buildRolePlayPrompt } from '../../scripts/pipeline/_validate';

describe('validateMechanical', () => {
  const goodE1 = "jane, your recent series b round opens up a moment most growth-stage brands waste. funded teams tend to pour spend into the channels that worked yesterday, not the ones that will scale tomorrow. curious how you're thinking about that allocation.";
  const minBounds = { min: 30, max: 90 };

  it('passes a clean email under word count', () => {
    const result = validateMechanical({ subject: 'thinking out loud', body: goodE1, research_detail_used: 'Series B' }, { wordCount: minBounds, banned: ['leverage', 'synergy'] });
    expect(result.pass).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('flags em dashes', () => {
    const body = goodE1.replace('round', 'round —');
    const result = validateMechanical({ subject: 's', body, research_detail_used: 'x' }, { wordCount: minBounds, banned: [] });
    expect(result.pass).toBe(false);
    expect(result.violations.some(v => /em dash/i.test(v))).toBe(true);
  });

  it('flags exclamation points', () => {
    const result = validateMechanical({ subject: 's', body: goodE1 + ' wow!', research_detail_used: 'x' }, { wordCount: { min: 30, max: 120 }, banned: [] });
    expect(result.pass).toBe(false);
    expect(result.violations.some(v => /exclamation/i.test(v))).toBe(true);
  });

  it('flags banned phrases', () => {
    const result = validateMechanical({ subject: 's', body: goodE1 + ' we leverage analytics.', research_detail_used: 'x' }, { wordCount: { min: 30, max: 120 }, banned: ['leverage'] });
    expect(result.pass).toBe(false);
    expect(result.violations.some(v => /banned phrase.*leverage/i.test(v))).toBe(true);
  });

  it('flags word count out of bounds', () => {
    const result = validateMechanical({ subject: 's', body: 'too short', research_detail_used: 'x' }, { wordCount: { min: 60, max: 90 }, banned: [] });
    expect(result.pass).toBe(false);
    expect(result.violations.some(v => /word count/i.test(v))).toBe(true);
  });

  it('flags forbidden opener words', () => {
    const result = validateMechanical({ subject: 's', body: 'Hi Jane, ' + goodE1, research_detail_used: 'x' }, { wordCount: { min: 30, max: 120 }, banned: [] });
    expect(result.pass).toBe(false);
    expect(result.violations.some(v => /opener/i.test(v))).toBe(true);
  });
});

describe('buildSemanticPrompt', () => {
  it('includes dossier, claimed detail, and email body', () => {
    const prompt = buildSemanticPrompt({
      email: { subject: 's', body: 'b', research_detail_used: 'Series B' },
      dossier: { signals: { funding_fact: 'Series B' } } as any,
    });
    expect(prompt).toContain('Series B');
    expect(prompt).toContain('Body: b');
    expect(prompt).toMatch(/templated/i);
  });
});

describe('buildRolePlayPrompt', () => {
  it('frames the recipient persona', () => {
    const prompt = buildRolePlayPrompt({
      email: { subject: 's', body: 'b', research_detail_used: '' },
      recipientName: 'Jane Doe', recipientTitle: 'CMO', recipientCompany: 'Acme',
    });
    expect(prompt).toContain('Jane Doe');
    expect(prompt).toContain('CMO');
    expect(prompt).toContain('Acme');
    expect(prompt).toMatch(/reply.*archive.*unsubscribe/i);
  });
});
