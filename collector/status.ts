/**
 * `ledger status` — what is measured, what is published, what was agreed to.
 *
 * The flow audit found there was no way to answer "am I set up, and am I
 * public?" without reading JSON by hand. That is the question people actually
 * have between running commands, and its absence is why the terminal half of
 * this product felt like guesswork.
 *
 * It is read-only and never touches the network: status should be safe to run at
 * any moment, including when you are unsure what the last command did.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadConsent, listingState, disabledFields } from './lib/consent';

const ROOT = process.cwd();
const PROFILE = path.join(ROOT, 'profile', 'profile.json');
const SNAPSHOT = path.join(ROOT, 'public', 'data', 'latest.json');

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function ago(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'unknown';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(16)} ${value}`);
}

function main(): void {
  console.log('\nLEDGER STATUS\n');

  // --- workspace ---------------------------------------------------------
  const isWorkspace = existsSync(path.join(ROOT, 'profile')) || existsSync(SNAPSHOT);
  if (!isWorkspace) {
    console.log('  This directory is not a Ledger workspace.');
    console.log('\n  Run `ledger init` to create one.\n');
    return;
  }

  // --- identity ----------------------------------------------------------
  const profile = readJson<{ displayName?: string; headline?: string; handle?: string; snapshotUrl?: string }>(PROFILE);
  if (!profile?.displayName || profile.displayName === 'Your Name') {
    line('Profile', 'not set up — edit profile/profile.json');
  } else {
    line('Profile', `${profile.displayName}${profile.handle ? ` (@${profile.handle})` : ''}`);
  }

  // --- measurement -------------------------------------------------------
  const snapshot = readJson<{
    generatedAt?: string;
    profile?: { activity?: { activeDays?: number; lastActiveDate?: string; toolsUsed?: string[] } };
    signature?: { keyId?: string };
  }>(SNAPSHOT);

  if (!snapshot) {
    line('Measured', 'nothing yet — run `ledger collect`');
  } else {
    const activity = snapshot.profile?.activity;
    line('Measured', `${activity?.activeDays ?? 0} active days · last recorded ${activity?.lastActiveDate ?? 'unknown'}`);
    line('Tools', (activity?.toolsUsed ?? []).join(', ') || 'none detected');
    if (snapshot.generatedAt) line('Last collect', ago(snapshot.generatedAt));
    line('Signed', snapshot.signature?.keyId ? `yes · key ${snapshot.signature.keyId.slice(0, 12)}` : 'no');
  }

  // --- publication -------------------------------------------------------
  const { config } = loadConsent();
  const state = listingState(config);
  const listing = config.directoryListing;

  const published: Record<string, string> = {
    unanswered: 'not published — you have not been asked yet',
    granted: 'PUBLIC',
    declined: 'not published — you declined',
    withdrawn: 'not published — you withdrew',
    'stale-disclosure': 'not published — the disclosure changed, re-run `ledger list-me`',
  };
  line('Directory', published[state] ?? state);
  if (state === 'granted' && listing) {
    line('Public URL', listing.publicUrl);
    line('Agreed', `${ago(listing.answeredAt)} · disclosure ${listing.disclosureId}`);
  }
  if (profile?.snapshotUrl) line('Snapshot at', profile.snapshotUrl);

  const off = disabledFields(config);
  line('Withheld', off.length ? off.join(', ') : 'nothing — all publishable fields enabled');

  // --- next --------------------------------------------------------------
  console.log('');
  if (!profile?.displayName || profile.displayName === 'Your Name') {
    console.log('  Next: edit profile/profile.json, then run `ledger collect`.');
  } else if (!snapshot) {
    console.log('  Next: run `ledger collect` to measure and sign.');
  } else if (state === 'unanswered') {
    console.log('  Next: `ledger list-me` to publish, or do nothing and stay private.');
  } else if (state === 'granted') {
    console.log('  Nothing to do. `ledger collect` keeps your published record current.');
    console.log('  To withdraw: `ledger unlist`');
  } else {
    console.log('  Nothing to do. `ledger list-me` if you change your mind.');
  }
  console.log('');
}

main();
