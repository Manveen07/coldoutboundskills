import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { initRunDir, writeArtifact, runDirName, appendLog } from '../../scripts/pipeline/_run_artifacts';

const BASE = resolve(__dirname, '../../data/runs-test');

beforeEach(() => { if (existsSync(BASE)) rmSync(BASE, { recursive: true }); });
afterEach(() => { if (existsSync(BASE)) rmSync(BASE, { recursive: true }); });

describe('runDirName', () => {
  it('formats timestamp + client + category', () => {
    const name = runDirName('mythic', 'qsr', new Date('2026-05-28T14:30:00Z'));
    expect(name).toMatch(/2026-05-28-\d{4}-mythic-qsr/);
  });
});

describe('initRunDir', () => {
  it('creates the run directory', () => {
    const dir = initRunDir('mythic', 'qsr', BASE);
    expect(existsSync(dir)).toBe(true);
  });
});

describe('writeArtifact', () => {
  it('writes JSON artifact to the run directory', () => {
    const dir = initRunDir('mythic', 'qsr', BASE);
    writeArtifact(dir, 'preflight.json', { credits: 100 });
    const content = JSON.parse(readFileSync(resolve(dir, 'preflight.json'), 'utf8'));
    expect(content.credits).toBe(100);
  });

  it('writes text artifact when payload is string', () => {
    const dir = initRunDir('mythic', 'qsr', BASE);
    writeArtifact(dir, 'locked-prompts.md', '# Prompts\n\nLocked.');
    const content = readFileSync(resolve(dir, 'locked-prompts.md'), 'utf8');
    expect(content).toContain('# Prompts');
  });
});

describe('appendLog', () => {
  it('appends multiple lines to pipeline.log', () => {
    const dir = initRunDir('mythic', 'qsr', BASE);
    appendLog(dir, 'line one');
    appendLog(dir, 'line two');
    const log = readFileSync(resolve(dir, 'pipeline.log'), 'utf8');
    expect(log).toContain('line one');
    expect(log).toContain('line two');
  });
});
