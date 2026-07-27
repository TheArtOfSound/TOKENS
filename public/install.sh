#!/usr/bin/env bash
#
# TOKENS collector installer — macOS and Linux.
#
#   curl -fsSL https://ledger.imagineqira.com/install.sh | bash
#
# PLEASE READ THIS BEFORE PIPING IT TO A SHELL. Everything it does is below and
# it is deliberately boring:
#   - checks you have git and Node 22+
#   - clones (or updates) the open-source collector into ~/TOKENS
#   - runs `npm ci`
#   - prints the next steps and an uninstall command
#
# It does NOT read your logs, does NOT publish anything, and does NOT set up any
# background job. Measuring and publishing are separate, explicit commands you
# run yourself afterward. Nothing leaves your machine here.
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

# 1. Prerequisites -----------------------------------------------------------
command -v git >/dev/null 2>&1 || die "git is required. Install it and re-run."
command -v node >/dev/null 2>&1 || die "Node.js $MIN_NODE_MAJOR+ is required (https://nodejs.org). Install it and re-run."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  die "Node $MIN_NODE_MAJOR+ is required (found $(node -v)). The collector uses node:sqlite, added in Node 22."
fi
info "git: $(git --version | awk '{print $3}')   node: $(node -v)"

# 2. Clone or update ---------------------------------------------------------
if [ -d "$INSTALL_DIR/.git" ]; then
  say "Updating existing checkout at $INSTALL_DIR"
  git -C "$INSTALL_DIR" pull --ff-only || info "Could not fast-forward; leaving your local changes untouched."
else
  [ -e "$INSTALL_DIR" ] && die "$INSTALL_DIR exists but is not a git checkout. Move it aside or set TOKENS_DIR."
  say "Cloning the collector into $INSTALL_DIR"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

# 3. Install dependencies ----------------------------------------------------
say "Installing dependencies (npm ci)"
( cd "$INSTALL_DIR" && npm ci --silent )

# 4. Done — print the explicit next steps ------------------------------------
echo
say "Installed. Nothing has been read or published yet — that is up to you."
echo
info "cd \"$INSTALL_DIR\""
info "npm run consent          # see exactly what would be read, and turn any of it off"
info "npm run ingest           # measure your local Claude Code / Codex usage (~20s first run)"
info "npm run consent:preview  # review the exact payload before anything is published"
info "npm run collect          # build + sign your profile snapshot (private key never leaves this machine)"
info "npm run publish:ledger -- --handle YOU --email you@example.com   # optional: publish to Ledger (explicit only)"
echo
info "Or open the guided UI: https://ledger.imagineqira.com/join"
info "Uninstall:         rm -rf \"$INSTALL_DIR\"   (and, on macOS, delete the 'tokens device key' item in Keychain Access)"
echo
