# Sub-Agent Runbook

Step-by-step protocol for Claude Code sub-agents dispatched into this pipeline.
Read this before doing any work. The pipeline is in `scripts/pipeline/`.

## Before you do ANYTHING

1. **Check cache** — `npx tsx scripts/pipeline/cache-stats.ts`. If facts are already
   cached, you may be able to do your task with zero API spend.
2. **Read the client profile** — `profiles/{client}/client-profile.yaml`. Never
   modify it without explicit user instruction.
3. **Dry-run first** — `npx tsx scripts/pipeline/run.ts --client X --category Y --dry-run`
   verifies wiring without spending any credits.

## Common tasks

### Task: Pull leads + score them

```bash
npx tsx scripts/pipeline/run.ts --client mythic --category qsr --smoke
```

What happens:
- Stage 1 (Prospeo) — pulls up to 10 pages, 25 leads each = up to 250 leads
- Stage 2 (sub-agent) — scores them against the ICP prompt
- Preflight prompt shows the cost before proceeding
- Smoke runs Stages 3-5 on 3 leads, asks before doing the rest

### Task: Re-render emails after fixing the writer prompt

```bash
npx tsx scripts/pipeline/run.ts --client mythic --category qsr --offline
```

`--offline` means: use cached Prospeo + Serper + scrape responses. New writer
prompts go to sub-agents (free). Zero API credits spent.

### Task: Bug in the extractor, need to re-extract from existing cache

Same as above — `--offline` replays everything from the disk cache.

### Task: Find which leads failed and why

```bash
cat data/runs/{latest-run-dir}/failures.json
```

Each failure has `person_id`, `stage` (`write`, `validate`, etc.), and either
`error` or `reports` (validator findings).

## Anti-patterns (don't do these)

- **Don't call Prospeo or Serper directly in a script.** Use `scripts/pipeline/_pull.ts`
  and `scripts/pipeline/_research.ts` which go through the cache layer.
- **Don't write parsers that throw away raw responses.** If you need a new
  extractor, write it to read from the cached raw responses; the cache layer
  saves the raw payload to disk BEFORE parsing for exactly this case.
- **Don't bypass the preflight gate.** It's there to catch the "about to burn
  800 credits because of a config bug" case.
- **Don't run Serper without checking the cache first.** Most of what you need
  is probably already there.
- **Don't modify `profiles/{client}/client-profile.yaml`** unless the user
  explicitly asked you to. Stages read from it as the source of truth.

## File layout cheat sheet

| File | Purpose |
|------|---------|
| `scripts/pipeline/run.ts` | Orchestrator. Start here. |
| `scripts/pipeline/_pull.ts` | Stage 1: Prospeo pull |
| `scripts/pipeline/_score.ts` | Stage 2: ICP scorer |
| `scripts/pipeline/_web_research.ts` | Stage 3a: free web research |
| `scripts/pipeline/_research.ts` | Stage 3: Serper signal extraction (gap-fill) |
| `scripts/pipeline/_scrape.ts` | Stage 3c: free HTTP scrape |
| `scripts/pipeline/_write.ts` | Stage 4: Opus sub-agent writer |
| `scripts/pipeline/_validate.ts` | Stage 5: 3-stage validator |
| `scripts/pipeline/_cache.ts` | Generic write-before-parse cache layer |
| `scripts/pipeline/_credit_guard.ts` | Pre-flight cost estimate |
| `scripts/pipeline/_smoke.ts` | 3-lead smoke runner |
| `scripts/pipeline/_run_artifacts.ts` | Run directory + log writer |
| `scripts/pipeline/_limits.ts` | Loads `config/limits.yaml` hard caps |
| `scripts/pipeline/recover.ts` | Cache stats + per-domain wipe |
| `scripts/pipeline/cache-stats.ts` | Cache audit |
| `profiles/{client}/client-profile.yaml` | Per-client config — source of truth |
| `profiles/{client}/icp-prompt.txt` | Per-client ICP qualifier prompt |
| `profiles/{client}/example-emails.md` | 3-5 voice anchors for Stage 4 writer |
| `config/limits.yaml` | Hard caps, batch sizes, tier thresholds |
| `data/research-cache/` | All API responses cached here |
| `data/runs/` | Per-run artifacts (preflight, log, output, dossiers) |

## When something goes wrong

1. **Read `data/runs/{latest}/pipeline.log`** — every API call and sub-agent
   dispatch is logged with timestamp.
2. **Read `data/runs/{latest}/failures.json`** — leads that didn't finish.
3. **Check `data/research-cache/{serper|prospeo|scrape}/{domain}--*.json`** —
   raw responses. If the parser is wrong, the data is still here.
4. **Re-run with `--offline`** to test fixes without burning credits.

## When the user asks you to "build a new client"

1. Run `/icp-onboarding`
2. Run `/icp-prompt-builder`
3. Manually create `profiles/{client}/example-emails.md` with 3-5 example emails
4. Run `npx tsx scripts/pipeline/run.ts --client {new} --category {vertical} --smoke`
5. Show the smoke output to the user before continuing
