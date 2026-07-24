# Qira Agent Usage Observatory

A public portfolio dashboard for local coding-agent token usage across Claude Code and Codex.

> **Current state (2026-07-23):** automatic publishing is **not running**. The `com.qira.tokens.collector`
> launchd job is unloaded, and the live site serves a snapshot from 2026-06-18 (collector 0.3.0) while local
> is 0.4.0. See `docs/IMPLEMENTATION_STATUS.md`. Do not describe this as auto-updating until the publisher is
> re-enabled and the origin divergence (R1) is resolved.

This repo is designed to work as a static GitHub Pages site backed by sanitized JSON generated on Bryan's Mac. The public site never needs direct access to the machine, raw logs, prompts, session text, private repo names, local paths, hostnames, usernames, API keys, or `.env` values.

## What it shows

- All-time token usage
- Claude token usage
- Codex token usage
- Cached vs fresh token split
- Daily usage history
- Estimated cost
- Provider and model split when safely available
- Snapshot hash and collector metadata
- Last update time

## Live observatory backend

In addition to the static GitHub Pages site, there is a live backend
(FastAPI + MongoDB) that serves real-time telemetry and powers the
embeddable badge.

API endpoints (all prefixed with `/api`):

- `GET /api/usage/latest` — current snapshot (totals, providers, daily, projects, verification, `live`)
- `GET /api/usage/history` — historical token series
- `GET /api/projects` — Qira project matrix + scanner summary
- `GET /api/badge.svg` — live embeddable SVG badge (see below)
- `POST /api/usage/ingest` — secured publisher endpoint (see below)

### Live SVG badge

Embed a live, auto-updating proof-of-work badge in any README:

```md
![Qira tokens](https://YOUR-OBSERVATORY/api/badge.svg)
```

Query params:

- `metric` — `total` (default), `cost`, `cached`, `fresh`, `claude`, `codex`
- `label` — override the left label text, e.g. `?label=Claude%20Code`
- `live` — `1` (default, animated red pulse dot) or `0` (static)

Examples:

```md
![tokens](https://YOUR-OBSERVATORY/api/badge.svg)
![spend](https://YOUR-OBSERVATORY/api/badge.svg?metric=cost)
![cached](https://YOUR-OBSERVATORY/api/badge.svg?metric=cached)
```

### Publishing live data from your Mac

`scripts/update-local.sh` pushes the freshly collected `public/data/latest.json`
to the live backend when these are set (e.g. in a local, untracked `.env`):

```bash
TOKENS_INGEST_URL=https://YOUR-OBSERVATORY/api/usage/ingest
TOKENS_INGEST_TOKEN=<must match INGEST_SECRET on the server>
```

The ingest endpoint requires the `X-Ingest-Token` header to match the server's
`INGEST_SECRET`, validates the payload schema, and stores real snapshots
verbatim (no simulated drift). If the two vars are unset, the script simply
skips the push and still commits to GitHub Pages as before.


## Architecture

```text
Bryan's Mac
  -> local collector runs ccusage JSON commands
  -> collector normalizes and sanitizes metrics
  -> public/data/*.json is updated
  -> update script commits and pushes changed public data
  -> GitHub Actions deploys the static site to GitHub Pages
```

## Quick start

Local dev uses port `5199` by default so it does not collide with the usual Vite `5173` port.

```bash
npm install
npm run dev
open "http://localhost:5199"
```

Override the port if needed:

```bash
TOKENS_DEV_PORT=5299 npm run dev
open "http://localhost:5299"
```

## Run the collector once

Install `ccusage` first if it is not already available on your Mac.

```bash
npm run collect
npm run validate:data
npm run build
open "http://localhost:5199"
```

The collector runs exactly these two commands:

```bash
ccusage claude daily --json
ccusage codex daily --json
```

`ccusage session --json` is **deliberately never used**: session records carry local filesystem paths.
See [`docs/security/PRIVACY_BOUNDARY.md`](docs/security/PRIVACY_BOUNDARY.md). `daily`/`monthly` aggregate
modes are not invoked either — the two per-provider calls above are the only source of usage data.

## Publish updated data from your Mac

```bash
bash scripts/update-local.sh
```

That script collects metrics, validates the sanitized output, builds the frontend, commits changed files under `public/data`, and pushes to GitHub.

## Install automatic macOS updates

```bash
bash scripts/install-launchd.sh
```

Default cadence: every 30 minutes while the Mac is awake.

Remove it with:

```bash
bash scripts/uninstall-launchd.sh
```

## Privacy model

Raw logs are never published. See [`docs/PRIVACY.md`](docs/PRIVACY.md).

Note: the collector's project scan reads the home directory and can be slow. Scope it:

```bash
QIRA_SCAN_ROOTS="$HOME/Projects,$HOME/nous" npm run collect
```

## Tests, typecheck, and data validation

```bash
npm test              # 35 unit tests: normalization, dedup, privacy/redaction, allowlist publication, schema, strangler equivalence
npm run typecheck     # tsc --noEmit
npm run validate:data # JSON-Schema (allowlist) + snapshot hash + nested secret scan over public/data
npm run build         # tsc -b && vite build
```

## Measurement integrity

Every published number carries a **measurement class** (`provider_reported`, `collector_derived`, `tokenizer_estimated`, …) and a method. Token counts are provider-reported usage or deterministic sums; cost is a price-table **estimate** and is never summed into token totals. Activity volume is never presented as skill, productivity, or employability. See [`docs/architecture/CANONICAL_EVENT_SCHEMA.md`](docs/architecture/CANONICAL_EVENT_SCHEMA.md).

## Privacy

The published object is **constructed from an allowlist** (not redacted), then passed through a nested secret/PII/path scanner; the collector refuses to write if anything prohibited survives. See [`docs/security/PRIVACY_BOUNDARY.md`](docs/security/PRIVACY_BOUNDARY.md) and [`docs/DATA_SCHEMA.md`](docs/DATA_SCHEMA.md).

## Documentation

- Architecture: [`docs/architecture/SYSTEM_OVERVIEW.md`](docs/architecture/SYSTEM_OVERVIEW.md), [`CANONICAL_EVENT_SCHEMA.md`](docs/architecture/CANONICAL_EVENT_SCHEMA.md)
- Security: [`docs/security/THREAT_MODEL.md`](docs/security/THREAT_MODEL.md), [`PRIVACY_BOUNDARY.md`](docs/security/PRIVACY_BOUNDARY.md), [`SECURITY.md`](SECURITY.md)
- Product: [`docs/product/PRODUCT_REQUIREMENTS.md`](docs/product/PRODUCT_REQUIREMENTS.md), [`PHASE_GATES.md`](docs/product/PHASE_GATES.md)
- Status & execution: [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md), [`docs/ROADMAP.md`](docs/ROADMAP.md), [`docs/execution/`](docs/execution/)

## Important limitation

This repository cannot collect live usage from GitHub Actions because GitHub does not have access to Bryan's local Claude Code or Codex logs. The live behavior comes from the local Mac publisher committing fresh sanitized snapshots into this repo.
