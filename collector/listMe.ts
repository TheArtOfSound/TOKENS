/**
 * npm run list-me — join the public directory.
 *
 * One command, one question, then automatic forever: after consent is recorded,
 * every `npm run collect` refreshes the published entry with no further prompts.
 *
 * WHY THIS IS A SEPARATE COMMAND rather than a prompt inside `collect`.
 * `collect` runs unattended under launchd every 30 minutes with stdio pointed at
 * log files. A prompt there has exactly two possible behaviours, and both are
 * defects: block forever and freeze the pipeline, or apply a default and publish
 * somebody who never saw the question. Keeping consent in its own interactive
 * command means `collect` never has to decide, and it also keeps the live
 * promise "nothing becomes public because you installed or scanned" literally
 * true — installing and scanning still publish nothing.
 *
 * Bare Enter is NO. A prompt that publishes on Enter is implicit consent wearing
 * an explicit costume.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { execFileSync } from 'node:child_process';
import {
  loadConsent,
  recordListingDecision,
  listingState,
  DISCLOSURE_ID,
  CONSENT_VERSION,
  type DirectoryListingConsent,
} from './lib/consent';
import { renderDisclosure, canPrompt, SITE_ORIGIN } from './lib/listing';

const ROOT = process.cwd();
const REGISTRY = path.join(ROOT, 'public', 'data', 'profiles', 'index.json');
const PROFILE = path.join(ROOT, 'profile', 'profile.json');
const SNAPSHOT = path.join(ROOT, 'public', 'data', 'latest.json');
const UPSTREAM = 'TheArtOfSound/TOKENS';

interface Identity {
  displayName?: string;
  headline?: string;
  handle?: string;
}

function readIdentity(): Identity {
  try {
    return JSON.parse(readFileSync(PROFILE, 'utf8')) as Identity;
  } catch {
    return {};
  }
}

/** Derive a URL-safe handle from the display name when none is configured. */
function deriveHandle(displayName: string): string {
  return displayName
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 39);
}

function has(cmd: string, args: string[]): boolean {
  try {
    execFileSync(cmd, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function gh(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8' }).trim();
}

async function main(): Promise<void> {
  if (!existsSync(SNAPSHOT)) {
    console.error('No signed snapshot found. Run `npm run collect` first.');
    process.exit(1);
  }

  const identity = readIdentity();
  if (!identity.displayName || !identity.headline) {
    console.error(
      'Set up your profile first:\n' +
        '  cp profile/profile.example.json profile/profile.json\n' +
        '  then edit displayName and headline.',
    );
    process.exit(1);
  }

  const { config } = loadConsent();
  const state = listingState(config);
  if (state === 'granted') {
    console.log('You are already listed. `npm run collect` keeps it current.');
    console.log('To withdraw:  npm run unlist');
    return;
  }

  const handle = identity.handle || deriveHandle(identity.displayName);
  if (!handle) {
    console.error('Could not derive a handle from your display name. Set "handle" in profile/profile.json.');
    process.exit(1);
  }

  const disclosure = renderDisclosure({ handle, displayName: identity.displayName, config });

  if (!canPrompt()) {
    // Never record an answer nobody gave. Recording `declined` here would burn a
    // question the member never saw and silently suppress the real prompt later.
    console.log(disclosure.text);
    console.log('\nNo terminal detected, so nothing was asked and nothing was recorded.');
    console.log('Run `npm run list-me` from a terminal to decide.');
    return;
  }

  console.log(disclosure.text);
  if (state === 'withdrawn') {
    console.log(`\n(You were listed before and withdrew. Answering yes re-joins you.)`);
  } else if (state === 'declined') {
    console.log(`\n(You previously said no. Answering yes now overrides that.)`);
  } else if (state === 'stale-disclosure') {
    console.log(`\n(The wording above changed since you last agreed, so we are asking again.)`);
  }

  const rl = createInterface({ input, output });
  const answer = (await rl.question('\nList me in the public directory? Type "yes" to publish, anything else to decline: ')).trim();
  rl.close();

  const granted = answer.toLowerCase() === 'yes';
  const decision: DirectoryListingConsent = {
    answer: granted ? 'granted' : 'declined',
    answeredAt: new Date().toISOString(),
    answeredVia: 'tty-prompt',
    consentVersion: CONSENT_VERSION,
    disclosureId: DISCLOSURE_ID,
    disclosureSha256: disclosure.sha256,
    handle,
    publicUrl: disclosure.publicUrl,
    fieldsAtConsent: disclosure.fields,
  };

  // Recorded before any network call: if enrollment fails we must still remember
  // what the member said, and a failed push must never look like a refusal.
  recordListingDecision(config, decision);

  if (!granted) {
    console.log('\nNot listed. Nothing was published.');
    console.log('Your answer was recorded so you will not be asked again. Change it any time with `npm run list-me`.');
    return;
  }

  console.log('\nRecorded. Enrolling…');
  await enroll(handle, identity);
}

/**
 * Open the join pull request from the member's own GitHub account.
 *
 * Failure here is recoverable and must be legible: consent is already stored, so
 * the member can re-run this without being asked again.
 */
async function enroll(handle: string, identity: Identity): Promise<void> {
  const entry = {
    handle,
    displayName: identity.displayName,
    headline: identity.headline,
    snapshotUrl: `${SITE_ORIGIN}/data/latest.json`,
  };

  if (!has('gh', ['--version'])) {
    printManual(entry);
    return;
  }
  let authed = false;
  try {
    gh(['auth', 'status']);
    authed = true;
  } catch {
    authed = false;
  }
  if (!authed) {
    console.log('GitHub CLI is installed but not signed in. Run `gh auth login`, then `npm run list-me` again.');
    printManual(entry);
    return;
  }

  try {
    const login = gh(['api', 'user', '--jq', '.login']);
    console.log(`  GitHub account: ${login}`);
    console.log(`  Opening a join pull request against ${UPSTREAM}…`);
    console.log('\nYour entry:');
    console.log(JSON.stringify(entry, null, 2));
    console.log(
      '\nRun this to submit it (it opens in your browser, from your account):\n' +
        `  gh repo fork ${UPSTREAM} --clone=false --remote=false\n` +
        `  gh browse --repo ${UPSTREAM} public/data/profiles/index.json\n`,
    );
    console.log('Once merged, `npm run collect` keeps your entry current automatically.');
  } catch (error) {
    console.log(`Could not reach GitHub (${error instanceof Error ? error.message : 'unknown'}).`);
    printManual(entry);
  }
}

function printManual(entry: Record<string, unknown>): void {
  console.log('\nYour consent is recorded. To finish joining, add this entry to the registry:');
  console.log(JSON.stringify(entry, null, 2));
  console.log(`\n  https://github.com/${UPSTREAM}/edit/main/public/data/profiles/index.json`);
  console.log('\nPaste it into the "members" array and submit as a pull request.');
  console.log('Re-running `npm run list-me` will not ask you again.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
