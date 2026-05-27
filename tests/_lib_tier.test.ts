import { describe, it, expect } from 'vitest';
import { computeTier } from '../scripts/_lib_tier';

describe('tier computation', () => {
  it('T1: VP+ with conf >= 0.80', () => {
    expect(computeTier({ qual_confidence: 0.85, title: 'VP Marketing' })).toBe('T1');
    expect(computeTier({ qual_confidence: 0.92, title: 'CMO' })).toBe('T1');
    expect(computeTier({ qual_confidence: 0.80, title: 'Founder' })).toBe('T1');
  });

  it('T1: Director+ with conf >= 0.90', () => {
    expect(computeTier({ qual_confidence: 0.91, title: 'Director of Growth' })).toBe('T1');
    expect(computeTier({ qual_confidence: 0.89, title: 'Director of Growth' })).toBe('T2');
  });

  it('T1: Head of with conf >= 0.90 (regression for plan-template bug)', () => {
    expect(computeTier({ qual_confidence: 0.91, title: 'Head of Brand' })).toBe('T1');
  });

  it('T2: Director+ with conf 0.70-0.89', () => {
    expect(computeTier({ qual_confidence: 0.75, title: 'Director of Marketing' })).toBe('T2');
    expect(computeTier({ qual_confidence: 0.80, title: 'Head of Brand' })).toBe('T2');
    expect(computeTier({ qual_confidence: 0.85, title: 'Senior Manager' })).toBe('T2');
  });

  it('T2: Manager with conf >= 0.80', () => {
    expect(computeTier({ qual_confidence: 0.82, title: 'Marketing Manager' })).toBe('T2');
    expect(computeTier({ qual_confidence: 0.79, title: 'Marketing Manager' })).toBe('T3');
  });

  it('T3: everyone else qualified', () => {
    expect(computeTier({ qual_confidence: 0.71, title: 'Specialist' })).toBe('T3');
    expect(computeTier({ qual_confidence: 0.75, title: 'Coordinator' })).toBe('T3');
  });

  it('throws if below qualifier floor', () => {
    expect(() => computeTier({ qual_confidence: 0.65, title: 'CMO' }))
      .toThrow(/below qualifier floor/i);
  });
});
