# Public data schema

The dashboard reads `public/data/latest.json`.

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
