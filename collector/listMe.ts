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
const REGISTRY_PATH = 'public/data/profiles/index.json';

interface Identity {
  displayName?: string;
  headline?: string;
  handle?: string;
  /** Self-hosters and the operator declare where their snapshot is served. */
  snapshotUrl?: string;
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
  const handle = identity.handle || deriveHandle(identity.displayName);

  if (state === 'granted') {
    const consented = config.directoryListing?.handle;
    if (consented && consented !== handle) {
      // The handle changed since they agreed, so the URL they consented to is
      // not the URL they would now get. A different public address is a material
      // change, not a detail — re-ask rather than publishing them somewhere they
      // never saw.
      console.log(
        `Your handle changed from @${consented} to @${handle}, which changes your public URL.\n` +
          'Re-confirming below.\n',
      );
    } else {
      // Same handle and consent stands. Retry enrollment rather than assuming it
      // succeeded: the first attempt may have hit a handle collision, an expired
      // gh token, or no network, and the old early return left the member stuck
      // with consent recorded and no way to finish joining.
      console.log('Consent already recorded. Checking your directory entry…');
      await enroll(handle, identity);
      console.log('\nTo withdraw:  npm run unlist');
      return;
    }
  }
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
  // NOTE: snapshotUrl is resolved per member below, never defaulted to the site.
  // The first version of this defaulted to `${SITE_ORIGIN}/data/latest.json`,
  // which is the OPERATOR's snapshot: every member who ran this would have joined
  // the directory displaying somebody else's record under their own name. The
  // rule now is that a member either declares where their snapshot lives or we
  // publish it to their own repository — there is no shared fallback.
  const entry = {
    handle,
    displayName: identity.displayName,
    headline: identity.headline,
    snapshotUrl: '',
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

  const dryRun = process.argv.includes('--dry-run');

  try {
    const login = gh(['api', 'user', '--jq', '.login']);
    console.log(`  GitHub account: ${login}`);

    entry.snapshotUrl = resolveSnapshotUrl(login, identity, dryRun);
    console.log(`  Your snapshot: ${entry.snapshotUrl}`);

    // Read the CURRENT upstream registry, not the fork's copy. A fork that has
    // been sitting stale for weeks would otherwise produce a pull request that
    // silently reverts everyone who joined in the meantime.
    const upstreamRef = gh(['api', `repos/${UPSTREAM}/git/ref/heads/main`, '--jq', '.object.sha']);
    const fileJson = gh([
      'api',
      `repos/${UPSTREAM}/contents/${REGISTRY_PATH}?ref=${upstreamRef}`,
    ]);
    const file = JSON.parse(fileJson) as { content: string; sha: string };
    const registry = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')) as {
      members?: Array<Record<string, unknown>>;
      updatedAt?: string;
    };
    const members = Array.isArray(registry.members) ? registry.members : [];

    // Handle collision is a hard stop, not a rename. Silently suffixing someone
    // into `jane-dev-2` would hand them a URL they never agreed to, and the
    // consent record already pins the exact publicUrl they were shown.
    if (members.some((m) => m.handle === entry.handle)) {
      console.log(`\nThe handle @${entry.handle} is already taken in the directory.`);
      console.log('Pick another by setting "handle" in profile/profile.json, then re-run `npm run list-me`.');
      console.log('(Your consent is recorded; you will not be asked again.)');
      return;
    }

    const branch = `ledger-join-${entry.handle}`;
    const next = { ...registry, members: [...members, entry], updatedAt: new Date().toISOString() };
    const encoded = Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf8').toString('base64');

    if (dryRun) {
      console.log(`  [dry-run] upstream main: ${upstreamRef.slice(0, 12)}`);
      console.log(`  [dry-run] would fork ${UPSTREAM}, branch ${branch}`);
      console.log(`  [dry-run] registry would go from ${members.length} to ${next.members.length} members`);
      console.log(`  [dry-run] payload bytes: ${encoded.length}`);
      console.log('  [dry-run] no fork, no branch, no pull request created.');
      return;
    }

    // Idempotent: gh exits non-zero if the fork exists, which is fine.
    try {
      gh(['repo', 'fork', UPSTREAM, '--clone=false', '--remote=false']);
    } catch {
      /* already forked */
    }

    // Branch in the fork, pointed at the upstream commit. Forks share an object
    // network, so this is legal and it bases the PR on current upstream.
    try {
      gh([
        'api',
        `repos/${login}/${UPSTREAM.split('/')[1]}/git/refs`,
        '-f',
        `ref=refs/heads/${branch}`,
        '-f',
        `sha=${upstreamRef}`,
      ]);
    } catch {
      console.log(`  (branch ${branch} already exists in your fork; updating it)`);
    }

    gh([
      'api',
      `repos/${login}/${UPSTREAM.split('/')[1]}/contents/${REGISTRY_PATH}`,
      '-X',
      'PUT',
      '-f',
      `message=Add @${entry.handle} to the Ledger directory`,
      '-f',
      `content=${encoded}`,
      '-f',
      `branch=${branch}`,
      '-f',
      `sha=${file.sha}`,
    ]);

    const prUrl = gh([
      'pr',
      'create',
      '--repo',
      UPSTREAM,
      '--head',
      `${login}:${branch}`,
      '--base',
      'main',
      '--title',
      `Add @${entry.handle} to the directory`,
      '--body',
      `Joining the Ledger directory.\n\n` +
        `- Handle: \`${entry.handle}\`\n` +
        `- Snapshot: ${entry.snapshotUrl}\n\n` +
        `Consent recorded locally with the \`${DISCLOSURE_ID}\` disclosure. ` +
        `Signature is verifiable in the browser at ${entry.snapshotUrl}.\n`,
    ]);

    console.log(`\nPull request opened: ${prUrl}`);
    console.log('Once it merges you appear at ' + `${SITE_ORIGIN}/u/${entry.handle}`);
    console.log('After that, `npm run collect` keeps your entry current automatically.');
  } catch (error) {
    // Consent is already stored, so this is recoverable: re-running does not
    // re-ask. Say what broke rather than pretending it worked.
    console.log(`\nCould not open the pull request: ${error instanceof Error ? error.message : 'unknown'}`);
    printManual(entry);
  }
}

