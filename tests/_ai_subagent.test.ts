import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openRouterInvoke } from '../scripts/_ai_subagent';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('openRouterInvoke', () => {
  it('returns trimmed content on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        choices: [{ message: { content: '  Brands at that funding stage benchmark fast.  ' } }],
      }),
    } as any);

    const result = await openRouterInvoke('test prompt', 'fake-key');
    expect(result).toBe('Brands at that funding stage benchmark fast.');
  });

  it('throws on non-2xx response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve({}),
    } as any);

    await expect(openRouterInvoke('p', 'k')).rejects.toThrow(/OpenRouter 429/);
  });

  it('returns empty string when choices empty', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ choices: [] }),
    } as any);

    const result = await openRouterInvoke('p', 'k');
    expect(result).toBe('');
  });

  it('passes model + max_tokens + temperature in request body', async () => {
    let capturedBody: any = null;
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      } as any);
    });

    await openRouterInvoke('test', 'k', 'custom-model');
    expect(capturedBody.model).toBe('custom-model');
    expect(capturedBody.max_tokens).toBe(200);
    expect(capturedBody.temperature).toBe(0.3);
    expect(capturedBody.messages[0].content).toBe('test');
  });
});
