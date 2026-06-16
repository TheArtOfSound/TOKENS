# Privacy model

This repository publishes sanitized aggregate usage metrics only.

## Published

- Generated timestamp
- Timezone
- Total token counts
- Cached token counts
- Fresh input/output token counts
- Estimated cost from the local usage tool
- Provider labels such as Claude Code and Codex
- Safe model names when available
- Daily aggregate records
- Snapshot hash
- Collector version
- Public safety warnings

## Not published

- Raw usage files
- Raw prompts
- Session text
- Model responses
- Private repository names
- Local filesystem paths
- Local usernames
- Hostnames
- Full session identifiers
- API keys
- `.env` files
- Provider account identifiers
- Any secret or private key material

## Why cached tokens are separated

Coding agents often re-use large context windows. That can create very large token-accounting totals. The dashboard separates cached context from fresh input/output so viewers do not confuse accounting volume with newly generated text.

## Local-only collection

The public site does not read the Mac directly. The local Mac runs the collector, writes sanitized JSON into `public/data`, and pushes the changed public data to GitHub.

## Validation

`npm run validate:data` scans the public snapshot for common path and secret patterns before the data is committed or deployed.
