#!/usr/bin/env node
/**
 * One-command local onboarding for Ledger.
 *
 * This is the production-safe path while Ledger remains a static site:
 *   profile setup -> explicit source consent -> local ingest -> sign -> preview
 *   -> optional GitHub-backed directory enrollment.
 *
 * Nothing is uploaded by this script. The final `list-me` step opens a GitHub
 * pull request from the user's account and publishes only the signed snapshot.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  loadConsent,
  saveConsentOrThrow,
  SOURCE_DISCLOSURES,
  type SourceKey,
} from './lib/consent';

const ROOT = process.cwd();
const PROFILE_DIR = path.join(ROOT, 'profile');
const PROFILE_FILE = path.join(PROFILE_DIR, 'profile.json');
const SNAPSHOT_FILE = path.join(ROOT, 'public', 'data', 'latest.json');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

interface Profile {
  displayName?: string;
  handle?: string;
  headline?: string;
  pronouns?: string | null;
  location?: string | null;
  bio?: string | null;
  availability?: string | null;
  workCategories?: string[];
  openTo?: string[];
  links?: Array<{ label: string; url: string }>;
  identityProofs?: unknown[];
  snapshotUrl?: string;
}

function readProfile(): Profile {
  if (!existsSync(PROFILE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(PROFILE_FILE, 'utf8')) as Profile;
  } catch {
    throw new Error(`Could not parse ${PROFILE_FILE}. Fix or remove it, then run npm run join again.`);
  }
}

function deriveHandle(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 39);
}

function csv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function run(script: string, extra: string[] = []): void {
  execFileSync(npmCommand, ['run', script, ...extra], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
}

async function ask(
  rl: ReturnType<typeof createInterface>,
  label: string,
  current = '',
  required = false,
): Promise<string> {
  while (true) {
    const suffix = current ? ` [${current}]` : '';
    const answer = (await rl.question(`${label}${suffix}: `)).trim();
    const value = answer || current;
    if (!required || value) return value;
    console.log('  Required.');
  }
}

async function yesNo(
  rl: ReturnType<typeof createInterface>,
  label: string,
  defaultYes: boolean,
): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = (await rl.question(`${label} [${hint}]: `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === 'y' || answer === 'yes';
}

async function configureProfile(rl: ReturnType<typeof createInterface>): Promise<Profile> {
  const existing = readProfile();
  console.log('\nProfile fields are self-submitted. Use city-level location only.');

  const displayName = await ask(rl, 'Display name or pseudonym', existing.displayName ?? '', true);
  const handle = deriveHandle(
    await ask(rl, 'Public handle', existing.handle ?? deriveHandle(displayName), true),
  );
  if (!handle) throw new Error('Handle must contain at least one letter or number.');

  const headline = await ask(rl, 'Headline', existing.headline ?? '', true);
  const location = await ask(rl, 'City-level location (optional)', existing.location ?? '');
  const bio = await ask(rl, 'Short bio (optional)', existing.bio ?? '');
  const availability = await ask(rl, 'Availability (optional)', existing.availability ?? '');
  const workCategories = csv(
    await ask(
      rl,
      'Work categories, comma-separated',
      existing.workCategories?.join(', ') ?? '',
    ),
  );
  const openTo = csv(
    await ask(
      rl,
      'Open to, comma-separated',
      existing.openTo?.join(', ') ?? '',
    ),
  );

  const currentLink = existing.links?.[0];
  const linkUrl = await ask(rl, 'Public link URL (optional)', currentLink?.url ?? '');
  let links: Array<{ label: string; url: string }> = [];
  if (linkUrl) {
    if (!/^https:\/\//i.test(linkUrl)) throw new Error('Public links must use https://');
    const linkLabel = await ask(rl, 'Public link label', currentLink?.label ?? 'Website', true);
    links = [{ label: linkLabel, url: linkUrl }];
  }

  const profile: Profile = {
    displayName,
    handle,
    headline,
    pronouns: existing.pronouns ?? null,
    location: location || null,
    bio: bio || null,
    availability: availability || null,
    workCategories,
    openTo,
    links,
    identityProofs: Array.isArray(existing.identityProofs) ? existing.identityProofs : [],
    snapshotUrl: existing.snapshotUrl ?? '',
  };

  mkdirSync(PROFILE_DIR, { recursive: true });
  writeFileSync(PROFILE_FILE, `${JSON.stringify(profile, null, 2)}\n`);
  console.log(`\nSaved ${PROFILE_FILE}`);
  return profile;
}

async function configureSources(rl: ReturnType<typeof createInterface>): Promise<void> {
  const loaded = loadConsent();
  const config = loaded.config;

  console.log('\nChoose what the collector may read. Disabled sources are never opened.');
  for (const source of SOURCE_DISCLOSURES) {
    if (source.key === 'imported') continue;
    console.log(`\n${source.name}`);
    console.log(`  reads: ${source.directories.join(', ')}`);
    console.log(`  extracts: ${source.extracts.join(', ')}`);
    console.log(`  discards: ${source.discards.join('; ')}`);
    console.log(`  network: ${source.networkAccess}`);

    const key = source.key as SourceKey;
    const defaultOn = loaded.created ? key !== 'projectScan' : Boolean(config.sources[key]);
    config.sources[key] = await yesNo(rl, `Enable ${source.name}?`, defaultOn);
  }

  if (!config.sources.claude && !config.sources.codex && !config.sources.projectScan) {
    throw new Error('At least one source must be enabled to create a measured record.');
  }

  config.createdBy = 'user';
  config.fields.qiraProjects = config.sources.projectScan;
  saveConsentOrThrow(config);
  console.log('\nConsent choices saved locally. Nothing has been published.');
}

async function main(): Promise<void> {
  if (!input.isTTY || !output.isTTY) {
    console.error('npm run join requires an interactive terminal.');
    process.exit(1);
  }
  if (!existsSync(path.join(ROOT, 'package.json'))) {
    console.error('Run this command from the TOKENS directory.');
    process.exit(1);
  }

  const rl = createInterface({ input, output });
  try {
    console.log('\nLedger local onboarding');
    console.log('Nothing becomes public because you run this wizard.');
    console.log('The final directory step is separate and asks for explicit consent.');

    const profile = await configureProfile(rl);
    await configureSources(rl);

    const scan = await yesNo(rl, '\nMeasure and sign local activity now?', true);
    if (!scan) {
      console.log('\nSaved. Run these later:');
      console.log('  npm run ingest');
      console.log('  npm run collect');
      console.log('  npm run consent:preview');
      console.log('  npm run list-me');
      return;
    }

    rl.pause();
    run('ingest');
    run('collect');
    run('consent:preview');
    rl.resume();

    if (!existsSync(SNAPSHOT_FILE)) {
      throw new Error(`Collection completed without creating ${SNAPSHOT_FILE}.`);
    }

    console.log(`\nSigned snapshot ready for @${profile.handle}.`);
    console.log('The preview above is the complete public payload.');
    console.log('Directory enrollment currently uses GitHub because Ledger has no deployed account server.');
    console.log('It publishes only the signed snapshot and opens a registry pull request.');

    const enroll = await yesNo(rl, 'Continue to the final public-directory consent?', false);
    if (!enroll) {
      console.log('\nKept private. Join later with: npm run list-me');
      return;
    }

    rl.pause();
    run('list-me');
    rl.resume();
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(`\nJoin failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
