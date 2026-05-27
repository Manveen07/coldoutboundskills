import type { AiInvoker } from './_bridge_writer';

export interface CategoryInput {
  company_name: string;
  company_description?: string;
  upstream_industry?: string;
  anchor_map: Record<string, string>;
}

export interface CategoryResult {
  inferred_category: string;
  upstream_was_wrong: boolean;
  anchor_match: string | null;
  warnings: string[];
}

const CATEGORY_PROMPT = `You categorize a company into ONE of these categories based on its name + description.

Valid categories: {categories}

Company name: {company_name}
Description: {description}
Upstream provider tagged this as: {upstream}

Respond with EXACTLY one category name from the list above. Nothing else.`;

export async function resolveCategory(input: CategoryInput, aiInvoke: AiInvoker): Promise<CategoryResult> {
  const categories = Object.keys(input.anchor_map);
  const prompt = CATEGORY_PROMPT
    .replace('{categories}', categories.join(', '))
    .replace('{company_name}', input.company_name)
    .replace('{description}', input.company_description || '(no description)')
    .replace('{upstream}', input.upstream_industry || '(no upstream tag)');

  const raw = (await aiInvoke(prompt)).trim().toLowerCase();
  const inferred = categories.find(c => c.toLowerCase() === raw) || raw;

  const upstream_was_wrong = Boolean(input.upstream_industry && !input.upstream_industry.toLowerCase().includes(inferred));
  const anchor_match = input.anchor_map[inferred] || null;

  const warnings: string[] = [];
  if (upstream_was_wrong) warnings.push('upstream_industry_mismatch');
  if (!anchor_match) warnings.push('no_anchor_match');

  return {
    inferred_category: inferred,
    upstream_was_wrong,
    anchor_match,
    warnings,
  };
}
