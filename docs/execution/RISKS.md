# TOKENS — Risk Register

Severity: **H**igh / **M**edium / **L**ow. Status as of the `feat/verified-ai-work-foundation` session (2026-07-23).

## R1 — Local `main` and `origin/main` have diverged into two different apps (H, OPEN — needs Bryan)
Local `main` is 1,252 ahead / 11 behind `origin/main`; merge-base `216d9c9`. Origin is a different `frontend/`-based JS app + `memory/` + `test_reports/`; local is the `src/` TS app. The live site froze ~2026-06-18.
**Impact:** the public site is stale; publishing is stuck; a careless merge/force-push could destroy one lineage.
**Mitigation in place:** work isolated on a feature branch; recovery branch preserves local commits; the publish script now refuses to push over a diverged remote (no force, no loop).
**Action required (Bryan):** decide which lineage is canonical, then reconcile deliberately. See SESSION_STATE for options.

## R2 — Privacy / content-leak is existential (H, MITIGATED)
A blocklist validator could leak any unanticipated field.
**Mitigation:** allowlist publication transform (construct, not redact) + nested secret scanner + fail-closed collector write + schema `additionalProperties:false` + `validate:data` gate + 92 tests incl. adversarial fixtures. Verified: 0 prohibited patterns in the regenerated data and in all served `dist/` assets.
**Residual:** base64 decode is one level deep; hostname/username detection outside path context is intentionally not attempted (documented in PRIVACY_BOUNDARY).

## R3 — Data-accuracy / inflation (H, MITIGATED)
No provenance previously; risk of double-counting and of estimates being read as measured.
**Mitigation:** measurement classes on every metric; totals re-derived as deterministic sums; deterministic dedup (keep-max, never sum) with reconciliation warnings; estimates structurally separated (`measurement.estimatedOnly`). Tests cover inflation and mismatch cases.

## R4 — Non-reproducible builds (M, MITIGATED)
`"latest"` everywhere.
**Mitigation:** all deps pinned to exact versions; CI uses `npm ci`. No upgrade policy document exists yet. 0 npm-audit vulnerabilities.

## R5 — Collector inefficiency / broad filesystem read (M, PARTIALLY MITIGATED)
`qiraScanner` walks the home dir to depth 5 and reads file contents for scoring; a full run took ~114s and one broad run exceeded 2 minutes.
**Impact:** battery/CPU cost; slow; reads broadly (though nothing from file contents is published).
**Mitigation:** `QIRA_SCAN_ROOTS` scoping. **Roadmap:** incremental, checkpoint-based, content-minimizing scan (dossier §15).

## R6 — launchd job disabled during session (M, OPEN — needs Bryan)
The collector launch agent was booted out to protect the working branch and stop the failing-push loop.
**Action required (Bryan):** after R1 is reconciled and the fixed `update-local.sh` is in place, re-enable via `bash scripts/install-launchd.sh` (see SESSION_STATE). Do not re-enable before reconciling R1, or the push will keep failing.

## R7 — `memory/test_credentials.md` on origin (L, INFO — hygiene)
A notes file (not secrets) on the public origin discloses that the (separate) backend ingest API is unauthenticated. Inspected safely; no keys/passwords/connection strings.
**Action (optional):** rename/remove for hygiene; if the referenced backend exists and is truly open, add auth there. Not a rotation emergency.

## R8 — Supply-chain (L, MONITORED)
Dev deps (ajv, vitest) had advisories; both were dev/CI-only and non-exploitable in our usage, now patched (ajv 8.20.0, vitest 3.2.7). CI runs `npm audit --audit-level=high` (advisory).

## R9 — Over-claiming verification (L, MITIGATED)
Risk of presenting a local hash/signature as proof source logs were immutable.
**Mitigation:** `verification.proves` and the UI state exactly what the hash proves; no "Verified expert" framing; methodology panel separates activity from skill/outcome.
