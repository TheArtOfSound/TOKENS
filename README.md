# Ledger

**A portable evidence record for AI-assisted work.**

TOKENS measures supported AI-tool activity locally, signs a sanitized public snapshot on your device, and lets you choose whether to request a public Ledger profile.

[ledger.imagineqira.com](https://ledger.imagineqira.com)

## Fastest working setup

Requirements: Git and Node.js 22.5 or newer.

### macOS or Linux

```bash
curl -fsSL https://ledger.imagineqira.com/install.sh | bash
cd ~/TOKENS
npm run join
```

### Windows PowerShell

```powershell
irm https://ledger.imagineqira.com/install.ps1 | iex
Set-Location "$HOME\TOKENS"
npm run join
```

`npm run join` is the production onboarding path. It:

1. Creates or updates your self-submitted profile.
2. Lets you enable Claude Code, Codex, and project scanning separately.
3. Measures enabled sources locally.
4. Generates and signs a sanitized snapshot.
5. Prints the exact public JSON payload.
6. Separately asks whether to continue to public directory enrollment.

Installing, scanning, and creating a profile never make you public automatically.

## Current publication model

Ledger is currently a static website. It does not yet run a production account or upload server.

Public enrollment therefore uses the GitHub-backed path:

```bash
npm run list-me
```

That command:

- shows the directory disclosure;
- treats bare Enter as no;
- records explicit consent locally;
- publishes only the signed snapshot to a repository controlled by the member;
- opens a pull request adding the snapshot URL to the Ledger registry.

GitHub CLI authentication is needed for the automatic path. When `gh` is unavailable, the command prints a manual fallback.

The old managed-publication prototype is still available to developers as:

```bash
npm run publish:serve
PUBLISH_API_URL=http://127.0.0.1:8787 npm run publish:ledger:dev -- --handle YOU --email you@example.com
```

It is not the production enrollment route. `npm run publish:ledger` now fails clearly instead of pretending a localhost development server can update the live site.

## Useful commands

| Command | What it does |
| --- | --- |
| `npm run join` | Guided profile, consent, scan, sign, preview, and optional enrollment |
| `npm run consent` | Show what each source reads and what may be published |
| `npm run ingest` | Read enabled local provider records into private SQLite |
| `npm run collect` | Build and sign the sanitized snapshot |
| `npm run consent:preview` | Print the exact public payload |
| `npm run list-me` | Request a public directory listing |
| `npm run unlist` | Withdraw from the public directory |
| `npm run consent:export` | Export locally held derived data |
| `npm run consent:delete` | Delete locally held derived data |
| `npm run verify` | Verify a signed snapshot |

## What it reads and never publishes

Supported sources currently include Claude Code and Codex local session records.

Potentially published, subject to consent:

- token counts;
- dates;
- model names;
- self-submitted profile fields;
- allowlisted project summaries when project scanning is enabled.

Never published:

- prompts;
- model responses;
- source code;
- raw logs;
- absolute paths;
- usernames or hostnames;
- credentials or API keys;
- private signing keys;
- raw provider account identifiers.

Publication constructs an allowlisted payload and runs a fail-closed privacy scan before signing.

## What a signature establishes

A valid Ed25519 signature establishes that the signed bytes came from a device key and were not changed afterward.

It does not establish:

- legal identity;
- expertise;
- authorship;
- permission;
- quality;
- honest source logs;
- outcomes.

There is no universal skill score. Token volume is evidence of activity, not expertise, productivity, efficiency, compensation, or professional value.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run validate:data
npm run dev
open "http://localhost:5199/join"
```

The static site is served from this repository and the custom domain is configured by `public/CNAME`.

MIT © Qira LLC
