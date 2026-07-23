# Qira Agent Usage Observatory

A public, auto-updated portfolio dashboard for local coding-agent token usage across Claude Code and Codex.

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

The collector tries these commands and uses whatever succeeds:

```bash
ccusage daily --json
ccusage claude daily --json
ccusage codex daily --json
ccusage monthly --json
ccusage session --json
```

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
