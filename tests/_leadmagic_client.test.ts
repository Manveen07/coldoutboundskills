import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findEmail, RATE_LIMIT_MS } from '../scripts/_leadmagic_client';

describe('_leadmagic_client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('RATE_LIMIT_MS enforces 5 req/s ceiling', () => {
    expect(RATE_LIMIT_MS).toBeGreaterThanOrEqual(200);
  });

  it('returns email from email-finder on success', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ email: 'jane@acme.com', email_status: 'verified', credits_used: 1 }),
    });

    const result = await findEmail(
      { first_name: 'Jane', last_name: 'Doe', company_domain: 'acme.com' },
      'test-key',
    );

    expect(result.email).toBe('jane@acme.com');
    expect(result.confidence).toBe('verified');
    expect(result.source).toBe('email-finder');
    expect(result.credits_used).toBe(1);
  });

  it('falls back to profile-finder when email-finder returns no email', async () => {
    (fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ email: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ email: 'jane@acme.com', email_status: 'likely', credits_used: 1 }),
      });

    const result = await findEmail(
      {
        first_name: 'Jane',
        last_name: 'Doe',
        company_domain: 'acme.com',
        linkedin_url: 'https://linkedin.com/in/janedoe',
      },
      'test-key',
    );

    expect(result.email).toBe('jane@acme.com');
    expect(result.source).toBe('profile-finder');
    expect(result.confidence).toBe('likely');
  });

  it('returns null email when both finders find nothing', async () => {
    (fetch as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ email: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ email: null }) });

    const result = await findEmail(
      {
        first_name: 'Jane',
        last_name: 'Doe',
        company_domain: 'acme.com',
        linkedin_url: 'https://linkedin.com/in/janedoe',
      },
      'test-key',
    );

    expect(result.email).toBeNull();
    expect(result.source).toBe('none');
    expect(result.credits_used).toBe(0);
  });

  it('returns none source when email-finder fails and no linkedin_url', async () => {
    (fetch as any).mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'rate limit' });

    const result = await findEmail(
      { first_name: 'Jane', last_name: 'Doe', company_domain: 'acme.com' },
      'test-key',
    );

    expect(result.email).toBeNull();
    expect(result.source).toBe('none');
  });

  it('maps accept_all status to likely confidence', async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ email: 'j@acme.com', email_status: 'accept_all', credits_used: 1 }),
    });

    const result = await findEmail(
      { first_name: 'Jane', last_name: 'Doe', company_domain: 'acme.com' },
      'test-key',
    );

    expect(result.confidence).toBe('likely');
  });
});
