# TOKENS — Progress Log

## 2026-07-23 · `feat/verified-ai-work-foundation`

### Audit & safety
- Located and audited the real system (see INITIAL_AUDIT). Confirmed the deployed architecture is a static GitHub Pages site + local ccusage collector — not the FastAPI/MongoDB backend the dossier's summary implied.
- Found and documented: origin/local divergence (1,252 ahead), stale live site, 28 MB dead `history.json`, blocklist-only validator, `"latest"` deps, zero tests, no provenance, slow scanner. Confirmed `memory/test_credentials.md` is a notes file, not exposed secrets.
- Created recovery branch, backed up lockfile, disabled the launchd job, established a green baseline (typecheck + build) before changes.

### Built (data accuracy, privacy, reliability — the top of the priority order)
- **Canonical evidence model** (`collector/lib/canonical.ts`, schema `2.0.0`) with the five measurement classes and per-metric provenance.
- **Pure, tested collector core**: `normalize.ts` (derive totals as sums, deterministic dedup, reconciliation warnings), `snapshot.ts` (assembly), `history.ts` (compact series).
- **Allowlist publication transform** (`publish.ts`) — constructs the published object from approved fields; unknown fields cannot pass through.
- **Nested secret/PII/path scanner** (`secretScan.ts`) with base64 + control-char handling; fail-closed collector write.
- **Upgraded validator** (`validateLatest.ts`): JSON-Schema (Ajv 2020) + hash verification + secret scan over `latest.json` and `history.json`.
- **92 tests** (vitest) incl. adversarial privacy fixtures and strangler equivalence.
- **Idempotent + no-clobber collector**; **history.json 28 MB → 27 KB**.
- **Frontend honesty UI**: evidence tags per metric, Measurement & Methodology panel, honest "hash proves" copy.
- **Pinned deps + hardened CI** (`npm ci`, typecheck, tests, validate, audit, build); **0 vulnerabilities**.
- **Hardened publisher** (`update-local.sh`): skips no-ops, refuses to push over a diverged remote, never force-pushes.
- **Documentation**: full `docs/**` set (audit, decisions, risks, session state, validation metrics, system overview, canonical schema, threat model, privacy boundary, phase gates, product requirements, roadmap) + SECURITY.md.

### Verified
- Chrome at 1440×900 and 375×812: methodology panel + evidence tags render, no console errors, no horizontal overflow, no leaked strings in served assets.

### Added — professional profile layer (evidence-backed identity)
- **`collector/lib/profile.ts`** (pure, tested): derives active AI-work days, current/longest streak, active-last-30/90, tools, models, projects from measured daily data; honest verification categories (never fakes identity/work verification).
- **`profile/profile.json`** — self-submitted identity config (sanitized, labeled unverified).
- Profile block routed through the allowlist + secret-scan pipeline (a bio cannot leak a path/key — proven by tests).
- **Frontend `ProfileView`**: identity-first card, verification chips, measured stat tiles, tools/models, work categories, availability, and a 26-week GitHub-style activity heatmap.
- Fixed a pre-existing mobile horizontal-overflow bug (28-bar chart + fixed decorative SVG).
- +8 tests (43 total); real derived data: 95 active days, 26-day longest streak, active 29/30 last days.

### Not done (deferred by design — see ROADMAP)
- Origin/local reconciliation (needs Bryan — R1).
- Cloud sync backend, authenticated ingest, SQLite ledger, Rust core, incremental checkpoint scan, Ed25519 device signing, opportunity marketplace, employer search. (Connected work-artifact verification IS built — see IMPLEMENTATION_STATUS; only third-party *outcome* verification remains unbuilt.)
