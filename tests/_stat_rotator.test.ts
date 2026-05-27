import { describe, it, expect } from 'vitest';
import { StatRotator } from '../scripts/_stat_rotator';

describe('StatRotator', () => {
  it('returns different stats across 4 emails for same lead', () => {
    const r = new StatRotator();
    const e1 = r.nextFor('pid_1');
    const e2 = r.nextFor('pid_1');
    const e3 = r.nextFor('pid_1');
    const e4 = r.nextFor('pid_1');
    expect(new Set([e1, e2, e3, e4]).size).toBe(4);
  });

  it('different leads can use same stat in slot 1', () => {
    const r = new StatRotator();
    const a = r.nextFor('pid_a');
    const b = r.nextFor('pid_b');
    expect(typeof a).toBe('string');
    expect(typeof b).toBe('string');
  });

  it('throws when pool exhausted for a lead', () => {
    const r = new StatRotator(['only_one']);
    r.nextFor('pid_x');
    expect(() => r.nextFor('pid_x')).toThrow(/exhausted/i);
  });
});
