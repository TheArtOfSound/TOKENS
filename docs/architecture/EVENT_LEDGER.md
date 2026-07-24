# TOKENS — Canonical Event Model & Local Ledger

Before this, the finest granularity anywhere in TOKENS was a daily per-provider
aggregate from `ccusage daily`. Events are read directly from the providers' own
JSONL logs, which unblocks deduplication, reconciliation, and incremental
resumable scanning.

Code: [`collector/lib/events.ts`](../../collector/lib/events.ts),
[`collector/lib/ledger.ts`](../../collector/lib/ledger.ts),
[`collector/adapters/`](../../collector/adapters/). CLI: `npm run ingest`.

## 1. What an event is

| Field | Notes |
| --- | --- |
| `eventId` | Deduplication key — see §3 |
| `occurredAt` / `ingestedAt` | When the work happened / when we first recorded it |
| `provider`, `model` | `model` must match `^[a-zA-Z0-9._:-]{2,80}$` or it is dropped |
| `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`, `totalTokens` | |
| `measurementClass` | Always `provider_reported` for log-derived events |
| `sessionPseudonym` | HMAC of the session id under a per-device salt |
| `sourceFingerprint` | HMAC of the file's realpath — never the path |
| `adapter`, `adapterVersion` | Provenance, so a format change is attributable |

## 2. Privacy

Raw log lines contain `cwd` (absolute paths), `gitBranch`, `message.content`
(prompt and response text), `sessionId`, `uuid`, `requestId`, and
`user_instructions`. **None of it is persisted.**

Extraction is an **allowlist**, exactly like the publication transform: the
handful of wanted fields are named and a new object is constructed. A new field
in a future log format cannot leak by default — it is simply never read.

Identifiers needed for dedup are keyed HMACs under a per-device salt
(`.tokens-cache/pseudonym-salt`, mode 0600, never published). Pseudonyms are not
reversible and not linkable across devices.

`events.test.ts` asserts this adversarially: a realistic line stuffed with a fake
API key, a password, an absolute path, a private branch name, and every
identifier is extracted, and the result is checked to contain none of them.

## 3. Deduplication — and the +124% bug

`eventId = SHA-256(provider | identity)` where identity is, in order of
preference:

1. `msg:<message.id>|req:<requestId>` — the provider's own identifiers
2. a content hash of timestamp, model, and token counts (fallback only)

**Why this matters.** The first implementation keyed identity on the session
pseudonym. Claude Code copies the same API call into multiple session files on
resume and after compaction, each time under a *different* `sessionId`, so one
call was counted many times. Measured against `ccusage`, totals came out at
**+124%** — more than double the truth. Keying on the provider's message identity
brought Claude to **−0.1%** agreement.

Consequence worth stating plainly: two records sharing a provider message id are
treated as one event even if a token count was revised. First write wins.

## 4. Provider differences (why adapters are versioned)

**Claude Code** — `~/.claude/projects/**/*.jsonl`. Usage at `message.usage`;
`cache_creation_input_tokens` and `cache_read_input_tokens` are siblings of
`input_tokens`, so all four components sum to the total.

**Codex** — `~/.codex/sessions/**/*.jsonl`. Two traps:

- Each `token_count` line carries **both** `total_token_usage` (cumulative for
  the session) and `last_token_usage` (this turn). Summing the cumulative field
  would inflate by orders of magnitude. Only `last_token_usage` is read, and the
  extractor returns `null` rather than guessing if it is absent.
- `cached_input_tokens` is a **subset** of `input_tokens`, not a sibling
  (observed: input 10731, cached 6528, output 649, total 11380 = input + output).
  Fresh input is therefore `input − cached`; adding both would double-count.
- The model is not on the usage line at all; it appears on an earlier
  `turn_context` line, so the Codex extractor is stateful per file. A fresh
  extractor is created per file so state never leaks between sessions.

## 5. Reconciliation against ccusage

Measured 2026-07-24, 135,655 events across 95 days:

