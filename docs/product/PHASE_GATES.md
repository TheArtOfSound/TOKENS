# TOKENS — Phase Gates

Each phase advances only on **objective evidence** (dossier §07). Do not build the social/marketplace/enterprise layer before the collector and privacy foundation are proven. Prefer one fully-working vertical slice over many half-built screens.

## Phase 0 — Reproducible baseline  ✅ (this session)
**Exit gate:** the observatory can be rebuilt, scanned, validated, and deployed with zero undocumented manual steps.
- ✅ Clean `npm ci` install; typecheck; tests; `validate:data`; build all green.
- ✅ Deploy path documented (CI: `npm ci` → typecheck → test → validate → audit → build → Pages).
- ✅ Baseline audit, recovery branch, pinned deps.

## Phase 1 — Trustworthy local measurement foundation  ◑ (largely done)
**Exit / Technical Alpha gate:** canonical schema stable; Claude Code + Codex fixtures parsed; incremental/idempotent scan + dedup tested; privacy adversarial suite passing; local dashboard works offline; no raw content in normalized data or any payload.
- ✅ Canonical evidence model 2.0.0 with measurement classes.
- ✅ Claude Code + Codex parsed from real ccusage; totals reconciled.
- ✅ Deterministic dedup + no-inflation, idempotent content hash.
- ✅ Allowlist publication + nested secret scan + adversarial fixtures (build-failing).
- ✅ Offline dashboard renders real normalized data with provenance labels.
- ◑ Signed aggregate (Ed25519 device signing) — designed, not yet implemented (roadmap).
- ◑ Incremental checkpoint scan to meet perf budget — roadmap (currently full scan, scoped).
- ⬜ Live publishing restored — blocked on R1 (origin divergence, Bryan decision).

## Phase 2 — Local ledger & efficiency  ⬜
SQLite event ledger (WAL, migrations, `usage_events`, `daily_aggregates`, checkpoints), incremental/streaming scan, replacing the file-rewrite model entirely. Gate: no-change rescan is fast with zero new inserts; median scan <2s, p95 <5s.

## Phase 3 — Verified public identity  ⬜
Professional profile leading with identity (not a token number), evidence graph, verification categories (collector-verified / provider-reported / identity-verified / outcome-verified). Gate: ≥70% of testers find the local dashboard useful without any public-profile features (proves the free tier stands alone first).

## Phase 4 — First real opportunity  ⬜
A single, real employer/evaluation use case end-to-end (search by verified activity → contact). Gate: one genuine paid opportunity completed. No marketplace, messaging, or social feed before this.

## Phase 5+ — Marketplace, employer search, monetization, enterprise  ⬜ (future)
Only after Phases 1–4 produce usage and commercial pull. Paid promotion always labeled and provably independent of evidence/verification. No universal AI score; no fabricated counts/logos/testimonials; no enterprise surveillance features.

## Hard scope rules (always in force)
- No Priority-1+ collector adapter (Gemini, Cursor, Windsurf, Ollama, …) until Claude Code + Codex are excellent and reconciled.
- No cloud backend / employer search / opportunities this phase.
- No "Verified AI Expert" badge or single opaque score, ever.
- Paid placement is always labeled and cannot alter evidence, verification, or organic ranking.
