import { describe, it, expect } from 'vitest';
import { loadLimits, checkCap } from '../../scripts/pipeline/_limits';

describe('loadLimits', () => {
  it('reads config/limits.yaml without throwing', () => {
    const limits = loadLimits();
    expect(limits.hard_caps.serper_per_run).toBeGreaterThan(0);
    expect(limits.batch_size_default).toBeGreaterThan(0);
  });

  it('throws when config file missing', () => {
    expect(() => loadLimits('/nonexistent/limits.yaml')).toThrow(/not found/i);
  });
});

describe('checkCap', () => {
  const limits = {
    hard_caps: { serper_per_run: 100, prospeo_per_run: 10, leadmagic_per_run: 50 },
    batch_size_default: 10,
    semantic_pass_threshold: 7,
    tier_thresholds: { t2_qual_confidence: 0.8, t3_qual_confidence: 0.9 },
    write_batch_size: 5,
  };

  it('passes when under cap', () => {
    expect(() => checkCap(limits, 'serper_per_run', 50)).not.toThrow();
  });

  it('passes when exactly at cap', () => {
    expect(() => checkCap(limits, 'serper_per_run', 100)).not.toThrow();
  });

  it('throws when over cap', () => {
    expect(() => checkCap(limits, 'serper_per_run', 150)).toThrow(/cap exceeded/i);
  });
});
