# TOKENS — System Overview

_As-built after the `feat/verified-ai-work-foundation` session. Describes verified runtime behavior._

## What TOKENS is (today)

A **local-first AI-activity measurement system** with a public, sanitized presentation layer. The local collector measures how Bryan uses coding agents (Claude Code, Codex) over time; a static site presents a privacy-preserving, source-classified view. It is explicitly **not** a universal "AI score," a surveillance product, or a prompt/code harvester.

## Components

### 1. Local collector (`collector/`)
Runs on Bryan's Mac. Read-only toward source logs. Pipeline:

```
ccusage claude daily --json ─┐
ccusage codex  daily --json ─┤ (I/O: collectV2.ts)
                             ▼
        normalize.ts (pure)   ── per-day rows, derived totals, dedup, reconciliation warnings
                             ▼
        snapshot.ts (pure)    ── assembleDraft(): merge providers, totals, warnings
                             ▼
        publish.ts            ── publishSnapshot(): ALLOWLIST construction + measurement/privacy blocks + hash
                             ▼
        secretScan.ts         ── fail-closed: refuse to write if any prohibited pattern survives
                             ▼
   public/data/latest.json  +  public/data/history.json (compact_daily_series)
```

Key modules:
| File | Responsibility | Pure? |
| --- | --- | --- |
| `lib/canonical.ts` | Canonical evidence model, measurement classes, provenance table | yes |
| `lib/normalize.ts` | Parse ccusage → daily rows, derive totals, deterministic dedup | yes |
| `lib/snapshot.ts` | Assemble a draft snapshot from sources + scan | yes |
| `lib/publish.ts` | Allowlist publication transform + hashing | yes |
| `lib/secretScan.ts` | Nested secret/PII/path scanner (defense in depth) | yes |
| `lib/history.ts` | Compact derived daily series | yes |
| `collectV2.ts` | CLI: ccusage + scan I/O, idempotency, fail-closed, write | no (I/O) |
| `qiraScanner.ts` | Local project allowlist scan (metadata only) | no (I/O) |
| `validateLatest.ts` | Release gate: schema + hash + secret scan over published files | no (I/O) |

The pure modules are fully unit-tested against fixtures without touching ccusage, the clock, or disk.

### 2. Public data contract (`public/data/`)
- `latest.json` — the current published snapshot (schema `2.0.0`). Frozen-compatible with the prior contract plus additive `measurement` and `privacy` blocks. See `CANONICAL_EVENT_SCHEMA.md` and `collector/schema/canonical-snapshot.schema.json`.
- `history.json` — compact per-day series (`kind: "compact_daily_series"`).

### 3. Frontend (`src/`)
Vite + React + TS single-page dashboard. Fetches `latest.json`, renders totals, cache ratio, providers, daily chart, the Qira project matrix, and (new) the **measurement/methodology** panel that labels each number by its evidence class and states that activity volume is not skill.

### 4. Deployment
GitHub Actions (`.github/workflows/pages.yml`): `npm ci` → `validate:data` → `test` → `build` → deploy `dist/` to GitHub Pages (`ledger.imagineqira.com`). Publishing of fresh data is driven by the local Mac (GitHub has no access to local agent logs).

## Data flow trust boundaries
1. **Local logs → collector:** read-only. The collector uses only `ccusage … daily --json` (aggregate, path-free); it never reads session/project modes that would include paths.
2. **Collector → public JSON:** the allowlist publication transform is the boundary. Nothing reaches the public JSON unless it was explicitly constructed and passed the secret scan.
3. **Public JSON → site/world:** static, read-only. The snapshot hash makes post-generation tampering detectable.

## What is intentionally NOT built yet (roadmap)
Cloud sync backend, auth/ingest API, SQLite event ledger, Rust collector core, incremental checkpoint scanning, Ed25519 device signing, opportunity marketplace, employer search, professional profile graph. See `docs/product/PHASE_GATES.md` and `docs/execution/ROADMAP` items. These are deferred by design ("do not build the LinkedIn clone before the collector is validated").
