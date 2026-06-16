#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.qira.tokens.collector.plist"
LOG_DIR="$REPO_DIR/collector/local-logs"
LAUNCHD_PATH="$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
QIRA_SCAN_ROOTS_VALUE="$HOME/Projects,$HOME/nous,$HOME/Desktop,$HOME/Developer,$HOME/Code"
mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

if [[ "$REPO_DIR" == "$HOME/Desktop"* || "$REPO_DIR" == "$HOME/Documents"* || "$REPO_DIR" == "$HOME/Downloads"* ]]; then
  echo "Warning: this repo is inside Desktop/Documents/Downloads." >&2
  echo "macOS privacy controls can block launchd from running scripts there." >&2
  echo "Recommended: move the repo to ~/Projects/TOKENS and reinstall this launchd job." >&2
fi

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.qira.tokens.collector</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$LAUNCHD_PATH</string>
    <key>QIRA_SCAN_ROOTS</key>
    <string>$QIRA_SCAN_ROOTS_VALUE</string>
  </dict>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO_DIR/scripts/update-local.sh</string>
  </array>
  <key>StartInterval</key>
  <integer>1800</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/launchd.err.log</string>
  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || launchctl load "$PLIST"
launchctl kickstart -k "gui/$(id -u)/com.qira.tokens.collector" >/dev/null 2>&1 || launchctl start com.qira.tokens.collector || true

echo "Installed launchd publisher: $PLIST"
echo "Runs every 30 minutes while this Mac is awake."
echo "Qira scan roots: $QIRA_SCAN_ROOTS_VALUE"
