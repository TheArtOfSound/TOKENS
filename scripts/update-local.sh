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

if git diff --quiet -- public/data; then
  echo "No public data changes to publish."
  exit 0
fi

git add public/data/latest.json public/data/history.json
git commit -m "data: update agent usage $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push

echo "Published sanitized usage data."
