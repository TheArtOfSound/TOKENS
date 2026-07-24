# TOKENS — Initial System Audit

_Audit date: 2026-07-23 · Auditor: Claude (Opus 4.8) principal-engineer session · Branch: `feat/verified-ai-work-foundation`_

This is the verified, runtime-grounded state of the TOKENS project as found on Bryan's Mac. It deliberately separates **what the documentation claimed** from **what the running system actually does** (per the dossier: "Do not conflate documentation with verified runtime behavior").

> **Provenance note (added during the honesty pass).** The findings below were gathered from the untouched
> baseline *before* any code was changed. However, this file was **committed last** (`05776c3`), after the
> seven architectural commits — so git history alone does not demonstrate the claimed ordering. Treat the
> baseline figures here as recorded-then-committed, not as independently timestamped pre-change evidence.

## 1. Repository & environment (verified)

| Item | Value |
| --- | --- |
| Local checkout | `/Users/bry/Projects/TOKENS` (single dir; `Projects` and `projects` are the same inode on case-insensitive APFS) |
| Remote | `https://github.com/TheArtOfSound/TOKENS.git` (public) |
| Deploy target | GitHub Pages → custom domain `ledger.imagineqira.com` (`public/CNAME`) |
| Toolchain | node 22.22.3, npm 10.9.8, pnpm 9.15.4, tsc 6.0.3, python 3.14.5; `ccusage` present at `~/.npm-global/bin/ccusage`; no `bun`, no `docker` |
| Related repos (per dossier) | `TheArtOfSound/claude-usage-dashboard`, `TheArtOfSound/qev-desktop` (not audited this session) |

## 2. Actual architecture (verified by reading source + live site)

The deployed product is **NOT** the "FastAPI + MongoDB live backend" the dossier's summary described. The real system is:

```
Bryan's Mac (local, private)
  ccusage claude daily --json / ccusage codex daily --json   (reads local agent logs)
    -> collector/collectV2.ts normalizes + sanitizes
    -> writes public/data/latest.json (+ history.json)
    -> scripts/update-local.sh commits & pushes public data
    -> launchd job runs update-local.sh every 30 min (StartInterval 1800)
  GitHub Actions (.github/workflows/pages.yml) validates + builds + deploys dist/ to GitHub Pages
```

- **Frontend:** Vite 8 + React 19 + TypeScript, single-page dashboard (`src/App.tsx`, `src/lib/*`). Reads only `public/data/latest.json`.
- **Collector:** `collector/collectV2.ts` (v0.3.0) is authoritative (`npm run collect`). `collector/collect.ts` (v0.2.1) is legacy/unused. `qiraScanner.ts` scans local dirs for an allowlist of Qira projects. `validateLatest.ts` was a blocklist safety check.
- **There is no backend, database, or auth endpoint in this repository.** The dossier's `/api/usage/ingest` etc. are aspirational or belong to a related repo.

## 3. Critical findings

### F1 — Publishing pipeline is broken; live site is stale (HIGH, reliability)
Local `main` is **1,252 commits ahead of `origin/main`** and **11 behind**. The histories **diverged** at merge-base `216d9c9`. The launchd job commits every 30 min then `git push`, which **fails** every time:
```
! [rejected] main -> main (fetch first)
```
So the 30-minute automation has been silently failing for weeks. The live `latest.json` at `ledger.imagineqira.com` is dated **2026-06-18** — roughly five weeks stale — while local data is current. The site is HTTP 200 but frozen.

### F2 — Two competing automations forked the repo (HIGH, change management)
- **Local `main`:** the `src/` TypeScript/Vite app + this collector. Commits are `data: update agent usage <ISO>`.
- **`origin/main`:** a *different* architecture — a `frontend/` tree of plain `.js` components + Tailwind, plus `memory/` and `test_reports/`, and a very large `history.json` (~926k lines). Commits are `Auto-generated changes` / `auto-commit for <uuid>` from a different (likely cloud) agent that appears to have stopped ~2026-06-18.
- **Decision required from Bryan:** which lineage is canonical. Not resolved this session (would rewrite the deployed site and could clobber the other automation's work). Both are preserved.

### F3 — `history.json` is 28 MB, rewritten every run, never used (HIGH, efficiency)
The old collector appended a **full snapshot** to `history.json` every run and kept the last 500 → a 28 MB file rewritten in full every 30 minutes (each commit ~8,800 insertions / ~8,500 deletions). **The frontend never loads `history.json`.** Pure git and deploy bloat. **Fixed this session** (see DECISIONS D3).

### F4 — Validator was blocklist-only (HIGH, privacy)
`validateLatest.ts` scanned for a handful of path/secret regexes over `latest.json` only. The dossier mandates an **allowlist publication transform** (construct the published object from approved fields, so unknown fields cannot leak). **Fixed this session** (D4, D5).

### F5 — No measurement-class provenance (HIGH, data integrity)
Reported, derived, and estimated values were indistinguishable; `estimatedCostUsd` (a price-table estimate) sat alongside exact token counts with no labeling. **Fixed this session** (D2).

### F6 — All dependencies pinned to `"latest"` (MEDIUM, reproducibility)
`package.json` used `"latest"` for every dependency — non-reproducible builds. **Fixed this session** (D6): pinned to exact installed versions.

### F7 — Zero automated tests (HIGH, verifiability)
No test runner, no tests. **Fixed this session** (D7): 92 tests across normalization, dedup, privacy/redaction, allowlist publication, schema validation, history, and strangler equivalence.

### F8 — Collector scanner is slow / broad (MEDIUM, efficiency + privacy)
`qiraScanner.ts` walks `~/Projects, ~/nous, ~/Developer, ~/Code, ~/Desktop, ~/Sites, ~/Documents` to depth 5 and reads up to 20 KB of up to 80 files per candidate for scoring. A full run exceeded 2 minutes interactively. Only derived metadata is published (never file contents), but the scan is expensive and reads broadly. Scoped via `QIRA_SCAN_ROOTS`. Flagged for incremental/scoped redesign — this is **dossier Phase 1 scope**, not roadmap.

### F9 — `memory/test_credentials.md` on `origin/main` (LOW, hygiene — NOT a secret leak)
A file by that name exists on `origin/main` (public repo). Inspected safely (redacted): it is a **notes file** stating the app has no auth and describing the Mongo collection layout in prose. **No API keys, passwords, or connection strings** were found. Recommendation: rename/remove for hygiene; it does disclose that a backend ingest API is unauthenticated. No credential rotation emergency.

## 4. Baseline verification (before changes)
- `npm run typecheck` → exit 0
- `npm run build` → exit 0 (dist: index 0.61 kB, css 8.88 kB, js 206 kB)
- `ccusage claude daily --json` → 68 rows, path-free (0 `/Users/` occurrences); `ccusage` aggregate mode is privacy-safe.
- Live site `ledger.imagineqira.com` → HTTP 200, data stale (2026-06-18).

## 5. Protective actions taken
- Disabled the launchd job for the session (`launchctl bootout gui/<uid>/com.qira.tokens.collector`) so it cannot pollute the working branch or pile up more unpushable commits. **Reversible** — see SESSION_STATE for the re-enable command.
- Created recovery branch `recovery/main-2026-07-23` at `c7154ba` (preserves the 1,252 local commits by name).
- Backed up the untracked `package-lock.json` baseline to the session scratchpad.
- All work is on `feat/verified-ai-work-foundation`; `main` and `origin` are untouched.
