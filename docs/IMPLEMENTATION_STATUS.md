# TOKENS — Implementation Status (living document)

_Last updated: 2026-07-23 · Branch: `feat/verified-ai-work-foundation`_

This is the master status view. Detailed docs live under `docs/execution`, `docs/architecture`, `docs/security`, `docs/product`.

## Health snapshot
| Check | Result |
| --- | --- |
| Typecheck (`tsc --noEmit`) | ✅ pass |
| Unit tests (`vitest run`) | ✅ 35/35 |
| Data validation (`validate:data`) | ✅ schema + hash + secret scan |
| Build (`tsc -b && vite build`) | ✅ pass |
| Dependency audit | ✅ 0 vulnerabilities |
| Chrome (1440 / 375) | ✅ renders, no console errors, no leaks |
| Live site publishing | ⛔ blocked (R1 divergence) |

## Component status
| Area | Status | Notes |
| --- | --- | --- |
| Collector core (normalize/dedup/derive) | ✅ done, tested | pure, fixture-tested |
| Canonical evidence model 2.0.0 | ✅ done | measurement classes + provenance |
| Allowlist publication transform | ✅ done, tested | construct-not-redact; fail-closed |
| Secret/PII/path scanner | ✅ done, tested | nested + base64 + control chars |
| Compact history | ✅ done | 28 MB → 27 KB |
| Validator / release gate | ✅ done | Ajv 2020 + hash + scan |
| Test suite | ✅ done | 35 tests, adversarial fixtures |
| Frontend honesty UI | ✅ done | evidence tags + methodology panel |
| CI gates | ✅ done | npm ci + typecheck + test + validate + audit + build |
| Publisher hardening | ✅ done | idempotent, no-clobber, no force-push |
| Docs / threat model / privacy | ✅ done | full `docs/**` set |
| Live publishing restore | ⬜ needs Bryan | resolve R1, re-enable launchd |
| Incremental/scoped scan | ⬜ roadmap | current scan is full + slow (R5) |
| Ed25519 device signing | ⬜ roadmap | designed in THREAT_MODEL/roadmap |
| SQLite event ledger | ⬜ roadmap | Phase 2 |
| Cloud sync / auth ingest | ⬜ roadmap | Phase 2+ |
| Professional profile / marketplace | ⬜ future | Phase 3+ |

## Known limitations (honest)
1. **Live site is stale** (2026-06-18) until the origin/local divergence is reconciled by Bryan (R1). All new work is on a feature branch.
2. **Collector scan is slow** (~1–2 min over broad roots) and reads file contents across the home dir for project scoring; scope it with `QIRA_SCAN_ROOTS`. Incremental redesign is roadmap (R5).
3. **Base64 secret detection is one level deep**; deeply nested encodings could evade the defense-in-depth scanner (the allowlist makes placement hard regardless).
4. **Hostname/username detection outside path context is not attempted** (false-positive tradeoff) — see PRIVACY_BOUNDARY.
5. **No cloud backend yet**, so authenticated ingestion, replay protection, and device signing are designed but not built.
6. **Cross-platform paths tested by fixtures only**, not on real Windows/Linux machines.
7. **Legacy `collector/collect.ts` (v0.2.1)** remains, unused; safe to delete once confirmed unreferenced.
8. **`qiraProjects` publishes git branch names** of allowlisted repos (scanned + truncated); avoid encoding sensitive info in branch names.

## Definition of Done for Phase 1 (dossier §38) — remaining
- Restore live publishing (R1).
- Add device-signed aggregate + honest badge.
- Add incremental scan to hit the perf budget.
- Optional: interactive upload-preview UI with per-field toggles.
