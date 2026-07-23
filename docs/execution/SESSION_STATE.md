# TOKENS — Session State & Handoff

_Written so another engineer (or agent) can continue without guessing. Session: 2026-07-23._

## Where things stand
- Working branch: **`feat/verified-ai-work-foundation`** (off local `main` at `c7154ba`).
- `main` and `origin/main` are **untouched** and still diverged (see RISKS R1).
- Recovery branch **`recovery/main-2026-07-23`** points at `c7154ba` (preserves the 1,252 local data commits).
- The launchd collector job is **disabled** for safety (R6).
- Regenerated `public/data/latest.json` (schema 2.0.0) + compact `history.json` are on the branch and validated.
- All checks green: typecheck, 35 tests, `validate:data`, build, `npm audit` (0 vulns).

## To reopen and continue the project
```bash
cd ~/Projects/TOKENS
git switch feat/verified-ai-work-foundation
npm ci
npm test && npm run typecheck && npm run build
npm run dev            # http://localhost:5199
```

## To re-run the collector (note: the scan is slow; scope it)
```bash
cd ~/Projects/TOKENS
QIRA_SCAN_ROOTS="$HOME/Projects,$HOME/nous" npm run collect
npm run validate:data
```

## To re-enable the launchd publisher (ONLY after reconciling R1)
Re-enabling before the origin divergence (R1) is resolved will resume failing pushes. Once `main` can fast-forward to `origin/main` (or you have chosen a lineage):
```bash
cd ~/Projects/TOKENS
bash scripts/install-launchd.sh      # reinstalls with the hardened update-local.sh
# to stop it again:
launchctl bootout gui/$(id -u)/com.qira.tokens.collector
```
The hardened `update-local.sh` will now: skip no-op runs (idempotent), refuse to push over a diverged remote, and never force-push.

## Options for resolving the origin divergence (R1) — Bryan decides
1. **Adopt local lineage** (the `src/` TS app + this foundation): back up origin first (`git branch backup/origin-main origin/main`), then publish local `main` deliberately. This discards origin's `frontend/` JS app on the live branch (kept in the backup branch).
2. **Adopt origin lineage** (the `frontend/` JS app): rebase/cherry-pick this foundation's collector work onto origin, or port it. More work; keeps the deployed app.
3. **Fresh reconciliation branch:** create a new `main` from the chosen base and merge the wanted pieces explicitly.
Whatever you choose: **do not force-push without a backup branch**, and make the change in one deliberate step, not via the 30-minute automation.

## Recovery / rollback
- Undo all session work: `git switch main` (branch is untouched) — the feature branch can be deleted.
- Restore the original untracked lockfile baseline: `scratchpad/package-lock.baseline.json` (session scratchpad).
- The pre-session HEAD is `c7154ba` (also `recovery/main-2026-07-23`).

## Key files added/changed this session
- Added: `collector/lib/{canonical,normalize,secretScan,publish,history,snapshot}.ts`, `collector/lib/__tests__/*.test.ts`, `collector/fixtures/*`, `collector/schema/canonical-snapshot.schema.json`, `vitest.config.ts`, `.claude/launch.json`, `docs/**`.
- Rewritten: `collector/collectV2.ts`, `collector/validateLatest.ts`, `scripts/update-local.sh`, `.github/workflows/pages.yml`, `package.json`.
- Frontend: `src/App.tsx`, `src/lib/usage.ts`, `src/styles.css` (measurement/methodology UI).
- Legacy `collector/collect.ts` (v0.2.1) left in place, unused; safe to delete once confirmed unreferenced.

## Next highest-value step
Resolve R1 (choose the canonical lineage), then re-enable the hardened publisher so the live site updates again. After that: implement the incremental/scoped collector scan (R5) to meet the performance budget.
