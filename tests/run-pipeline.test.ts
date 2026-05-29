import { describe, it, expect } from 'vitest';
import { parseCliArgs } from '../scripts/run-pipeline';

describe('parseCliArgs', () => {
  it('parses --client and --category', () => {
    const args = parseCliArgs(['node', 'run-pipeline.ts', '--client', 'belardi-wong', '--category', 'footwear']);
    expect(args.client).toBe('belardi-wong');
    expect(args.category).toBe('footwear');
    expect(args.dryRun).toBe(false);
  });

  it('parses --dry-run flag', () => {
    const args = parseCliArgs(['node', 'run-pipeline.ts', '--client', 'belardi-wong', '--category', 'footwear', '--dry-run']);
    expect(args.dryRun).toBe(true);
  });

  it('throws when --client missing', () => {
    expect(() => parseCliArgs(['node', 'run-pipeline.ts', '--category', 'footwear'])).toThrow('--client');
  });

  it('throws when --category missing', () => {
    expect(() => parseCliArgs(['node', 'run-pipeline.ts', '--client', 'belardi-wong'])).toThrow('--category');
  });
});
