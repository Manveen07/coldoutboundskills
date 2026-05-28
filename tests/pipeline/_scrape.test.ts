import { describe, it, expect } from 'vitest';
import { detectTechSignals, extractRecentInitiative, extractSocialProof } from '../../scripts/pipeline/_scrape';

const HTML_WITH_KLAVIYO = `
<html>
  <head>
    <script src="https://static.klaviyo.com/onsite.js"></script>
    <script src="https://cdn.attentive.com/loader.js"></script>
  </head>
  <body>
    <h1>New 2026 Spring Collection</h1>
    <p>Trusted by 300+ premium brands.</p>
  </body>
</html>
`;

describe('detectTechSignals', () => {
  it('detects Klaviyo from script src', () => {
    expect(detectTechSignals(HTML_WITH_KLAVIYO)).toContain('Klaviyo');
  });
  it('detects Attentive from script src', () => {
    expect(detectTechSignals(HTML_WITH_KLAVIYO)).toContain('Attentive');
  });
  it('returns empty array when no signals match', () => {
    expect(detectTechSignals('<html></html>')).toEqual([]);
  });
});

describe('extractRecentInitiative', () => {
  it('finds dated campaign mentions in headlines', () => {
    expect(extractRecentInitiative(HTML_WITH_KLAVIYO)).toMatch(/2026 Spring Collection/i);
  });
  it('returns null when no initiative phrasing found', () => {
    expect(extractRecentInitiative('<html><body><p>About us</p></body></html>')).toBeNull();
  });
});

describe('extractSocialProof', () => {
  it('finds testimonial-style numeric claims', () => {
    const proof = extractSocialProof(HTML_WITH_KLAVIYO);
    expect(proof.some(p => p.includes('300+'))).toBe(true);
  });
});
