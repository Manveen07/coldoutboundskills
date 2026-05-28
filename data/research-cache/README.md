# Research Cache

Every API response gets written here BEFORE parsing. If a parser bug shows up
later, we re-extract from the cache without paying for the API again.

## Directory layout

```
data/research-cache/
  ├── prospeo/{filter-hash}-page-{n}.json    30-day TTL
  ├── serper/{domain}--{query-hash}.json     90-day TTL
  ├── scrape/{domain}.json                   30-day TTL
  ├── person/{person_id}.json                90-day TTL
  ├── leadmagic/{first}-{last}-{domain}.json 365-day TTL (placeholder, not wired v1)
  ├── score/{client}/{hash}.json             90-day TTL (per-domain ICP scores)
  └── web/{domain}.json                      30-day TTL (free web research dossier)
```

## Each file

Every cache file has this shape:

```json
{
  "_cached_at": "2026-05-28T14:30:00.000Z",
  "payload": { ... actual API response or extracted data ... }
}
```

## Quick commands

```bash
# Audit cache size
npx tsx scripts/pipeline/cache-stats.ts

# Wipe one domain (requires exact match)
npx tsx scripts/pipeline/recover.ts --clear-cache --confirm-domain=mythic.us

# Re-run pipeline using only cached data (zero new API calls)
npx tsx scripts/pipeline/run.ts --client mythic --category qsr --offline
```

## Path traversal protection

The cache layer (`scripts/pipeline/_cache.ts`) rejects any key containing `..`,
`/`, `\`, or null bytes. You cannot accidentally write outside the cache dir.
