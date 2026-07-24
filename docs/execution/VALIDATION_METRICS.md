# TOKENS — Validation Metrics & Gates

Measured, not speculated. Session: `feat/verified-ai-work-foundation`, 2026-07-23.

## Phase-1 validation gates (dossier §28) — current status

| Gate | Target | Status | Evidence |
| --- | --- | --- | --- |
| Repeatable local install | clean install works | ✅ | `npm ci` → 0 vulnerabilities, 77 packages |
| Reliable Claude Code collection | parses real logs | ✅ | `ccusage claude daily --json` → 68 rows, normalized into snapshot |
| Reliable Codex collection | parses real logs | ✅ | `ccusage codex daily --json` → rows normalized |
| Incremental / idempotent scan | repeated run = no dup inflation | ✅ (content-level) | `computeContentHash` idempotency test; collector skips write when unchanged |
| No duplicate inflation | fixtures prove no double count | ✅ | `normalize.test.ts` duplicate-key keep-max test |
| Exact-vs-estimated labeling | every metric classed | ✅ | `measurement.classes` in `latest.json`; UI evidence tags |
| Payload preview / what-leaves-device | fields enumerated | ✅ (partial) | `privacy.fieldsPublished`; full interactive preview = roadmap |
| Local-only mode | works with no cloud | ✅ | entire system is local + static; no backend required |
| Sanitization enforcement | build fails on leak | ✅ | fail-closed collector + `validate:data` gate + adversarial tests |
| Authenticated ingestion | protected POST | ⬜ future | no cloud backend yet (roadmap) |
| Schema validation | published data validates | ✅ | Ajv 2020 against `canonical-snapshot.schema.json` |
| Frontend from real normalized data | renders live data | ✅ | verified in Chrome, schema 2.0.0, 32.51B tokens |
| Professional profile | verified activity | ⬜ future | roadmap (profile graph) |
| Deletion behavior | delete local derived data | ⬜ partial | `public/data/*` are the only derived artifacts; documented |
| Passing critical tests | green suite | ✅ | 71/71 |
| Documented limitations | known-limitations doc | ✅ | IMPLEMENTATION_STATUS + PRIVACY_BOUNDARY |

## Measured results (this session)
- **Tests:** 53 passed / 53 (8 files) in ~0.9s. Files: profile (13), normalize (10), secretScan (8), publish (8), scanCache (7), honesty (5), schema (4), strangler (3), scannerSafety (2), history (2).
- **Typecheck:** `tsc --noEmit` exit 0.
- **Build:** `tsc -b && vite build` exit 0. Output: index.html 0.61 kB, css 10.23 kB (gzip 3.02), js 208.51 kB (gzip 65.33).
- **Dependency audit:** 0 vulnerabilities.
- **Publication validation:** schema valid, hash verified, no prohibited content in `latest.json` and `history.json`.
- **Privacy scan over served `dist/`:** 0 prohibited patterns across 6 files; 0 `/Users/` occurrences in published JSON.
- **history.json size:** 28 MB → **27 KB** (~1000×).
- **Collector run (scoped to `~/Projects`):** ~55–115s depending on roots; exact total 32,710,374,262 tokens; 136 compact history points. (Scan is the slow part — see R5.)
- **Live site:** `ledger.imagineqira.com` HTTP 200 but **stale (2026-06-18)** — publishing blocked by R1.

## Performance notes / budgets (dossier §28)
- Frontend JS bundle 208 kB (65 kB gzip) — acceptable for a single-page dashboard.
- Collector wall-clock is dominated by `qiraScanner` reading file contents across the home dir (R5). ccusage itself: claude ~12s, codex ~1s. **Roadmap:** incremental scan to hit the <2s median / <5s p95 budget.
- No idle background network; the collector runs on the launchd interval only (currently disabled — R6).

## What is NOT yet measured (honest gaps)
- Cross-platform behavior (Windows/Linux paths) — covered by unit fixtures only, not real runs.
- 20–50 tester private-beta metrics (crash-free %, repeat usage) — not applicable yet.
- E2E browser automation across all flows — manual Chrome verification done (desktop 1440, mobile 375); no automated Playwright suite yet (roadmap).
