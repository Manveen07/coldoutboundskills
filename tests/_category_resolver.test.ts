import { describe, it, expect, vi } from 'vitest';
import { resolveCategory } from '../scripts/_category_resolver';

describe('resolveCategory', () => {
  it('overrides upstream tag when AI infers different category', async () => {
    const aiInvoke = vi.fn().mockResolvedValue('footwear');
    const result = await resolveCategory({
      company_name: 'Chinese Laundry',
      company_description: 'Womens fashion footwear brand',
      upstream_industry: 'mechanical or industrial engineering',
      anchor_map: { home_furniture: 'Serena & Lily', apparel: 'Bombas', footwear: 'Birkenstock' },
    }, aiInvoke);
    expect(result.inferred_category).toBe('footwear');
    expect(result.upstream_was_wrong).toBe(true);
    expect(result.anchor_match).toBe('Birkenstock');
  });

  it('flags when no anchor matches the inferred category', async () => {
    const aiInvoke = vi.fn().mockResolvedValue('supplements');
    const result = await resolveCategory({
      company_name: 'Bloom Nutrition',
      company_description: 'Premium supplements and wellness',
      upstream_industry: 'retail',
      anchor_map: { home_furniture: 'Serena & Lily', apparel: 'Bombas' },
    }, aiInvoke);
    expect(result.anchor_match).toBeNull();
    expect(result.warnings).toContain('no_anchor_match');
  });
});
