import { describe, it, expect } from 'vitest';
import { buildGateSummary } from '../scripts/_quality_gate';

const SAMPLE_ROWS = [
  { person_id: 'a', company_name: 'AcmeCo', signal_used: 'funding', signal_bridge: 'Funded brands...', email1_body: 'Hello world', email: 'a@acme.com' },
  { person_id: 'b', company_name: 'BetaCo', signal_used: 'fallback', signal_bridge: '', email1_body: 'Hello world', email: '' },
  { person_id: 'c', company_name: 'GammaCo', signal_used: 'press', signal_bridge: 'Press coverage...', email1_body: 'Hello world', email: 'c@gamma.com' },
];

describe('buildGateSummary', () => {
  it('counts total leads', () => {
    const s = buildGateSummary(SAMPLE_ROWS, 'belardi-wong', 'footwear');
    expect(s.total_leads).toBe(3);
  });

  it('computes signal coverage percent', () => {
    const s = buildGateSummary(SAMPLE_ROWS, 'belardi-wong', 'footwear');
    expect(s.signal_coverage_pct).toBeCloseTo(66.7, 0);
  });

  it('counts revealed emails', () => {
    const s = buildGateSummary(SAMPLE_ROWS, 'belardi-wong', 'footwear');
    expect(s.emails_revealed).toBe(2);
  });

  it('picks a sample lead', () => {
    const s = buildGateSummary(SAMPLE_ROWS, 'belardi-wong', 'footwear');
    expect(s.sample_lead).toBeDefined();
    expect(s.sample_lead.person_id).toBeDefined();
  });
});
