# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A collection of 28 Claude Code skills for cold email — strategy, infrastructure, list building, copy, and iteration. Skills are invoked via `/skill-name` in Claude Code. There is no application server or build step.

## Setup

```bash
cp .env.example .env
# Fill in only the keys needed for the skills you'll use
npm install -g tsx
cd skills/cold-email-starter-kit && npm install
```

Verify credentials: `npx tsx skills/cold-email-starter-kit/scripts/verify-credentials.ts`

## Running scripts

All scripts use `tsx` (TypeScript runner, no compile step):

```bash
npx tsx skills/<skill-name>/scripts/<script-name>.ts
```

Each script reads credentials from the nearest `.env` (loaded via `_lib.ts:loadEnv()`). No global env injection needed.

## Skill architecture

Each skill lives in `skills/<skill-name>/` and contains:
- `SKILL.md` — the skill definition loaded by Claude Code (frontmatter `name:` + `description:` fields)
- `scripts/` — TypeScript scripts the skill invokes via Bash tool calls
- `references/` — supporting markdown the skill reads as context (some skills only)

Skills are pure Claude Code instructions — no framework, no bundler. The `SKILL.md` frontmatter is what registers a skill with Claude Code.

## Shared library

`skills/cold-email-starter-kit/scripts/_lib.ts` is the shared utility module for all scripts. It exports: `loadEnv`, `readCsv`, `writeCsv`, `sleep`, `retry`, `confirm`, `chunkArray`. Scripts in other skill folders that need CSV/env utilities import from a relative path to this file.

## Skill invocation flow

The canonical order (see `docs/roadmap.md` for the full decision tree):

```
/cold-email-kickoff                    ← always start here if new
  → /icp-onboarding                   → client-profile.yaml
  → /lead-magnet-brainstorm
  → /campaign-strategy
  → /zapmail-domain-setup-public       ← if no infra (2-week warmup wait)
  → /smartlead-inbox-manager
  → list-building skill                ← each requires /icp-prompt-builder first
  → /list-quality-scorecard
  → /campaign-copywriting              → variants.yaml
  → /spam-word-checker
  → /smartlead-campaign-upload-public  ← always DRAFT; you hit Start in UI
  → /positive-reply-scoring
  → /experiment-design
```

## Key constraints

- `smartlead-campaign-upload-public` **always** creates campaigns in DRAFT. Never change this.
- Every list-building skill (`prospeo-full-export`, `disco-like`, `blitz-list-builder`, `google-maps-list-builder`, `competitor-engagers`) requires `/icp-prompt-builder` as a prerequisite step before uploading any leads.
- `auto-research-public` requires a `client-profile.yaml` (from `/icp-onboarding`), 20+ Smartlead inboxes tagged `active`, and `MILLIONVERIFIER_API_KEY` in addition to Smartlead + Prospeo keys.

## Environment variables

Minimum for a first campaign: `SMARTLEAD_API_KEY`, `PROSPEO_API_KEY`, `DYNADOT_API_KEY`, `ZAPMAIL_API_KEY`. See `.env.example` for full reference.
