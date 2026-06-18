#!/usr/bin/env bash
set -euo pipefail

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

npm install
npm run collect
npm run validate:data
npm run build

# --- Publish the fresh snapshot to the live observatory backend (if configured) ---
# Load TOKENS_INGEST_URL / TOKENS_INGEST_TOKEN from a local .env if present.
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
git push

echo "Published sanitized usage data."
