# Running TOKENS on macOS, Linux, and Windows

The collector is plain TypeScript run through Node, with no native build step, so
it runs the same on all three operating systems. This documents the few places
where the OS matters.

## Requirements (all platforms)

- **Node 22+** — the event ledger uses `node:sqlite`, which shipped in Node 22.
- **git** — for the installer and updates.
- **ccusage** is optional. The primary source is the event ledger (`npm run
  ingest`, which reads local logs directly). `ccusage` is only a cross-check /
  fallback when the ledger is empty.

## Install

| OS | One command |
| --- | --- |
| macOS / Linux | `curl -fsSL https://ledger.imagineqira.com/install.sh \| bash` |
| Windows (PowerShell) | `irm https://ledger.imagineqira.com/install.ps1 \| iex` |

Both scripts only clone the repo and run `npm ci`. They never read logs, never
publish, and never install a background job. Read them first if you like — they
are short and linked from the [join page](https://ledger.imagineqira.com/join).

From source is identical everywhere: `git clone … && npm ci`.

## Log locations

Claude Code and Codex write under the user's home directory on every platform, so
detection works out of the box:

| Source | Default location |
| --- | --- |
| Claude Code | `~/.claude/projects/**/*.jsonl` (Windows: `%USERPROFILE%\.claude\projects`) |
| Codex | `~/.codex/sessions/**/*.jsonl` |

If your logs live somewhere else (portable install, non-default home), override
the roots — no code change needed:

```bash
TOKENS_CLAUDE_DIR="/path/to/.claude/projects" TOKENS_CODEX_DIR="/path/to/.codex/sessions" npm run ingest
```

## Key storage

The Ed25519 signing key is generated locally and never leaves the machine.

- **macOS** — stored in the login Keychain (service `tokens device key`).
- **Linux / Windows** — stored in a permission-restricted file at
  `.tokens-cache/device-key.pem` (mode `0600` on POSIX; on Windows it inherits the
  user profile's ACL). It is gitignored and never published.

To reset your key: delete the Keychain item (macOS) or the `device-key.pem` file,
then re-run `npm run collect`. Rotating this way should be paired with
`npm run key -- revoke <oldKeyId>` if the old key may be compromised.

## Keeping it current (all optional)

`npm run collect` refreshes your snapshot on demand. To automate:

- **macOS** — `bash scripts/install-launchd.sh` (runs every 30 min while awake).
  Remove with `bash scripts/uninstall-launchd.sh`.
- **Linux** — a cron entry, e.g. every 30 minutes:
  ```cron
  */30 * * * * cd "$HOME/TOKENS" && /usr/bin/npm run collect >> "$HOME/TOKENS/collector/local-logs/cron.log" 2>&1
  ```
  (or a systemd user timer if you prefer).
- **Windows** — Task Scheduler → Create Task → Action: `npm`, arguments `run
  collect`, "Start in" set to your TOKENS folder; trigger on a repeat interval.

Automation only re-runs the same `collect` you can run by hand. It does not change
what is read or published.

## Uninstall

```bash
# macOS / Linux
bash scripts/uninstall-launchd.sh   # if you installed the launchd job (macOS)
rm -rf "$HOME/TOKENS"

# Windows (PowerShell)
Remove-Item -Recurse -Force "$HOME\TOKENS"
```

Then, on macOS, delete the `tokens device key` item in Keychain Access. Your
published snapshot is hosted by you — delete it wherever you put it, and remove
your registry entry — we hold nothing of yours.
