#!/usr/bin/env bash
#
# TOKENS collector installer — macOS and Linux.
#
#   curl -fsSL https://ledger.imagineqira.com/install.sh | bash
#
# This script only installs the open-source collector. It does not read provider
# logs, create a public profile, or publish anything.
#
set -euo pipefail

REPO_URL="https://github.com/TheArtOfSound/TOKENS.git"
INSTALL_DIR="${TOKENS_DIR:-$HOME/TOKENS}"
MIN_NODE_MAJOR=22

say()  { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

say "TOKENS collector installer (macOS / Linux)"
echo

command -v git >/dev/null 2>&1 || die "git is required. Install it and re-run."
command -v node >/dev/null 2>&1 || die "Node.js $MIN_NODE_MAJOR+ is required. Install it from https://nodejs.org and re-run."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  die "Node $MIN_NODE_MAJOR+ is required (found $(node -v))."
fi
info "git: $(git --version | awk '{print $3}')   node: $(node -v)"

if [ -d "$INSTALL_DIR/.git" ]; then
  say "Updating existing checkout at $INSTALL_DIR"
  git -C "$INSTALL_DIR" pull --ff-only || die "Could not update the existing checkout. Resolve local changes in $INSTALL_DIR and re-run."
else
  [ -e "$INSTALL_DIR" ] && die "$INSTALL_DIR exists but is not a git checkout. Move it aside or set TOKENS_DIR."
  say "Cloning the collector into $INSTALL_DIR"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

say "Installing dependencies"
( cd "$INSTALL_DIR" && npm ci --silent )

echo
say "Installed. Nothing has been read or published."
echo
info "Start the guided local setup:"
info "cd \"$INSTALL_DIR\" && npm run join"
echo
info "The wizard creates your profile, asks which sources may be read, measures locally,"
info "shows the exact public payload, and only then offers public directory enrollment."
echo
info "Open guide: https://ledger.imagineqira.com/join"
info "Uninstall: rm -rf \"$INSTALL_DIR\""
echo
