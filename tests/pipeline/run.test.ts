import { describe, it, expect } from 'vitest';
import { parsePipelineArgs } from '../../scripts/pipeline/run';

describe('parsePipelineArgs', () => {
  it('parses --client and --category', () => {
    const args = parsePipelineArgs(['node', 'run.ts', '--client', 'mythic', '--category', 'qsr']);
    expect(args.client).toBe('mythic');
    expect(args.category).toBe('qsr');
    expect(args.smoke).toBe(false);
    expect(args.dryRun).toBe(false);
    expect(args.offline).toBe(false);
  });

  it('parses --smoke flag', () => {
    const args = parsePipelineArgs(['node', 'run.ts', '--client', 'mythic', '--category', 'qsr', '--smoke']);
    expect(args.smoke).toBe(true);
  });

  it('parses --dry-run flag', () => {
    const args = parsePipelineArgs(['node', 'run.ts', '--client', 'mythic', '--category', 'qsr', '--dry-run']);
    expect(args.dryRun).toBe(true);
  });

  it('throws when --client missing', () => {
    expect(() => parsePipelineArgs(['node', 'run.ts', '--category', 'qsr'])).toThrow(/client/i);
  });

  it('throws when --category missing', () => {
    expect(() => parsePipelineArgs(['node', 'run.ts', '--client', 'mythic'])).toThrow(/category/i);
  });
});
