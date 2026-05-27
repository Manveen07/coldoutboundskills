import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { makeFileBasedInvoker } from '../scripts/_file_based_invoker';
import { writeBridgeSentence } from '../scripts/_bridge_writer';

const RESPONSES_DIR = resolve(__dirname, '../data/file-based-invoker-test');

beforeEach(() => {
  if (existsSync(RESPONSES_DIR)) rmSync(RESPONSES_DIR, { recursive: true });
  mkdirSync(RESPONSES_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(RESPONSES_DIR)) rmSync(RESPONSES_DIR, { recursive: true });
});

describe('makeFileBasedInvoker', () => {
  it('reads existing response file correctly', async () => {
    writeFileSync(
      resolve(RESPONSES_DIR, 'pid_123.txt'),
      'Brands at the funding stage you are at benchmark fast.\n'
    );

    const invoke = makeFileBasedInvoker(RESPONSES_DIR);
    const result = await invoke('the prompt is ignored', { person_id: 'pid_123' });

    expect(result).toBe('Brands at the funding stage you are at benchmark fast.');
  });

  it('throws helpful error when response file missing', async () => {
    const invoke = makeFileBasedInvoker(RESPONSES_DIR);
    await expect(
      invoke('prompt', { person_id: 'missing_pid' })
    ).rejects.toThrow(/No bridge response found at.*missing_pid\.txt/);
  });

  it('FALLBACK marker triggers banned-word rejection downstream', async () => {
    writeFileSync(resolve(RESPONSES_DIR, 'pid_fallback.txt'), 'FALLBACK\n');

    const invoke = makeFileBasedInvoker(RESPONSES_DIR);
    const result = await writeBridgeSentence(
      {
        signal_used: 'funding',
        signal_fact: 'X raised funding.',
        company_name: 'X',
        first_name: 'A',
      },
      invoke,
      2,
      { person_id: 'pid_fallback' }
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/banned word/i);
  });
});
