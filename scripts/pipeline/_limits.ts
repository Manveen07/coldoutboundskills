import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';

export interface Limits {
  hard_caps: {
    serper_per_run: number;
    prospeo_per_run: number;
    leadmagic_per_run: number;
  };
  batch_size_default: number;
  semantic_pass_threshold: number;
  tier_thresholds: {
    t2_qual_confidence: number;
    t3_qual_confidence: number;
  };
  write_batch_size: number;
}

export function loadLimits(path?: string): Limits {
  const p = path ?? resolve(process.cwd(), 'config/limits.yaml');
  if (!existsSync(p)) {
    throw new Error(`Limits config not found: ${p}`);
  }
  return yaml.load(readFileSync(p, 'utf8')) as Limits;
}

export function checkCap(limits: Limits, key: keyof Limits['hard_caps'], plannedCount: number): void {
  const cap = limits.hard_caps[key];
  if (plannedCount > cap) {
    throw new Error(`Cap exceeded: ${key} planned=${plannedCount} cap=${cap}. Aborting run.`);
  }
}