| Provider | Event ledger | ccusage | Delta | Days >2% off |
| --- | --- | --- | --- | --- |
| Claude | 23,875,395,830 | 23,885,578,855 | **−0.04%** | **0 / 68** |
| Codex | 9,916,569,804 | 9,297,043,446 | **+6.66%** | 11 / 68 |

Claude agreement is essentially exact and uniform across every measured day; the
residual is activity occurring between the two measurements.

### The Codex +6.7%, explained

Two separate causes were found by measuring, and one is fixed.

**Fixed — UTC vs local day bucketing.** Days were bucketed on the UTC date
substring. For a UTC−7 user everything after 17:00 local landed on the next day,
which showed up as exactly equal-and-opposite errors on adjacent days
(2026-04-04 −139,659,940 against 2026-04-05 +139,659,940). Migration 2 adds a
`local_date` column computed with `Intl` at insert time. Claude went to −0.04%
with **0 of 68 days** off by more than 2%.

**Understood, not fixable today — Codex re-emission.** Codex re-emits the same
turn's `last_token_usage` without advancing its cumulative counter. Sampling 226
real sessions:

- 191 sessions: `sum(last_token_usage)` equals the session's **own** final
  `total_token_usage` — so summing is correct there, validated against Codex's
  internal arithmetic rather than against ccusage.
- 35 sessions: `sum > final` with no counter reset — the re-emission case.

Two alternative rules were implemented and measured, and both are worse:

| Rule | Result |
| --- | --- |
| Sum `last_token_usage` (current) | **+6.7%** |
| Derive events from cumulative delta | −44% |
| Gate on "cumulative advanced" | −45% |

Both cumulative-based rules fail for the same reason: the cumulative counter
advances only at turn end, while `last_token_usage` updates per sub-call (a
single turn can emit **205** `token_count` lines), so anything gated on it drops
every intra-turn call. Summing is the most accurate rule available today, with a
known one-directional error bounded at roughly +7%.

Consequently Codex is published at **`confidence: medium`** with the uncertainty
stated in the snapshot and the UI, rather than presented as exact.

## 6. Incremental scanning

Per file the ledger stores byte offset, size, inode, mtime, and a tail digest.

- unchanged size + inode → skipped without opening
- inode changed or size < stored offset → rotated/truncated, re-read from zero
- size > offset → only the new bytes are read

Reads stop at the last newline, so a partially-written trailing line is left for
the next run instead of being parsed as garbage. A malformed line is counted and
skipped; it never aborts a scan.

**A previous version capped reads at 8 MB per file.** 28 logs exceeded that,
holding 1.86 GB of the 2.15 GB corpus, so ~87% of all bytes were silently
dropped and totals ran ~84% low. Reads now loop over 8 MB chunks until the file
is fully consumed. Events stream to the ledger per file so a multi-gigabyte
corpus is never held in memory.

## 7. Storage

SQLite via `node:sqlite` (built into Node 22 — no dependency, no native build).
WAL journaling. Tables: `events`, `source_checkpoints`, `schema_migrations`.
Migrations are append-only and each ships a tested `down`.

The ledger holds derived data only, lives in gitignored `.tokens-cache/`, never
leaves the machine, and can be deleted at any time — everything in it is
rebuildable from the logs. `npm run consent:delete` clears it.

## 8. Measured performance

Cold ingest of the full corpus (3,126 Claude files + 628 Codex files, ~2.15 GB,
924,554 lines): **~20s**, yielding 135,655 events and catching 85,542 duplicates.
A subsequent no-change run skips every file without opening it.


## 9. The ledger is now the source of truth

`npm run collect` publishes from the ledger (`collector/lib/ledgerSource.ts`),
not from `ccusage`. The snapshot records this in `sourceOfTruth: "event_ledger"`
and carries per-provider confidence:

- `claude` → `high` — reconciles to within 0.05% of ccusage on every measured day
- `codex` → `medium` — may overstate by up to ~7% from provider re-emission

`ccusage` remains available as an independent cross-check and as the fallback
when the ledger is empty (`TOKENS_SOURCE=ccusage` forces it). Cost is published
as `null` from this path: the ledger stores measured tokens and does not invent
a price.