const SNAPSHOT_REPO = 'ledger-snapshot';

/**
 * Where this member's signed snapshot lives, publishing it if necessary.
 *
 * Order matters and there is deliberately no fallback to the Ledger site: a
 * shared default would point every member at the operator's record.
 *
 *  1. An explicit `snapshotUrl` in profile.json — self-hosters, and the operator,
 *     whose snapshot genuinely is served from the site itself.
 *  2. Otherwise publish latest.json to `<login>/ledger-snapshot` and point at the
 *     raw URL. raw.githubusercontent.com sends `access-control-allow-origin: *`,
 *     which is what lets a visitor's browser fetch and verify it — checked, not
 *     assumed, because verification silently breaks without it.
 */
function resolveSnapshotUrl(login: string, identity: Identity, dryRun: boolean): string {
  const declared = typeof identity.snapshotUrl === 'string' ? identity.snapshotUrl.trim() : '';
  if (declared) return declared;

  const raw = `https://raw.githubusercontent.com/${login}/${SNAPSHOT_REPO}/main/latest.json`;
  if (dryRun) {
    console.log(`  [dry-run] would publish latest.json to ${login}/${SNAPSHOT_REPO}`);
    return raw;
  }

  const body = readFileSync(SNAPSHOT, 'utf8');
  const encoded = Buffer.from(body, 'utf8').toString('base64');

  try {
    gh(['api', `repos/${login}/${SNAPSHOT_REPO}`, '--jq', '.name']);
  } catch {
    console.log(`  Creating ${login}/${SNAPSHOT_REPO} (public, holds only your signed snapshot)…`);
    gh(['repo', 'create', `${login}/${SNAPSHOT_REPO}`, '--public', '-d', 'My signed Ledger snapshot']);
  }

  // Update in place when it already exists — PUT without the current blob sha is
  // rejected, and overwriting blindly would lose history the member may rely on.
  let sha = '';
  try {
    sha = gh(['api', `repos/${login}/${SNAPSHOT_REPO}/contents/latest.json`, '--jq', '.sha']);
  } catch {
    /* first publish */
  }

  gh([
    'api',
    `repos/${login}/${SNAPSHOT_REPO}/contents/latest.json`,
    '-X',
    'PUT',
    '-f',
    'message=Publish signed Ledger snapshot',
    '-f',
    `content=${encoded}`,
    ...(sha ? ['-f', `sha=${sha}`] : []),
  ]);

  return raw;
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
