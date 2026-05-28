import { describe, it, expect } from 'vitest';
import { runSubagentBatch, parseJsonFromResponse } from '../../scripts/pipeline/_subagent_runner';

describe('parseJsonFromResponse', () => {
  it('extracts JSON object from markdown code fence', () => {
    const text = 'Here is the result:\n```json\n{"a": 1}\n```\nDone.';
    expect(parseJsonFromResponse(text)).toEqual({ a: 1 });
  });

  it('extracts JSON array from bare text', () => {
    const text = 'Result: [{"id": 1}, {"id": 2}]';
    expect(parseJsonFromResponse(text)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('throws on no JSON', () => {
    expect(() => parseJsonFromResponse('no json here')).toThrow();
  });
});

describe('runSubagentBatch', () => {
  it('dispatches in parallel batches of given size', async () => {
    let active = 0;
    let maxActive = 0;
    const dispatch = async (prompt: string) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(r => setTimeout(r, 10));
      active--;
      return `{"prompt": "${prompt}"}`;
    };
    const prompts = ['a', 'b', 'c', 'd', 'e'];
    const results = await runSubagentBatch(prompts, dispatch, { batchSize: 2 });
    expect(results.length).toBe(5);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('retries on failure up to maxRetries', async () => {
    let attempts = 0;
    const dispatch = async () => {
      attempts++;
      if (attempts < 3) throw new Error('transient');
      return '{"ok": true}';
    };
    const results = await runSubagentBatch(['p'], dispatch, { batchSize: 1, maxRetries: 3 });
    expect(results[0].success).toBe(true);
    expect(results[0].retries).toBe(2);
    expect(attempts).toBe(3);
  });

  it('marks failed after exhausting retries', async () => {
    const dispatch = async () => { throw new Error('permanent'); };
    const results = await runSubagentBatch(['p'], dispatch, { batchSize: 1, maxRetries: 2 });
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('permanent');
  });
});
