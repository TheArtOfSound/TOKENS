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

## Public data schema

See [`docs/DATA_SCHEMA.md`](docs/DATA_SCHEMA.md).

## Important limitation

This repository cannot collect live usage from GitHub Actions because GitHub does not have access to Bryan's local Claude Code or Codex logs. The live behavior comes from the local Mac publisher committing fresh sanitized snapshots into this repo.
