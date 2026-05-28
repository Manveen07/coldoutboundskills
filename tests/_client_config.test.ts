import { describe, it, expect } from 'vitest';
import { loadClientConfig, getExcludedDomains, getVerticalAnchors, getPriorityDomains, getCopyStyle, getExampleEmails } from '../scripts/_client_config';
import { resolve } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';

const BW_PROFILE = resolve(process.cwd(), 'profiles/belardi-wong/client-profile.yaml');

describe('loadClientConfig', () => {
  it('loads BW profile without throwing', () => {
    const cfg = loadClientConfig(BW_PROFILE);
    expect(cfg.business.name).toBe('Belardi Wong');
  });

  it('throws on missing file', () => {
    expect(() => loadClientConfig('/nonexistent/path.yaml')).toThrow();
  });
});

describe('getExcludedDomains', () => {
  it('returns competitor domains from BW config', () => {
    const cfg = loadClientConfig(BW_PROFILE);
    const domains = getExcludedDomains(cfg);
    expect(domains).toContain('cohereone.com');
    expect(domains).toContain('postpilot.com');
  });
});

describe('getVerticalAnchors', () => {
  it('returns anchor clients for footwear vertical', () => {
    const cfg = loadClientConfig(BW_PROFILE);
    const anchors = getVerticalAnchors(cfg, 'footwear');
    expect(anchors.some(a => a.includes('Birkenstock'))).toBe(true);
  });

  it('returns empty array for unknown vertical', () => {
    const cfg = loadClientConfig(BW_PROFILE);
    expect(getVerticalAnchors(cfg, 'unknown_vertical')).toEqual([]);
  });
});

describe('getPriorityDomains', () => {
  it('returns array (may be empty)', () => {
    const cfg = loadClientConfig(BW_PROFILE);
    const result = getPriorityDomains(cfg);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('getCopyStyle', () => {
  it('returns copy style with vocab_in/out and banned_phrases', () => {
    const cfg = loadClientConfig(BW_PROFILE);
    const style = getCopyStyle(cfg);
    expect(style).toHaveProperty('vocab_in');
    expect(style).toHaveProperty('vocab_out');
    expect(style).toHaveProperty('banned_phrases');
    expect(style).toHaveProperty('tone');
  });
});

describe('getExampleEmails', () => {
  const TEST_DIR = resolve(process.cwd(), 'profiles/_test-client');

  it('returns empty array when no example-emails.md', () => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    expect(getExampleEmails('_test-client-nonexistent')).toEqual([]);
  });

  it('reads example-emails.md and splits on --- separators', () => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(resolve(TEST_DIR, 'example-emails.md'), '# Header\n\n---\n\nBody one\n\n---\n\nBody two\n', 'utf8');
    const result = getExampleEmails('_test-client');
    expect(result.length).toBe(2);
    expect(result[0]).toContain('Body one');
    expect(result[1]).toContain('Body two');
    rmSync(TEST_DIR, { recursive: true });
  });
});
