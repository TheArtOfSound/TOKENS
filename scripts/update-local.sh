#!/usr/bin/env bash
set -euo pipefail

# Local publisher for TOKENS. Collects sanitized usage, validates it, builds the
# site, and publishes changed public data — WITHOUT ever accumulating a backlog
# of unpushable commits or force-pushing over a diverged remote.

export PATH="$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

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

git add public/data/latest.json public/data/history.json
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
  echo "WARN: local '$BRANCH' is $BEHIND commit(s) behind origin (histories have diverged)." >&2
  echo "      Not pushing to avoid a rejected push loop or an unsafe force-push." >&2
  echo "      A human must reconcile local vs origin. See docs/execution/RISKS.md (R1)." >&2
  exit 0
fi

git push
echo "Published sanitized usage data."
