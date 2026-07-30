# Ledger

**A portable evidence record for AI-assisted work.**

Measure the AI work you already do, sign it with a key that never leaves your
machine, and — if you choose — publish a record anyone can verify in their own
browser.

[ledger.imagineqira.com](https://ledger.imagineqira.com)

```bash
npm install -g qira-ledger
```

## Quick start

```bash
mkdir my-ledger && cd my-ledger
ledger init          # scaffold a workspace
# edit profile/profile.json — displayName and headline
ledger collect       # measure your local AI usage and sign it
ledger status        # see what is measured and what is public
```

Nothing is public at this point. Publishing is a separate, explicit step:

```bash
ledger list-me       # read the disclosure, answer once
ledger unlist        # withdraw at any time
```

After you opt in once, `ledger collect` keeps your published record current
automatically. You are never asked again.

## Commands

| Command | What it does |
| --- | --- |
| `ledger init` | Create a workspace in the current directory |
| `ledger collect` | Measure local AI usage, sign a snapshot |
| `ledger status` | What is measured, published, and consented to |
| `ledger list-me` | Join the public directory (asks once) |
| `ledger unlist` | Withdraw from the public directory |
| `ledger consent` | Review or change what may be published |
| `ledger export` | Copy everything held locally about you |

## What it reads, and what it never publishes

It reads the usage logs Claude Code and Codex already write on your machine.

**Published:** token counts, dates, model names, and whatever you put in your
profile files.

**Never published:** prompt text, response text, source code, absolute file
paths, git branch names, usernames, hostnames, secrets, API keys, or raw provider
account identifiers. Session identifiers are stored as keyed hashes under a salt
that never leaves your machine.

Publication uses an allowlist, not a blocklist: a field is published because it
was explicitly permitted, not because nobody remembered to redact it. A
fail-closed secret scan runs before anything is written.

## What a signature does and does not prove

A signature proves a snapshot came from a device key and has not been altered
since. It does **not** prove who holds that key, and it cannot prove your provider
logs were genuine — anyone controlling a machine could feed the collector
fabricated logs and it would sign them faithfully.

**There is no score.** Token volume is evidence of activity, not expertise,
productivity, efficiency, or professional value. Nothing here ranks people, and
no profile infers skill from usage. See
[what each signal can establish](https://ledger.imagineqira.com/claims).

## A workspace is a directory

```
profile/profile.json    who you are, and where your snapshot is served
profile/consent.json    what you have agreed may be published
public/data/            your signed snapshot and history
.tokens-cache/          incremental scan state (safe to delete)
```

Your evidence is a folder you own, not rows in someone's database. `profile/`
and `.tokens-cache/` are gitignored by default — they hold your identity and a
per-device salt.

## Requirements

- **Node 22.5+** — the event ledger uses the built-in `node:sqlite`, so there are
  no native modules and no runtime dependencies.
- macOS, Linux, or Windows.
- [`ccusage`](https://www.npmjs.com/package/ccusage) for Claude Code parsing, and
  [`gh`](https://cli.github.com) if you want `list-me` to open your join pull
  request for you.

## Privacy

There is no account and no Ledger server that receives your data. Measurement
happens entirely on your machine and stays there. Publishing is a separate act
you choose: if you join the directory, your snapshot is hosted in your own
repository and your entry is added by a pull request you open yourself — so the
entry is public, permanently, in git history.

[Privacy](https://ledger.imagineqira.com/privacy) ·
[Terms](https://ledger.imagineqira.com/terms) ·
[How verification works](https://ledger.imagineqira.com/verify)

## Development

This repository contains both the CLI and the static site that renders published
records.

```bash
npm ci
npm run collect        # same as `ledger collect`, from source
npm run build:cli      # bundle dist-cli/
npm run build          # build the website
npx vitest run         # tests
```

Architecture, security, and product notes live under `docs/`.

MIT © Qira LLC
