---
name: leadmagic-email-reveal
description: Reveal work emails for a CSV of leads using LeadMagic. Runs after list-building and ICP qualification, before Smartlead upload. Skips leads that already have emails. Rate-limited to 5 req/s. Adds email, email_confidence, and email_source columns.
---

# LeadMagic Email Reveal

Reveal work emails for qualified leads before uploading to Smartlead. Run this after list-building and ICP qualification — never before, to avoid burning credits on unreviewed leads.

## Prerequisites

- `LEADMAGIC_API_KEY` set in `.env`
- Input CSV must have: `first_name`, `last_name`, `company_domain`
- Optional but improves hit rate: `linkedin_url`
- Leads should already be ICP-qualified (run `/icp-prompt-builder` first)

## What This Does

1. Reads your qualified leads CSV
2. For each lead without an email: calls LeadMagic `/email-finder` (name + domain)
3. Falls back to `/profile-finder` (LinkedIn URL) if name+domain returns nothing
4. Skips leads that already have an email in the `email` column
5. Writes output CSV with three new columns: `email`, `email_confidence`, `email_source`
6. Logs revealed count, not-found count, and total credits used

## Run It

```bash
npx tsx scripts/reveal-emails-leadmagic.ts data/leads-qualified.csv data/leads-with-emails.csv
```

## Output Columns Added

| Column | Values |
|---|---|
| `email` | Work email found, or empty string |
| `email_confidence` | `verified` / `likely` / `risky` / `unknown` / `pre-existing` |
| `email_source` | `email-finder` / `profile-finder` / `none` / `input` |

## Cost

~$0.09/credit. Credits only consumed on successful finds (source ≠ `none`). Run after ICP qualification to avoid wasting credits on bad-fit leads.

## Next Step

After reveal, upload to Smartlead with `/smartlead-campaign-upload-public`. Filter out leads where `email` is empty before uploading.

## Setup (First Time)

1. Sign up at [leadmagic.io](https://leadmagic.io)
2. Go to Settings → API Keys → Create key
3. Add to `.env`:
   ```
   LEADMAGIC_API_KEY=your_key_here
   ```
