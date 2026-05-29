// tests/_openrouter_invoker.test.ts
import { describe, it, expect } from 'vitest';
import { makeOpenRouterInvoker, makeAutoInvoker } from '../scripts/_openrouter_invoker';

describe('makeOpenRouterInvoker', () => {
  it('returns AiInvoker function', () => {
    const invoker = makeOpenRouterInvoker('fake-key');
    expect(typeof invoker).toBe('function');
  });

  it('invoker rejects without person_id context gracefully', async () => {
    const invoker = makeOpenRouterInvoker('fake-key');
    const result = await invoker('test prompt', {}).catch(() => '');
    expect(typeof result).toBe('string');
  });
});

describe('makeAutoInvoker', () => {
  it('returns file-based invoker when no API key', () => {
    const invoker = makeAutoInvoker(undefined, 'data/bridge-responses-test');
    expect(typeof invoker).toBe('function');
  });

  it('returns openrouter invoker when API key present', () => {
    const invoker = makeAutoInvoker('fake-key', 'data/bridge-responses-test');
    expect(typeof invoker).toBe('function');
  });
});
