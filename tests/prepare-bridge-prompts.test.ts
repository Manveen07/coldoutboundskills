import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { generateBridgeTasks } from '../scripts/prepare-bridge-prompts';
import { writeSidecar } from '../scripts/_lib_signals';

const TEST_DIR = resolve(__dirname, '../data/prepare-bridge-prompts-test');
const RESPONSES_DIR = resolve(__dirname, '../data/prepare-bridge-prompts-test-responses');

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
  if (existsSync(RESPONSES_DIR)) rmSync(RESPONSES_DIR, { recursive: true });
  mkdirSync(RESPONSES_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  if (existsSync(RESPONSES_DIR)) rmSync(RESPONSES_DIR, { recursive: true });
});

function writeFundingSidecar(domain: string) {
  writeSidecar(domain, {
    schema_version: '1.0',
    domain,
    fetched_at: new Date().toISOString(),
    funding: { fact: `${domain} raised $10M Series A.`, found: true, freshness_days: 30 },
    company_snippet: { fact: `${domain} snippet.` },
  }, TEST_DIR);
}

function writeSnippetOnlySidecar(domain: string) {
  writeSidecar(domain, {
    schema_version: '1.0',
    domain,
    fetched_at: new Date().toISOString(),
    company_snippet: { fact: `${domain}: premium DTC.` },
  }, TEST_DIR);
}

describe('generateBridgeTasks', () => {
  it('generates one task per lead with funding signal', async () => {
    writeFundingSidecar('a.com');
    writeFundingSidecar('b.com');
    writeFundingSidecar('c.com');

    const rows = [
      { person_id: 'p1', first_name: 'Alex', company_name: 'A', company_domain: 'a.com' },
      { person_id: 'p2', first_name: 'Bea',  company_name: 'B', company_domain: 'b.com' },
      { person_id: 'p3', first_name: 'Cal',  company_name: 'C', company_domain: 'c.com' },
    ];

    const tasks = await generateBridgeTasks(rows, TEST_DIR, RESPONSES_DIR);

    expect(tasks.length).toBe(3);
    for (const t of tasks) {
      expect(t.signal_used).toBe('funding');
      expect(t.prompt).toContain(t.signal_fact);
      expect(t.prompt).toContain(t.company_name);
      expect(t.prompt).toContain(t.first_name);
      expect(t.response_file).toContain(t.person_id);
      expect(t.status).toBe('pending');
    }
  });

  it('skips leads whose selected signal is fallback (no sidecar)', async () => {
    // no sidecar written for nofile.com → readSidecar returns null → skip
    const rows = [
      { person_id: 'p_fb', first_name: 'F', company_name: 'F', company_domain: 'nofile.com' },
    ];

    const tasks = await generateBridgeTasks(rows, TEST_DIR, RESPONSES_DIR);

    expect(tasks.length).toBe(0);
  });

  it('skips leads whose selected signal is company_snippet', async () => {
    writeSnippetOnlySidecar('snip.com');

    const rows = [
      { person_id: 'p_snip', first_name: 'S', company_name: 'Snip', company_domain: 'snip.com' },
    ];

    const tasks = await generateBridgeTasks(rows, TEST_DIR, RESPONSES_DIR);

    expect(tasks.length).toBe(0);
  });

  it('writes correct schema_version and ISO generated_at when serialized', async () => {
    writeFundingSidecar('a.com');
    const rows = [
      { person_id: 'p1', first_name: 'A', company_name: 'A', company_domain: 'a.com' },
    ];
    const tasks = await generateBridgeTasks(rows, TEST_DIR, RESPONSES_DIR);

    const file = {
      schema_version: '1.0',
      generated_at: new Date().toISOString(),
      tasks,
    };

    expect(file.schema_version).toBe('1.0');
    expect(file.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(file.tasks.length).toBe(1);
  });

  it('with aiInvoke always returning generic_for_category → task list is empty', async () => {
    writeFundingSidecar('a.com');
    writeFundingSidecar('b.com');

    const rows = [
      { person_id: 'p1', first_name: 'Alex', company_name: 'A', company_domain: 'a.com', primary_vertical: 'Activewear' },
      { person_id: 'p2', first_name: 'Bea',  company_name: 'B', company_domain: 'b.com', primary_vertical: 'Swimwear' },
    ];

    const aiInvoke = async (_prompt: string) => 'generic_for_category';
    const tasks = await generateBridgeTasks(rows, TEST_DIR, RESPONSES_DIR, aiInvoke);

    expect(tasks.length).toBe(0);
  });

  it('with aiInvoke always returning specific_event → task list same as without aiInvoke', async () => {
    writeFundingSidecar('a.com');
    writeFundingSidecar('b.com');

    const rows = [
      { person_id: 'p1', first_name: 'Alex', company_name: 'A', company_domain: 'a.com', primary_vertical: 'Activewear' },
      { person_id: 'p2', first_name: 'Bea',  company_name: 'B', company_domain: 'b.com', primary_vertical: 'Swimwear' },
    ];

    const aiInvoke = async (_prompt: string) => 'specific_event';
    const tasksWithClassify = await generateBridgeTasks(rows, TEST_DIR, RESPONSES_DIR, aiInvoke);
    const tasksWithout = await generateBridgeTasks(rows, TEST_DIR, RESPONSES_DIR);

    expect(tasksWithClassify.length).toBe(tasksWithout.length);
    expect(tasksWithClassify.map(t => t.person_id)).toEqual(tasksWithout.map(t => t.person_id));
  });

  it('without aiInvoke → classification skipped, same behavior as current', async () => {
    writeFundingSidecar('a.com');

    const rows = [
      { person_id: 'p1', first_name: 'Alex', company_name: 'A', company_domain: 'a.com', primary_vertical: 'Activewear' },
    ];

    // No aiInvoke passed
    const tasks = await generateBridgeTasks(rows, TEST_DIR, RESPONSES_DIR);

    expect(tasks.length).toBe(1);
    expect(tasks[0].person_id).toBe('p1');
  });
});
