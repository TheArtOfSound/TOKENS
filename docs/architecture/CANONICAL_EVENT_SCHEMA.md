# TOKENS — Canonical Evidence Model & Published Schema

> **Scope warning.** Despite this file’s name, TOKENS has **no event-level record type**. The finest
> granularity anywhere is a daily per-provider aggregate row. There is no `eventId`, `ingestedAt`,
> per-record evidence class, session pseudonym, or source fingerprint. This document describes the
> **published snapshot contract**. A true canonical *event* model is unbuilt (dossier §16, §20).

Schema version **2.0.0**. Machine-readable JSON Schema: [`collector/schema/canonical-snapshot.schema.json`](../../collector/schema/canonical-snapshot.schema.json). Types: [`collector/lib/canonical.ts`](../../collector/lib/canonical.ts).

## Measurement classes (the core of the model)

Every published measurement carries a **measurement class** and a **method**. We never label a value merely "verified."

| Class | Meaning | Example in TOKENS |
| --- | --- | --- |
| `provider_reported` | The provider's own usage accounting | `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`, `models` |
| `application_reported` | A tool/app reported it | (reserved; future adapters) |
| `collector_derived` | Deterministically computed by us | `totalTokens` (= sum of the four reported), `cachedTokens`, `freshTokens` |
| `tokenizer_estimated` | Modeled/estimated | `estimatedCostUsd` (ccusage price-table estimate) |
| `user_submitted` | Human-entered, unverified | (reserved; future work evidence) |

**Rule:** estimates are never summed into exact totals. `measurement.exactTotalTokens` contains only reported + derived token counts; the cost estimate lives only under `measurement.estimatedOnly`.

## Grounding in `ccusage`

Real `ccusage claude daily --json` rows contain `inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, totalTokens, totalCost, modelsUsed, modelBreakdowns`. We treat the four token components as `provider_reported`, **recompute** `totalTokens` as their sum (`collector_derived`), and if the source's own `totalTokens` disagrees we keep the derived value and emit a `reported-total-mismatch:<date>:<provider>:reported=…:derived=…` warning. `totalCost` becomes `estimatedCostUsd` (`tokenizer_estimated`, nullable).

## Published `latest.json` shape (2.0.0)

Backward-compatible with the prior contract (frozen fields) plus additive blocks.

```jsonc
{
  "generatedAt": "ISO-8601",
  "timezone": "IANA tz | 'unknown'",
  "source": "local_mac_sanitized_ccusage | sample",
  "collectorVersion": "0.4.0",
  "isSampleData": false,
  "totals":   { /* TokenMetrics */ },
  "providers": { "claude": { /* ProviderSummary */ }, "codex": { … } },
  "daily":    [ { "date": "YYYY-MM-DD", "provider": "claude|codex", … TokenMetrics } ],
  "qiraProjects": [ /* allowlisted project metadata, no paths */ ],
  "scanner":  { "rootsChecked", "allowlistedProjects", "foundProjects", "privacyMode": "allowlist_no_paths" },
  "warnings": [ "sanitized strings" ],

  "measurement": {                          // NEW (additive)
    "classes": { "<field>": { "measurementClass", "confidence", "method" } },
    "exactTotalTokens": 0,                  // reported + derived only
    "estimatedOnly": { "costUsd": 0|null, "costMicroUsd": 0|null },
    "note": "activity volume is not skill …"
  },
  "privacy": {                              // NEW (additive)
    "rawContentPersisted": false,
    "allowlistPublication": true,
    "eligibleForAggregateSync": true,
    "fieldsPublished": [ … ]
  },
  "verification": {
    "schemaVersion": "2.0.0",
    "canonicalSchemaVersion": "2.0.0",
    "snapshotSha256": "<64 hex>",
    "rawLogsPublished": false,
    "gitCommit": "sha | null",
    "proves": "hash proves the public file is intact; it does NOT prove the source logs were immutable"
  }
}
```

### `TokenMetrics` (the eight metric fields, shared by totals/providers/daily)
`inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, cachedTokens (derived), freshTokens (derived), totalTokens (derived), estimatedCostUsd (nullable estimate)`.

## Money representation
The public contract keeps `estimatedCostUsd` as float USD (frozen), but the canonical model prefers **integer micro-USD** (`measurement.estimatedOnly.costMicroUsd`, via `toMicroUsd()`) to avoid floating-point drift in any future ledger/aggregate.

## Null-with-reason
Unavailable values are `null` (e.g. `estimatedCostUsd`), never a fabricated `0`. Token counts default to `0` only when genuinely zero; a coercion of `NaN`/`Infinity`/negative also yields `0` (safety), and such inputs are treated as absent data upstream.

## `profile` block (professional identity — additive, optional)

Leads with **identity**, backed by **measured activity**, with **honest verification** labels.

```jsonc
"profile": {
  "identity": {           // SELF-SUBMITTED (from profile/profile.json), sanitized, labeled unverified in UI
    "displayName", "headline", "pronouns", "location", "bio", "availability",
    "workCategories": [], "openTo": [], "links": [ { "label", "url(https only)" } ]
  },
  "activity": {           // COLLECTOR-DERIVED from daily data (deterministic)
    "referenceDate", "activeDays", "firstActiveDate", "lastActiveDate", "spanDays",
    "activeDaysLast30", "activeDaysLast90", "currentStreakDays", "longestStreakDays",
    "toolsUsed": [], "modelsUsed": [], "projectsActive"
  },
  "verification": [       // HONEST status per category
    { "label", "status": "verified|reported|self_submitted|unverified|pending", "basis" }
  ],
  "note": "identity is self-submitted; activity is measured; volume is not skill"
}
```

Rules: identity is never presented as verified; activity is derived only from measured usage (no "expert" inference); categories we cannot verify yet (`Identity verified`, `Work verified`) are `pending`, never faked. Identity strings are sanitized by the same allowlist/secret-scan pipeline as everything else — a bio cannot leak a path or key (proven in `profile.test.ts`). Source: [`collector/lib/profile.ts`](../../collector/lib/profile.ts); config: `profile/profile.json`.

## `history.json` (compact series)
```jsonc
{ "schemaVersion": "2.0.0", "kind": "compact_daily_series", "generatedAt": "…",
  "updatedThrough": "YYYY-MM-DD", "pointCount": N,
  "points": [ { "date", "provider", "totalTokens", "freshTokens", "cachedTokens", "estimatedCostUsd" } ],
  "note": "…" }
```

## Versioning & migration
Bump `CANONICAL_SCHEMA_VERSION` on any shape/semantics change. The JSON Schema is the source of truth for the published contract; `validateLatest.ts` enforces it (allowlist: unknown fields fail). Future multi-language types (Rust/Python) should be generated from this schema with a CI drift check (roadmap).
