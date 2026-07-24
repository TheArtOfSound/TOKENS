# TOKENS collector installer - Windows (PowerShell).
#
#   irm https://ledger.imagineqira.com/install.ps1 | iex
#
# PLEASE READ THIS BEFORE RUNNING IT. Everything it does is below and it is
# deliberately boring:
#   - checks you have git and Node 22+
#   - clones (or updates) the open-source collector into %USERPROFILE%\TOKENS
#   - runs `npm ci`
#   - prints the next steps and an uninstall command
#
# It does NOT read your logs, does NOT publish anything, and does NOT set up any
# scheduled task. Measuring and publishing are separate, explicit commands you
# run yourself afterward. Nothing leaves your machine here.

$ErrorActionPreference = 'Stop'

$RepoUrl    = 'https://github.com/TheArtOfSound/TOKENS.git'
$InstallDir = if ($env:TOKENS_DIR) { $env:TOKENS_DIR } else { Join-Path $HOME 'TOKENS' }
$MinNodeMajor = 22

function Say($m)  { Write-Host $m -ForegroundColor White }
function Info($m) { Write-Host "  $m" }
function Die($m)  { Write-Host "error: $m" -ForegroundColor Red; exit 1 }

Say 'TOKENS collector installer (Windows)'
Write-Host ''

# 1. Prerequisites
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Die 'git is required. Install it (https://git-scm.com) and re-run.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die "Node.js $MinNodeMajor+ is required (https://nodejs.org). Install it and re-run." }

$nodeMajor = [int](node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt $MinNodeMajor) { Die "Node $MinNodeMajor+ is required (found $(node -v)). The collector uses node:sqlite, added in Node 22." }
Info "git: $((git --version).Split(' ')[2])   node: $(node -v)"

# 2. Clone or update
if (Test-Path (Join-Path $InstallDir '.git')) {
  Say "Updating existing checkout at $InstallDir"
  git -C $InstallDir pull --ff-only
} elseif (Test-Path $InstallDir) {
  Die "$InstallDir exists but is not a git checkout. Move it aside or set `$env:TOKENS_DIR."
} else {
  Say "Cloning the collector into $InstallDir"
  git clone --depth 1 $RepoUrl $InstallDir
}

# 3. Install dependencies
Say 'Installing dependencies (npm ci)'
Push-Location $InstallDir
try { npm ci --silent } finally { Pop-Location }

# 4. Done - explicit next steps
Write-Host ''
Say 'Installed. Nothing has been read or published yet - that is up to you.'
Write-Host ''
Info "cd `"$InstallDir`""
Info 'npm run consent          # see exactly what would be read, and turn any of it off'
Info 'npm run ingest           # measure your local Claude Code / Codex usage (~20s first run)'
Info 'npm run consent:preview  # review the exact payload before anything is published'
Info 'npm run collect          # build + sign your profile snapshot (private key never leaves this machine)'
Write-Host ''
Info 'Full walkthrough:  https://ledger.imagineqira.com/join'
Info "Uninstall:         Remove-Item -Recurse -Force `"$InstallDir`""
Write-Host ''
