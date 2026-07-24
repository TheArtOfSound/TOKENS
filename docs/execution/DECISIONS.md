# TOKENS — Engineering Decision Record

ADR-style log of material decisions made this session, with rationale, so future engineers understand _why_. Newest first.

Governing order of authority (from the dossier): protect data/secrets → preserve working behavior + recoverability → follow the dossier → prefer runtime evidence → prefer robust over flashy → prefer narrow working slices → record decisions.

---

## D1 — Build on a feature branch off local `main`; do not resolve the origin divergence
**Decision:** All work lands on `feat/verified-ai-work-foundation` branched from local `main` (`c7154ba`). We did **not** reconcile the 1,252-ahead / 11-behind divergence with `origin/main`, and did not force-push.
**Why:** The divergence is between two different app architectures (local `src/` TS app vs. origin `frontend/` JS app). Choosing a winner rewrites the deployed site and could clobber the other automation's work — a business/ownership decision that is Bryan's, not the agent's. Recovery branch `recovery/main-2026-07-23` preserves the local commits.
**Reversible:** Yes. Nothing on `main`/`origin` was changed.

## D2 — Introduce a versioned canonical evidence model with mandatory measurement classes
**Decision:** New `collector/lib/canonical.ts` defines `CANONICAL_SCHEMA_VERSION = 2.0.0` and the five measurement classes (`provider_reported`, `application_reported`, `collector_derived`, `tokenizer_estimated`, `user_submitted`). Every published metric family carries a `measurementClass`, `confidence`, and `method`. A published `measurement` block exposes this, keeps `exactTotalTokens` separate from `estimatedOnly.costUsd`, and states plainly that activity ≠ skill.
**Why:** The dossier's #1 principle is evidence classes, not vague "verified." Grounded in the real `ccusage` shape: input/output/cache tokens are provider-reported; totals are our deterministic sums; cost is a price-table estimate. Estimates are never summed into exact totals.
**Reversible:** Additive to the JSON contract; frontend degrades gracefully if absent.

## D3 — Replace the 28 MB append-forever `history.json` with a compact derived series
**Decision:** `history.json` is now a `compact_daily_series` (`collector/lib/history.ts`): one point per (date, provider), rebuilt deterministically from `daily`. A few KB instead of 28 MB.
**Why:** The old file was rewritten in full every 30 minutes, never loaded by the frontend, and dominated git history. The compact series is idempotent, useful for trend charts, and validated for size (<4 MB hard cap in the validator). No real data is lost — the per-day totals are fully preserved; only redundant repeated full snapshots are dropped. Prior versions remain in git history / the recovery branch.
**Reversible:** Yes (revert the file + collector).

## D4 — Replace the blocklist validator with an allowlist **publication transform**
**Decision:** `collector/lib/publish.ts` **constructs** the published object from an allowlist of approved fields (`publishSnapshot`), rather than redacting a raw object. Unknown fields cannot pass through. Free-form values (model names, branch/commit, scripts, warnings) are individually run through the secret scanner and dropped if they trip a rule.
**Why:** A blocklist leaks anything it did not anticipate; the dossier mandates allowlist construction. Proven by test: adversarial drafts with planted secrets produce a published object with **zero** prohibited findings.
**Reversible:** Yes.

## D5 — Defense-in-depth nested secret/PII/path scanner
**Decision:** `collector/lib/secretScan.ts` walks nested arrays/objects **and object keys**, matches macOS/Windows/Linux paths, provider key shapes (Anthropic/OpenAI/AWS/GitHub/Google/Slack), JWTs, PEM/OpenSSH keys, credential assignments, `.env` refs, and emails, plus base64-decoded variants and control characters. Findings are redacted (never contain the raw secret).
**Why:** Content minimization + the prohibited-field list are non-negotiable trust guarantees; secrets can appear in unexpected nested fields.
**Known limitation:** Does not attempt to detect arbitrary hostnames/usernames outside path context (would false-positive). Documented in PRIVACY_BOUNDARY.

## D6 — Pin all dependencies to exact versions; add `npm ci` to CI
**Decision:** `package.json` pins every dependency to the exact installed version (react 19.2.7, vite 8.0.16, typescript 6.0.3, tsx 4.22.4, ajv 8.20.0, vitest 3.2.7, etc.). CI switched from `npm install` to `npm ci` for immutable installs.
**Why:** `"latest"` everywhere made builds non-reproducible (dossier P0.4). Pinned only after the baseline build was verified green.

## D7 — Add a real test suite (vitest) and wire it into CI as a release gate
**Decision:** 71 tests across normalization/dedup, adversarial privacy, allowlist publication, JSON-Schema validation, compact history, and strangler equivalence. CI runs typecheck → tests → validate:data → build; any failure blocks deploy.
**Why:** Zero tests meant no change was safe. Successful compilation is not completion.

## D8 — Idempotent collector + no-clobber + fail-closed publication
**Decision:** The collector (1) skips writing when the usage content is unchanged (content hash excludes the timestamp) → no more 30-minute no-op commits; (2) never overwrites a good snapshot with an empty one from a transient `ccusage` failure; (3) refuses to write if the constructed object contains any prohibited pattern.
**Why:** Directly addresses the commit-storm, data-loss, and leak risks. Matches the dossier's idempotency and fail-closed requirements.

## D9 — Disable the launchd job for the session
**Decision:** `launchctl bootout` the collector agent during this session.
**Why:** It was piling up unpushable commits and would otherwise commit onto the working branch mid-edit. Protective and reversible. Re-enable command is in SESSION_STATE. The fixed collector + push logic should be re-installed before re-enabling.
