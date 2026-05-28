import { describe, it, expect } from 'vitest';
import { buildWriterPrompt } from '../../scripts/pipeline/_write';
import type { ResearchDossier } from '../../scripts/pipeline/_research';
import type { ClientConfig } from '../../scripts/_client_config';

const SAMPLE_DOSSIER: ResearchDossier = {
  tier: 'T2',
  person: { person_id: 'p1', full_name: 'Jane Doe', title: 'CMO', seniority: 'C-suite', linkedin_url: '' },
  company: { name: 'Acme', domain: 'acme.com', industry: 'Restaurants', headcount_range: '500-1000', location: 'NYC' },
  signals: { funding_fact: 'Acme raised $10M Series B', press_facts: [], acquisition_fact: null, category_snippet: null },
  scrape: null,
  person_depth: { person_quote: null, recent_post_topic: null, public_speaking_topics: [], career_pivot_signal: null },
};

const SAMPLE_CFG = {
  business: { name: 'Mythic', website: '', one_liner: 'Brand and performance agency.', tone: 'peer-to-peer' },
  offer: { primary_product: 'Growth Codes audit', primary_cta: 'Worth 30 min?', value_prop: 'Surfaces decisions suppressing growth', lead_magnet: '' },
  legal: { banned_words: ['guarantee', 'ROI'] },
  copy_tone: { in_vocabulary: ['share of voice'], out_vocabulary: ['leverage', 'synergy'] },
} as any as ClientConfig;

describe('buildWriterPrompt', () => {
  it('embeds business name, dossier, and rules', () => {
    const prompt = buildWriterPrompt({ dossier: SAMPLE_DOSSIER, cfg: SAMPLE_CFG, exampleEmails: [], firstName: 'Jane' });
    expect(prompt).toContain('Mythic');
    expect(prompt).toContain('Jane');
    expect(prompt).toContain('Acme');
    expect(prompt).toContain('Series B');
    expect(prompt).toMatch(/No em dashes/i);
    expect(prompt).toMatch(/exactly ONE specific research detail/i);
    expect(prompt).toContain('guarantee');
    expect(prompt).toContain('share of voice');
  });

  it('includes example emails when provided', () => {
    const examples = ['EXAMPLE EMAIL 1 BODY', 'EXAMPLE EMAIL 2 BODY'];
    const prompt = buildWriterPrompt({ dossier: SAMPLE_DOSSIER, cfg: SAMPLE_CFG, exampleEmails: examples, firstName: 'Jane' });
    expect(prompt).toContain('EXAMPLE EMAIL 1 BODY');
    expect(prompt).toContain('EXAMPLE EMAIL 2 BODY');
  });

  it('forbids mentioning business name or product in first 3 sentences', () => {
    const prompt = buildWriterPrompt({ dossier: SAMPLE_DOSSIER, cfg: SAMPLE_CFG, exampleEmails: [], firstName: 'Jane' });
    expect(prompt).toMatch(/must NOT mention Mythic/i);
    expect(prompt).toMatch(/Growth Codes audit/i);
  });
});
