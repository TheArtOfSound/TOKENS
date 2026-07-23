# TOKENS — Roadmap

Tied to measurable gates (see `docs/product/PHASE_GATES.md`). Ordered by dependency and by the dossier's priority: data accuracy → privacy/trust → collector efficiency → verification integrity → reliability → profile → employer → visual → social.

## Now unblocked / immediate (needs Bryan or small work)
1. **Restore live publishing (R1).** Choose the canonical lineage (local `src/` vs origin `frontend/`), reconcile deliberately with a backup branch, re-enable the hardened launchd publisher. _Gate: `ledger.imagineqira.com` serves fresh data again._
2. **Incremental / scoped collector scan (R5).** Replace the full home-dir content scan with checkpointed, default-root, streaming scanning; cache project scan results. _Gate: no-change rescan fast; median scan <2s, p95 <5s._

## Verification integrity
3. **Ed25519 device signing.** Generate an on-device key (public key exported only), sign the canonical aggregate digest, publish signature + honest copy ("a local signature does not prove the source logs were immutable"). Add verify tests + rotation. _Gate: independent verification of the signature passes._

## Local ledger & efficiency (Phase 2)
4. **SQLite event ledger** (WAL, `schema_migrations`, `usage_events`, `daily_aggregates`, `source_checkpoints`, `sync_reports`) with integer micro-USD money and up/down migration tests. Replaces file-rewrite entirely.
5. **Adapter framework** behind a stable interface; keep Claude Code + Codex excellent before any Priority-1 source (Gemini CLI, Cursor, Windsurf, Ollama, LM Studio, provider APIs). Format-drift quarantine; never fabricate zero.
6. **Multi-language types** generated from the one canonical JSON Schema (TS now; Rust/Python when the core lands) with a CI drift check.

## Trust & consent
7. **Interactive upload preview** with per-field toggles; assert previewed digest == transmitted digest before any sync.
8. **Deletion & retention controls** for local derived data; documented retention.

## Cloud & network (Phase 2+, requires design + threat model)
9. **Authenticated ingest API** with replay protection (nonce), rate limiting, payload-signature verification, per-object authorization. Threat-model before build.
10. **Privacy-preserving aggregate research network** (opt-in, granular).

## Identity & opportunity (Phase 3–4, only after retention proven)
11. Professional profile leading with identity; evidence graph; verification categories.
12. One real employer/evaluation opportunity end-to-end (search by verified activity → contact).

## Future (Phase 5+, only on commercial pull)
13. Opportunity marketplace, employer search + ranking integrity, monetization (employer-side emphasis), always-labeled paid promotion separate from organic qualification.

## Explicitly deferred / non-goals
Enterprise workforce-intelligence / surveillance features; universal AI score; "Verified AI Expert" badge; fabricated counts/logos/testimonials; social feed before utility. See PHASE_GATES "Hard scope rules."
