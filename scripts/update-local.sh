#!/usr/bin/env bash
set -euo pipefail

# Local publisher for TOKENS. Collects sanitized usage, validates it, builds the
# site, and publishes changed public data — WITHOUT ever accumulating a backlog
# of unpushable commits or force-pushing over a diverged remote.

export PATH="$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Nobody is at the keyboard here: launchd runs this every 30 minutes with stdio
# pointed at log files. Anything that might ask a question must know that, and
# must never treat silence as a yes.
#
# The collector already infers this from stdin not being a TTY, but that
# inference would quietly break if this script were ever wrapped in a pty, run
# under a CI runner, or invoked through a tool that allocates a terminal. Stating
# it explicitly means the consent guarantee does not depend on stdio plumbing.
export TOKENS_NON_INTERACTIVE=1

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found." >&2
  exit 1
fi

if ! command -v ccusage >/dev/null 2>&1; then
  echo "ccusage was not found on PATH. Creating local npx fallback wrapper." >&2
  mkdir -p "$REPO_DIR/.tmp-bin"
  cat > "$REPO_DIR/.tmp-bin/ccusage" <<'WRAPPER'
#!/usr/bin/env bash
exec npx -y ccusage@latest "$@"
WRAPPER
  chmod +x "$REPO_DIR/.tmp-bin/ccusage"
  export PATH="$REPO_DIR/.tmp-bin:$PATH"
fi

if ! command -v ccusage >/dev/null 2>&1; then
  echo "ccusage still could not be resolved after fallback setup." >&2
  echo "Try manually: npm install -g ccusage" >&2
  echo "The dashboard will keep using the last published snapshot." >&2
  exit 1
fi

# Install only if needed (immutable). node_modules present => skip the ~30s reinstall.
[ -d node_modules ] || npm ci

# Ingest BEFORE collect. The collector now publishes from the event ledger, so
# skipping this would republish whatever the ledger last held and the site would
# silently freeze while still looking freshly generated.
npm run ingest
npm run collect
npm run validate:data
npm run build

# The collector is idempotent: if usage data did not change it rewrites nothing,
# so there is nothing to commit and we exit quietly (no more 30-minute no-op commits).

# --- Optional: publish the snapshot to a live ingest endpoint (from the origin lineage) ---
# Kept from origin/main. Entirely opt-in: with the env vars unset this is a no-op,
# so the default path stays local-first with no network egress. The payload is the
# already-sanitized, schema-validated, signed public snapshot -- never raw logs.
if [ -f "$REPO_DIR/.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$REPO_DIR/.env"; set +a
fi

if [ -n "${TOKENS_INGEST_URL:-}" ] && [ -n "${TOKENS_INGEST_TOKEN:-}" ]; then
  echo "Publishing snapshot to live observatory: $TOKENS_INGEST_URL"
  HTTP_CODE="$(curl -sS -o /tmp/qira-ingest-response.json -w "%{http_code}" \
    -X POST "$TOKENS_INGEST_URL" \
    -H "Content-Type: application/json" \
    -H "X-Ingest-Token: $TOKENS_INGEST_TOKEN" \
    --data-binary @"$REPO_DIR/public/data/latest.json" || echo "000")"
  if [ "$HTTP_CODE" = "200" ]; then
    echo "Live observatory updated (HTTP 200)."
  else
    echo "WARNING: ingest POST returned HTTP $HTTP_CODE" >&2
    cat /tmp/qira-ingest-response.json >&2 || true
    echo >&2
  fi
else
  echo "Skipping live observatory push (TOKENS_INGEST_URL / TOKENS_INGEST_TOKEN not set)."
fi

if git diff --quiet -- public/data; then
  echo "No public data changes to publish."
  exit 0
fi

# Stage all published public data artifacts the collector may rewrite.
git add \
  public/data/latest.json \
  public/data/history.json \
  public/data/agent-evidence.md \
  public/data/badge.svg \
  public/data/badge-mark.svg \
  public/data/badge-card.svg \
  public/data/key-history.json \
  public/data/revoked-keys.json \
  public/data/claim-authority.json \
  public/data/profiles/index.json
git commit -m "data: update agent usage $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Only push when it is a safe fast-forward. If the remote has diverged (as it did
# historically between two competing automations), DO NOT force and DO NOT loop:
# report clearly and leave the commit local for a human to reconcile.
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if ! git fetch origin "$BRANCH" >/dev/null 2>&1; then
  echo "WARN: git fetch failed; leaving commit local. Will retry next run." >&2
  exit 0
fi

BEHIND="$(git rev-list --count "HEAD..origin/$BRANCH" 2>/dev/null || echo 0)"
if [ "$BEHIND" != "0" ]; then
  # Being behind origin is now NORMAL, not a divergence signal. Every merged
  # directory-join pull request advances origin/main, and this job runs every 30
  # minutes. The old behaviour — warn and exit 0 — meant that the first time
  # anybody joined the directory, this pipeline stopped publishing and kept
  # LOOKING healthy: exit code 0, a fresh local commit, and a site frozen at the
  # last successful push.
  #
  # A rebase is safe here in a way a force-push is not: it never rewrites origin.
  # If the histories have genuinely diverged (the historical R1 incident, two
  # competing automations), the rebase conflicts — and then we abort and bail
  # exactly as before rather than looping or forcing.
  echo "Local '$BRANCH' is $BEHIND commit(s) behind origin; rebasing onto it." >&2
  if ! git pull --rebase --autostash origin "$BRANCH" >/dev/null 2>&1; then
    git rebase --abort >/dev/null 2>&1 || true
    echo "WARN: rebase onto origin/$BRANCH failed — histories have truly diverged." >&2
    echo "      Not forcing and not looping. A human must reconcile." >&2
    echo "      See docs/execution/RISKS.md (R1)." >&2
    exit 0
  fi
fi

git push
echo "Published sanitized usage data."
