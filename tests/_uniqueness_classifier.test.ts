import { describe, it, expect } from 'vitest';
import {
  buildUniquenessPrompt,
  classifyFactUniqueness,
  UNIQUENESS_PROMPT_TEMPLATE,
} from '../scripts/_uniqueness_classifier';
import type { ClassifyFactInput } from '../scripts/_uniqueness_classifier';

const sampleInput: ClassifyFactInput = {
  signal_type: 'funding',
  signal_fact: 'Acme raised $15M Series B led by Sequoia.',
  company_name: 'Acme',
  primary_vertical: 'Activewear',
};

describe('buildUniquenessPrompt', () => {
  it('interpolates all 4 fields correctly', () => {
    const prompt = buildUniquenessPrompt(sampleInput);

    expect(prompt).toContain('funding');
    expect(prompt).toContain('Acme raised $15M Series B led by Sequoia.');
    expect(prompt).toContain('Acme');
    expect(prompt).toContain('Activewear');

    // Template placeholders should all be replaced
    expect(prompt).not.toContain('{signal_type}');
    expect(prompt).not.toContain('{signal_fact}');
    expect(prompt).not.toContain('{company_name}');
    expect(prompt).not.toContain('{primary_vertical}');
  });
});

describe('classifyFactUniqueness', () => {
  it('returns specific_event when mock returns "specific_event"', async () => {
    const aiInvoke = async (_prompt: string) => 'specific_event';
    const verdict = await classifyFactUniqueness(sampleInput, aiInvoke);
    expect(verdict).toBe('specific_event');
  });

  it('returns generic_for_category when mock returns "generic_for_category"', async () => {
    const aiInvoke = async (_prompt: string) => 'generic_for_category';
    const verdict = await classifyFactUniqueness(sampleInput, aiInvoke);
    expect(verdict).toBe('generic_for_category');
  });

  it('returns generic_for_category (fail safe) when mock returns unexpected text', async () => {
    const aiInvoke = async (_prompt: string) => 'I am not sure about this one.';
    const verdict = await classifyFactUniqueness(sampleInput, aiInvoke);
    expect(verdict).toBe('generic_for_category');
  });
});
