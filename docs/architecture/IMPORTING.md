# Importing usage from other AI sources

Members can bring in usage from tools Ledger does not read locally — ChatGPT/OpenAI,
Cursor, a spreadsheet, or another machine's `ccusage` — to paint a fuller picture.

**Built-in local collection (no import needed):** Claude Code, Codex, **Grok**
(`~/.grok/sessions/**/updates.jsonl`), **Kimi / Kimi Code**
(`~/.kimi` + `~/.kimi-code` `**/wire.jsonl`), and every other agent `ccusage`
supports (Gemini CLI, Copilot CLI, OpenCode, Qwen, …). `npm run collect`
auto-ingests local adapters, then merges ccusage for providers with no
event-level ledger rows yet.

Import is still available for sources without a local adapter. This is opt-in: it
only happens when someone runs `npm run import` against a file they choose.

## The one rule

**Imported data is never "measured."** It is stored with:

- `measurementClass: user_submitted`
- `confidence: low`
- `origin: imported`

and is aggregated **separately** from locally-collected events. `Ledger.dailyTotals()`
(the measured totals that feed the published `totals`/`providers` and the profile
headline) queries `origin='local_log'` only, so imported figures can never inflate
the measured numbers. Imports surface in their own `imported` block, labeled
self-imported / unverified everywhere.

This is enforced by tests (`importers.test.ts`): a 999,999-token import is asserted
to stay out of the measured total.

## Usage

```bash
npm run import -- export.csv                      # preview (default — writes nothing)
npm run import -- export.csv --source "ChatGPT"   # label the source
npm run import -- export.csv --provider openai    # provider if the file omits it
npm run import -- export.csv --commit             # actually add it to the ledger
npm run import -- --list                          # list imported sources
npm run import -- --remove "ChatGPT"              # delete an imported source
```

Preview is the default; nothing is written until `--commit`.

## Supported inputs

- **CSV** with a header row.
- **JSON** — a top-level array, or usage records nested anywhere (e.g. `{ "daily": [...] }`).

## Allowlisted columns (case/spacing/underscore-insensitive)

| Field | Accepted names |
| --- | --- |
| date | date, day, timestamp, occurredAt, createdAt, time, usageDate |
| provider | provider, source, tool, vendor, service, platform |
| model | model, modelName, modelId, engine |
| input tokens | inputTokens, input, promptTokens, inTokens |
| output tokens | outputTokens, output, completionTokens, outTokens |
| cache read | cacheReadTokens, cachedTokens, cachedInputTokens, cacheRead |
| cache creation | cacheCreationTokens, cacheWriteTokens, cacheCreate |
| total | totalTokens, tokens, total |

**Only these columns are read.** Everything else in the file — prompt text, titles,
emails, IDs — is ignored. The bare names `prompt` and `completion` are deliberately
NOT aliased to token counts: those are the text columns in real exports, and mapping
them would both leak nothing (they're discarded) and silently zero real usage.

## What is skipped

A row with no parseable date, or with zero total tokens and no component tokens, is
skipped and counted — never estimated into existence. There is no tokenizer here:
imports require token counts.

## Deduplication

Each imported row's `eventId` is a hash of `(source, date, provider, model, tokens,
row index)`, so re-importing the same file inserts nothing new.
