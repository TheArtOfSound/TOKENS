# Migration & rollback — static registry → publication service

## What changes

| Before | After |
| --- | --- |
| Members only in `public/data/profiles/index.json` | Members also in publication SQLite (`publish.db`) |
| Join via GitHub PR | Join via `/join` → Publish through Ledger |
| Snapshot only self-hosted or operator `/data/latest.json` | Hosted snapshots at `/api/publish/v1/snapshots/:handle` |

## Preserve

- Bryan Leonard handle `bryan`
- Route `/u/bryan`
- Signature verification (browser + collector)
- Static snapshot `/data/latest.json`
- Self-hosted PR path (still available under Advanced)
- Local collector consent / keys / ledger

## Forward migration

```bash
# 1. Backup
cp public/data/profiles/index.json public/data/profiles/index.json.bak
cp public/data/latest.json public/data/latest.json.bak

# 2. Start service with durable DB path
export PUBLISH_DB=/var/lib/tokens/publish.db
export PUBLISH_PUBLIC_BASE=https://ledger.imagineqira.com
export PUBLISH_DEV_EXPOSE_CODES=0
npm run publish:serve

# 3. Seed Bryan from current signed snapshot
MIGRATE_EMAIL=bryan@imagineqira.com npm run publish:migrate
```

Directory UI merges static + API and de-dupes by handle (API wins).

## Rollback

```bash
# 1. Stop publication service process
# 2. Remove or rename DB
mv "$PUBLISH_DB" "${PUBLISH_DB}.rolled-back"

# 3. Confirm static registry still present
cat public/data/profiles/index.json

# 4. Redeploy static site only if frontend build must drop API coupling
#    (not required: frontend already falls back when API is unreachable)
```

After rollback, People directory shows static members only. Hosted-only accounts disappear from public search until the service is restored from backup DB.

## Data retention note

Hosted snapshot history is append-only in SQLite. Account delete removes hosted rows for that account. Unpublish sets `state=unpublished` and hides from directory without erasing history until delete.
