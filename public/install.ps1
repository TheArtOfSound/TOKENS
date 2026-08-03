# TOKENS collector installer - Windows PowerShell.
#
#   irm https://ledger.imagineqira.com/install.ps1 | iex
#
# This script only installs the open-source collector. It does not read provider
# logs, create a public profile, or publish anything.

$ErrorActionPreference = 'Stop'

$RepoUrl = 'https://github.com/TheArtOfSound/TOKENS.git'
$InstallDir = if ($env:TOKENS_DIR) { $env:TOKENS_DIR } else { Join-Path $HOME 'TOKENS' }
$MinNodeMajor = 22

function Say($m)  { Write-Host $m -ForegroundColor White }
function Info($m) { Write-Host "  $m" }
function Die($m)  { Write-Host "error: $m" -ForegroundColor Red; exit 1 }

Say 'TOKENS collector installer (Windows)'
Write-Host ''

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Die 'git is required. Install it from https://git-scm.com and re-run.'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Die "Node.js $MinNodeMajor+ is required. Install it from https://nodejs.org and re-run."
}

# Do not use `node -p` here. Windows PowerShell can strip the nested quotes from
# JavaScript expressions passed to native executables, turning split(".") into
# invalid split(.). Parse the stable `node --version` output in PowerShell instead.
[string]$nodeVersion = (& node --version 2>&1)
if ($LASTEXITCODE -ne 0) {
  Die 'Could not read the installed Node.js version.'
}
$nodeVersion = $nodeVersion.Trim()
if ($nodeVersion -notmatch '^v(?<major>\d+)\.') {
  Die "Could not parse the installed Node.js version: $nodeVersion"
}
$nodeMajor = [int]$Matches['major']
if ($nodeMajor -lt $MinNodeMajor) {
  Die "Node $MinNodeMajor+ is required (found $nodeVersion)."
}
Info "git: $((git --version).Split(' ')[2])   node: $nodeVersion"

if (Test-Path (Join-Path $InstallDir '.git')) {
  Say "Updating existing checkout at $InstallDir"
  git -C $InstallDir pull --ff-only
  if ($LASTEXITCODE -ne 0) { Die "Could not update the existing checkout. Resolve local changes in $InstallDir and re-run." }
} elseif (Test-Path $InstallDir) {
  Die "$InstallDir exists but is not a git checkout. Move it aside or set `$env:TOKENS_DIR."
} else {
  Say "Cloning the collector into $InstallDir"
  git clone --depth 1 $RepoUrl $InstallDir
  if ($LASTEXITCODE -ne 0) { Die 'git clone failed.' }
}

Say 'Installing dependencies'
Push-Location $InstallDir
try {
  npm ci --silent
  if ($LASTEXITCODE -ne 0) { Die 'npm ci failed.' }
} finally {
  Pop-Location
}

Write-Host ''
Say 'Installed. Nothing has been read or published.'
Write-Host ''
Info 'Start the guided local setup:'
Info "Set-Location `"$InstallDir`"; npm run join"
Write-Host ''
Info 'The wizard creates your profile, asks which sources may be read, measures locally,'
Info 'shows the exact public payload, and only then offers public directory enrollment.'
Write-Host ''
Info 'Open guide: https://ledger.imagineqira.com/join'
Info "Uninstall: Remove-Item -Recurse -Force `"$InstallDir`""
Write-Host ''
