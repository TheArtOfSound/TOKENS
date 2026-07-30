/**
 * npm run unlist — withdraw from the public directory.
 *
 * Non-interactive on purpose: withdrawal is the safe direction, so it must work
 * unattended, over ssh, and in a script. Consent needs a human; revocation does
 * not, and requiring a TTY here would mean the only way out was the way in.
 *
 * This is honest about its limits. It stops future publication and removes the
 * local registry row. It cannot reach a search engine's cache, an archive
 * scrape, or the git history of a repository — including this one, where a merged
 * join pull request is permanent public record. Claiming otherwise would be a
 * deletion promise the system cannot keep.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { loadConsent, withdrawListing, listingState } from './lib/consent';

const ROOT = process.cwd();
const REGISTRY = path.join(ROOT, 'public', 'data', 'profiles', 'index.json');

function removeLocalRow(handle: string): boolean {
  if (!existsSync(REGISTRY)) return false;
  try {
    const registry = JSON.parse(readFileSync(REGISTRY, 'utf8')) as {
      members?: Array<Record<string, unknown>>;
      updatedAt?: string;
    };
    if (!Array.isArray(registry.members)) return false;
    const before = registry.members.length;
    registry.members = registry.members.filter((m) => m.handle !== handle);
    if (registry.members.length === before) return false;
    registry.updatedAt = new Date().toISOString();
    writeFileSync(REGISTRY, `${JSON.stringify(registry, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

function main(): void {
  const { config } = loadConsent();
  const state = listingState(config);

  if (state === 'unanswered') {
    console.log('You are not listed — there is nothing to withdraw.');
    return;
  }
  if (state === 'withdrawn') {
    console.log('Already withdrawn. No further updates are published.');
    return;
  }
  if (state === 'declined') {
    console.log('You previously declined to be listed, so nothing is published.');
    return;
  }

  const handle = config.directoryListing?.handle ?? '';
  // Throws if it cannot persist. A withdrawal that silently failed to write
  // would leave you believing you had opted out while collect re-published you.
  withdrawListing(config);

  const removed = handle ? removeLocalRow(handle) : false;

  console.log('Withdrawn. No further updates will be published.');
  if (removed) {
    console.log(`Removed @${handle} from the local registry — commit and push to take it off the site.`);
  } else if (handle) {
    console.log(`No local row for @${handle}. If your entry is upstream, open a pull request removing it.`);
  }

  console.log('\nWhat this does NOT reach, honestly:');
  console.log('  - search-engine caches and third-party archives');
  console.log('  - the git history of any repository, including the join pull request');
  console.log('  - copies anyone already saved');
  console.log('\nRe-join any time with `npm run list-me`.');
}

main();
