# Public data schema

The dashboard reads `public/data/latest.json`.

> **Schema 2.0.0.** The authoritative machine-readable schema is [`../collector/schema/canonical-snapshot.schema.json`](../collector/schema/canonical-snapshot.schema.json), enforced by `npm run validate:data`. Version 2.0.0 adds the additive `measurement` (provenance) and `privacy` blocks and extends `verification`. See [`architecture/CANONICAL_EVENT_SCHEMA.md`](architecture/CANONICAL_EVENT_SCHEMA.md) for the full model, measurement classes, and the compact `history.json` series. The fields below remain part of the frozen, backward-compatible contract.

## Top-level fields

```json
{
  "generatedAt": "2026-06-16T00:00:00.000Z",
  "timezone": "America/Phoenix",
  "source": "local_mac_sanitized_ccusage",
  "collectorVersion": "0.1.0",
  "isSampleData": false,
  "totals": {},
  "providers": {},
  "daily": [],
  "warnings": [],
  "verification": {}
}
```

## Metrics object

Every totals/provider/daily object uses the same token metric fields:

```json
{
  "inputTokens": 0,
  "outputTokens": 0,
  "cacheCreationTokens": 0,
  "cacheReadTokens": 0,
  "cachedTokens": 0,
  "freshTokens": 0,
  "totalTokens": 0,
  "estimatedCostUsd": null
}
```

Definitions:

- `inputTokens`: non-cached input tokens when available.
- `outputTokens`: generated output tokens when available.
- `cacheCreationTokens`: tokens written into cache when available.
- `cacheReadTokens`: tokens read from cache when available.
- `cachedTokens`: `cacheCreationTokens + cacheReadTokens`.
- `freshTokens`: `inputTokens + outputTokens`.
- `totalTokens`: provider/tool usage-accounting total when available, otherwise `freshTokens + cachedTokens`.
- `estimatedCostUsd`: local tool estimate, not a guaranteed invoice number.

## Provider summary

`providers` is an object keyed by provider:

```json
{
  "claude": {
    "provider": "claude",
    "displayName": "Claude Code",
    "models": ["opus-4-8"],
    "totalTokens": 0
  }
}
```

## Daily records

`daily` is an array of date/provider rows:

```json
{
  "date": "2026-06-13",
  "provider": "claude",
  "displayName": "Claude Code",
  "models": ["opus-4-8", "haiku-4-5"],
  "totalTokens": 0
}
```

## Profile (optional)

`profile` carries the professional identity layer. It mixes three *clearly separated* classes of
data and the UI must never blur them:

- `profile.identity` — **self-submitted**, read from `profile/profile.json`. Every string passes
  the secret scanner before publish; links must be `https://`. Never presented as verified.
- `profile.activity` — **derived** deterministically from the measured `daily` rows
  (active AI-work days, streaks, tools, models). No skill or seniority is inferred from volume.
- `profile.work` — connected work artifacts and outcomes, read from `profile/work.json`.

```json
{
  "work": {
    "artifacts": [
      {
        "type": "repository",
        "title": "TheArtOfSound/TOKENS",
        "description": "Open-source local-first collector.",
        "url": "https://github.com/TheArtOfSound/TOKENS",
        "period": "2026",
        "linkedProject": "TOKENS",
        "verification": "collector_observed",
        "basis": "The local collector independently observed git/file activity for this project."
      }
    ],
    "outcomes": [],
    "collectorObserved": 1,
    "totalArtifacts": 1,
    "totalOutcomes": 0
  }
}
```

Artifact `verification` values, strongest first:

- `collector_observed` — the artifact's `linkedProject` was **actually found on this machine** by the
  scanner. This is real local evidence that the work exists.
- `link_provided` — a public `https://` URL was supplied but nothing was independently checked.
- `self_reported` — a bare claim with no backing.

Two anti-forgery rules are enforced in `publish.ts` and covered by tests:

1. A `collector_observed` badge with no `linkedProject` is **downgraded** to `self_reported`.
2. `collectorObserved` is **recomputed** from the published artifacts, so a hand-edited
   `profile/work.json` cannot inflate the count.

`outcomes` are **always** `self_reported`. Third-party outcome confirmation is not implemented, so
no code path can mark an outcome verified.

## Verification

```json
{
  "schemaVersion": "1.0.0",
  "snapshotSha256": "...",
  "rawLogsPublished": false,
  "gitCommit": null
}
```

The hash is calculated after normalization and before publishing. It proves the public snapshot content did not change after generation, but it does not prove the raw private logs because those are deliberately not published.
