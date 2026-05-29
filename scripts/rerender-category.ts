// ---------------------------------------------------------------------------
// Re-render a category CSV through the updated v5 pipeline.
//
// Usage:
//   npx tsx scripts/rerender-category.ts <smartlead-campaign.csv> <output.csv> [signals-dir]
//
// Input:  existing Smartlead-format CSV (has email1_body … email4_body from old render)
// Output: same CSV with email columns replaced by updated render
//
// Writes a quality diff to <output>.diff.md showing 3 before/after samples.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { parseCsv, writeCsv } from './_csv_io';
import { renderLead, type LeadInput } from './render-with-signals';
import { StatRotator } from './_stat_rotator';

// Stub aiInvoker — bridges degrade gracefully to fallback when no response file exists.
// For production, replace with makeFileBasedInvoker pointing to real bridge responses.
const stubAiInvoker = async (_prompt: string, _id: string): Promise<string> => '';

function generateDiffMd(
  rows: Record<string, string>[],
  newRows: Record<string, string>[],
  outputPath: string,
): string {
  const sampleCount = Math.min(3, rows.length);
  const lines: string[] = [
    '# Quality Diff — Before vs After Pipeline v5',
    '',
    `Category: ${rows[0]?.primary_vertical || 'unknown'} | Vertical anchor: ${rows[0]?.vertical_anchor || 'unknown'}`,
    `Re-rendered: ${newRows.length} leads | Signals: company-level (fallback for this category)`,
    '',
    '## What changed',
    '',
    '- **Fix #1** — Signal facts now first-sentence only; pronoun-led facts rejected',
    '- **Fix #2** — Bridge sentences must name subject in first 4 words',
    '- **Fix #3** — Bridge sentences: no scraped numbers repeated; hedge words only when predicting behavior',
    '- **Fix #4** — Anchor proof compressed to first sentence when a signal bridge is present (one proof-point rule)',
    '- **Fix #5** — Generic category facts (e.g. "brand offers premium products") filtered before bridge generation',
    '- **Amendment 7** — E2 is now a threaded follow-up (empty subject, bumps thread, ≤65 words)',
    '- **StatRotator** — E1 and E2 always use distinct stats',
    '',
    '---',
    '',
    '## Before / After samples',
    '',
  ];

  for (let i = 0; i < sampleCount; i++) {
    const old = rows[i];
    const updated = newRows[i];
    lines.push(`### Lead ${i + 1}: ${old.first_name} ${old.last_name} — ${old.company_name}`);
    lines.push('');
    lines.push('**OLD Email 1**');
    lines.push('```');
    lines.push(`Subject: ${old.email1_subject}`);
    lines.push('');
    lines.push(old.email1_body || '(empty)');
    lines.push('```');
    lines.push('');
    lines.push('**NEW Email 1**');
    lines.push('```');
    lines.push(`Subject: ${updated.email1_subject}`);
    lines.push('');
    lines.push(updated.email1_body || '(empty)');
    lines.push('```');
    lines.push('');
    lines.push('**OLD Email 2**');
    lines.push('```');
    lines.push(`Subject: ${old.email2_subject}`);
    lines.push('');
    lines.push(old.email2_body || '(empty)');
    lines.push('```');
    lines.push('');
    lines.push('**NEW Email 2** *(threaded — empty subject)*');
    lines.push('```');
    lines.push(`Subject: ${updated.email2_subject || '(threaded — empty)'}`);
    lines.push('');
    lines.push(updated.email2_body || '(empty)');
    lines.push('```');
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  const diffPath = outputPath.replace(/\.csv$/, '.diff.md');
  writeFileSync(diffPath, lines.join('\n'));
  return diffPath;
}

async function main() {
  const inputCsv = process.argv[2];
  const outputCsv = process.argv[3];
  const signalsDir = process.argv[4] || 'data/signals';

  if (!inputCsv || !outputCsv) {
    console.error('Usage: npx tsx scripts/rerender-category.ts <input.csv> <output.csv> [signals-dir]');
    process.exit(1);
  }

  const { headers, rows } = parseCsv(readFileSync(inputCsv, 'utf8'));
  const rotator = new StatRotator();

  const emailCols = ['email1_subject', 'email1_body', 'email2_subject', 'email2_body',
                     'email3_subject', 'email3_body', 'email4_subject', 'email4_body'];

  const newRows: Record<string, string>[] = [];
  let done = 0;
  let errors = 0;

  for (const row of rows) {
    // Build a synthetic person_id if not present
    const person_id = row.person_id || `${row.company_domain}_${row.first_name}`.replace(/[^a-z0-9_]/gi, '_');

    const lead: LeadInput = {
      person_id,
      first_name: row.first_name || '',
      full_name: row.full_name || `${row.first_name} ${row.last_name}`,
      current_job_title: row.current_job_title || '',
      company_name: row.company_name || '',
      company_domain: row.company_domain || '',
      qual_confidence: parseFloat(row.qual_confidence || '0.7'),
      primary_vertical: row.primary_vertical || '',
      assigned_variant: (row.assigned_variant as 'B' | 'C') || 'B',
      vertical_anchor: row.vertical_anchor || undefined,
      ai_similarity_dimension: row.ai_similarity_dimension || undefined,
      ai_brand_category: row.ai_brand_category || undefined,
      ai_role_hook: row.ai_role_hook || '',
    };

    try {
      const rendered = await renderLead(lead, stubAiInvoker, signalsDir, rotator);

      newRows.push({
        ...row,
        email1_subject: rendered.email1_subject,
        email1_body: rendered.email1_body,
        email2_subject: rendered.email2_subject,
        email2_body: rendered.email2_body,
        email3_subject: rendered.email3_subject,
        email3_body: rendered.email3_body,
        email4_subject: rendered.email4_subject,
        email4_body: rendered.email4_body,
      });

      console.error(`✓ ${row.first_name} ${row.last_name} (${row.company_name}) — signal: ${rendered.signal_used}`);
      done++;
    } catch (err) {
      console.error(`✗ ${row.first_name} ${row.last_name}: ${err}`);
      newRows.push(row); // keep old row on error
      errors++;
    }
  }

  const outHeaders = [
    ...headers.filter(h => !emailCols.includes(h)),
    ...emailCols,
  ];

  writeFileSync(outputCsv, writeCsv(newRows, outHeaders));
  const diffPath = generateDiffMd(rows, newRows, outputCsv);

  console.error(`\nDone. Re-rendered: ${done} | Errors: ${errors}`);
  console.error(`Output CSV: ${outputCsv}`);
  console.error(`Quality diff: ${diffPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
