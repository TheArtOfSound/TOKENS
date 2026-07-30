#!/usr/bin/env node
/**
 * `ledger` — the installable CLI.
 *
 * Until now every command was `npm run <x>` from a clone of this repo, which
 * meant joining required cloning a website to run a measurement tool. This is
 * the same code addressed as a normal command.
 *
 * THE WORKSPACE MODEL. The collector reads and writes cwd-relative paths
 * (`profile/`, `public/data/`, `.tokens-cache/`) in ~25 places. Rather than
 * rewrite all of them, that convention becomes the product: a Ledger workspace is
 * a directory, `ledger init` scaffolds one, and every other command operates on
 * the workspace you are standing in. That keeps the local-first story literal —
 * your evidence is a folder you own, not rows in someone's database — and it
 * means the published package behaves identically to the repo it came from.
 *
 * Subcommands dispatch by dynamic import so that starting the CLI does not pay
 * for loading the SQLite ledger, the signing stack, and the scanner when all the
 * user typed was `ledger --help`.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The event ledger uses node:sqlite, which Node still marks experimental, so it
 * prints a warning on import. Bundling hoists that import, which meant plain
 * `ledger --version` emitted a SQLite stability warning — noise about an
 * internal storage choice that the reader cannot act on and did not ask about.
 * Only ExperimentalWarning is filtered; every other warning still surfaces.
 */
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const name = typeof warning === 'string' ? rest[0] : warning?.name;
  if (name === 'ExperimentalWarning') return;
  return (emitWarning as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

const VERSION = '0.2.0';

const USAGE = `ledger ${VERSION} — a portable evidence record for AI-assisted work

USAGE
  ledger <command>

GETTING STARTED
  init          Create a Ledger workspace in the current directory
  collect       Measure your local AI usage and sign a snapshot
  list-me       Join the public directory (asks once, then automatic)

MANAGING IT
  status        Show what is measured, published, and consented to
  unlist        Withdraw from the public directory
  consent       Review or change what may be published
  export        Copy everything held locally about you

  --help, -h    This message
  --version, -v Print the version

Measuring is local and private. Publishing is a separate, explicit choice.
Docs: https://ledger.imagineqira.com
`;

const WORKSPACE_README = `# Ledger workspace

This directory holds your AI-work evidence record. Everything here is yours and
stays on this machine unless you explicitly publish.

  profile/profile.json   who you are, and where your snapshot is served
  profile/consent.json   what you have agreed may be published
  public/data/           your signed snapshot and history
  .tokens-cache/         incremental scan state (safe to delete)

Commands:

  ledger collect     measure and sign
  ledger status      see what is measured and published
  ledger list-me     join the public directory
  ledger unlist      withdraw

profile/ and .tokens-cache/ are gitignored by default: they hold your identity
and a per-device salt, neither of which should be committed anywhere.
`;

const GITIGNORE = `profile/
.tokens-cache/
node_modules/
`;

/** Scaffold a workspace without overwriting anything that already exists. */
function init(): void {
  const cwd = process.cwd();
  const made: string[] = [];
  const skipped: string[] = [];

  for (const dir of ['profile', 'public/data', 'public/data/profiles']) {
    const full = path.join(cwd, dir);
    if (existsSync(full)) skipped.push(`${dir}/`);
    else {
      mkdirSync(full, { recursive: true });
      made.push(`${dir}/`);
    }
  }

  const files: Array<[string, string]> = [
    [
      'profile/profile.json',
      `${JSON.stringify(
        {
          displayName: 'Your Name',
          headline: 'What you do',
          location: '',
          handle: '',
          snapshotUrl: '',
          workCategories: [],
          openTo: [],
          links: [],
        },
        null,
        2,
      )}\n`,
    ],
    ['README.md', WORKSPACE_README],
    ['.gitignore', GITIGNORE],
  ];

  for (const [rel, body] of files) {
    const full = path.join(cwd, rel);
    if (existsSync(full)) {
      skipped.push(rel);
      continue;
    }
    writeFileSync(full, body);
    made.push(rel);
  }

  console.log(`Ledger workspace ready in ${cwd}\n`);
  if (made.length) console.log(`  created:  ${made.join(', ')}`);
  if (skipped.length) console.log(`  kept:     ${skipped.join(', ')} (already existed)`);
  console.log('\nNext:');
  console.log('  1. Edit profile/profile.json — displayName and headline are required.');
  console.log('  2. ledger collect        measure and sign your first snapshot');
  console.log('  3. ledger list-me        publish it, if you want to (optional)');
}

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(USAGE);
    return;
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(VERSION);
    return;
  }

  switch (command) {
    case 'init':
      init();
      return;
    case 'collect':
      await import('./collectV2.js');
      return;
    case 'ingest':
      await import('./ingest.js');
      return;
    case 'list-me':
      await import('./listMe.js');
      return;
    case 'unlist':
      await import('./unlist.js');
      return;
    case 'status':
      await import('./status.js');
      return;
    case 'consent':
    case 'export':
      await import('./consent.js');
      return;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.error(USAGE);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
