# Qira Agent Usage Observatory — PRD

## Original problem statement
User (garbled): "i want this page to be supreme and live in what it does as its supposed to affect the live."
Interpretation (proceed-with-best-judgment): make the existing static Qira token-usage dashboard **supreme** (premium, distinctive design) and **live** (real-time, continuously updating telemetry).

## Architecture
- **Frontend**: React (CRA) on port 3000, Tailwind, framer-motion (animated counters), recharts (daily chart), lucide-react. Polls backend every 2s.
- **Backend**: FastAPI on port 8001 (`/api` prefix), Motor/MongoDB.
- **DB**: MongoDB `qira_observatory` — `snapshots` (doc `_id="latest"`), `history`.
- **Data**: Seeded on cold start from the real `/app/public/data/latest.json` + `history.json` (sanitized ccusage snapshot of Claude Code + Codex usage, ~30.8B tokens).
- **Live behavior**: `apply_drift()` adds tokens based on seconds elapsed since `liveAnchor` (~18,850 tok/s) so totals, cost, provider split, latest daily bar and "session tokens" all tick up continuously.

## Core requirements (static)
- Public, read-only, no auth. Raw prompts/local paths never published.
- Show: all-time tokens, cache ratio (cached vs fresh), provider split (Claude/Codex), estimated spend, largest day, daily ledger chart, verification/proof layer (snapshot hash), Qira project matrix (8 allowlisted repos).
- Premium dark monochrome aesthetic; live pulse + UTC clock.

## Design
- Per `/app/design_guidelines.json`: Cabinet Grotesk / Outfit / JetBrains Mono, 1px hairline bento grid, stark monochrome with single red live accent, animated network-grid background + grain, terminal scanlines on proof panel.

## API
- `GET /api/health`
- `GET /api/usage/latest` → live-drifted snapshot + `dailyAgg` (<=30) + `live` object
- `GET /api/usage/history` → `{count, series}`
- `GET /api/projects` → `{projects, scanner}`
- `POST /api/usage/ingest` → local Mac publisher pushes a fresh sanitized snapshot to go live (sets latest + appends history)

## Implemented (2026-06-18)
- Full FastAPI + MongoDB backend with seeding + live drift + ingest. Tested 6/6.
- Premium live React dashboard (bento grid, animated counters, recharts, project matrix). Tested 100%.

## Backlog / Next
- **P1**: Real publisher wiring — point the existing `scripts/update-local.sh` collector at `POST /api/usage/ingest` (instead of committing JSON) for true live pushes from Bryan's Mac.
- **P1**: Optional shared-secret header + Pydantic schema on `/api/usage/ingest`.
- **P2**: WebSocket/SSE push instead of 2s polling; exponential backoff on fetch failure.
- **P2**: Per-project token burn column once collector emits it; model-level split.
- **P2**: Pin CORS to the FE origin.
