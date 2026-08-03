#!/usr/bin/env node
/**
 * Prepare the one-click directory enrollment path, then hand off to listMe.ts.
 *
 * The member should never need to edit registry JSON or construct a pull request.
 * This wrapper installs GitHub CLI when possible, opens browser authentication,
 * and continues into the existing signed-snapshot enrollment implementation.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path, { delimiter } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  selectGitHubCliInstallPlan,
  type GitHubCliInstallPlan,
} from './lib/githubCliSetup';

function works(file: string, args: string[]): boolean {
  try {
    execFileSync(file, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function ghCandidates(): string[] {
  const values = [
    process.env.GH_PATH,
    process.platform === 'win32' && process.env.ProgramFiles
      ? path.join(process.env.ProgramFiles, 'GitHub CLI', 'gh.exe')
      : undefined,
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Programs', 'GitHub CLI', 'gh.exe')
      : undefined,
    process.platform === 'darwin' ? '/opt/homebrew/bin/gh' : undefined,
    process.platform === 'darwin' ? '/usr/local/bin/gh' : undefined,
    process.platform === 'linux' ? '/usr/bin/gh' : undefined,
    process.platform === 'linux' ? '/usr/local/bin/gh' : undefined,
    process.platform === 'linux' ? '/home/linuxbrew/.linuxbrew/bin/gh' : undefined,
    process.platform === 'win32' ? 'gh.exe' : 'gh',
  ];
  return values.filter((value): value is string => Boolean(value));
}

function findGh(): string | null {
  for (const candidate of ghCandidates()) {
    if ((path.isAbsolute(candidate) && existsSync(candidate) && works(candidate, ['--version'])) || works(candidate, ['--version'])) {
      return candidate;
    }
  }
  return null;
}

function exposeOnPath(executable: string): void {
  if (!path.isAbsolute(executable)) return;
  const dir = path.dirname(executable);
  const current = process.env.PATH ?? '';
  const parts = current.split(delimiter);
  const includes = parts.some((part) =>
    process.platform === 'win32' ? part.toLowerCase() === dir.toLowerCase() : part === dir,
  );
  if (!includes) process.env.PATH = `${dir}${delimiter}${current}`;
}

async function confirm(message: string): Promise<boolean> {
  if (!input.isTTY || !output.isTTY) return false;
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`${message} Type "yes" to continue: `)).trim().toLowerCase();
    return answer === 'yes';
  } finally {
    rl.close();
  }
}

function availablePackageManagers(): Set<string> {
  const candidates = process.platform === 'win32'
    ? ['winget.exe']
    : process.platform === 'darwin'
      ? ['brew']
      : ['apt-get', 'dnf', 'yum', 'pacman', 'zypper', 'apk', 'brew'];

  return new Set(candidates.filter((command) => works(command, ['--version'])));
}

function runInstallPlan(plan: GitHubCliInstallPlan): void {
  if (!plan.requiresElevation || process.platform === 'win32' || process.getuid?.() === 0) {
    execFileSync(plan.file, plan.args, { stdio: 'inherit' });
    return;
  }

  if (!works('sudo', ['--version'])) {
    throw new Error(`${plan.label} needs administrator privileges, but sudo is unavailable.`);
  }
  execFileSync('sudo', [plan.file, ...plan.args], { stdio: 'inherit' });
}

async function installGh(): Promise<string | null> {
  const plan = selectGitHubCliInstallPlan(process.platform, availablePackageManagers());
  if (!plan) return null;

  const approved = await confirm(
    `\nLedger needs GitHub publishing support for the final directory step. Install it with ${plan.label}?`,
  );
  if (!approved) return null;

  runInstallPlan(plan);
  return findGh();
}

function printSimpleInstall(): void {
  console.log('\nThe local profile and signed snapshot are complete. Only GitHub publishing setup remains.');
  if (process.platform === 'win32') {
    console.log('Run this once, then run `npm run list-me` again:');
    console.log('  winget install --id GitHub.cli --exact');
  } else if (process.platform === 'darwin') {
    console.log('Run this once, then run `npm run list-me` again:');
    console.log('  brew install gh');
  } else {
    console.log('Install GitHub CLI using your package manager or https://cli.github.com, then run `npm run list-me` again.');
  }
  console.log('You do not need to edit JSON or create a pull request manually.');
}

async function ensureAuthenticated(gh: string): Promise<boolean> {
  if (works(gh, ['auth', 'status', '--hostname', 'github.com'])) return true;

  const approved = await confirm(
    '\nA browser sign-in is required to publish the signed snapshot and request the directory listing. Open GitHub sign-in now?',
  );
  if (!approved) return false;

  execFileSync(
    gh,
    ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web'],
    { stdio: 'inherit' },
  );
  return works(gh, ['auth', 'status', '--hostname', 'github.com']);
}

async function main(): Promise<void> {
  let gh = findGh();
  if (!gh) gh = await installGh();
  if (!gh) {
    printSimpleInstall();
    process.exit(1);
  }

  exposeOnPath(gh);
  process.env.GH_PATH = gh;

  if (!(await ensureAuthenticated(gh))) {
    console.log('\nGitHub sign-in was not completed. Nothing additional was published.');
    console.log('Run `npm run list-me` whenever you are ready.');
    process.exit(1);
  }

  console.log('\nGitHub publishing is ready. Finishing the directory request automatically…');
  await import('./listMe');
}

main().catch((error) => {
  console.error(`\nDirectory setup failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error('Your local profile and signed snapshot remain intact. Re-run `npm run list-me` to retry.');
  process.exit(1);
});
