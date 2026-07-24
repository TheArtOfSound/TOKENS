/**
 * Consent CLI — disclosure, payload preview, export, and delete.
 *
 *   npm run consent          show what each source reads and the current choices
 *   npm run consent:preview  print the EXACT bytes that would be published
 *   npm run consent:export   copy all locally held derived data to a folder
 *   npm run consent:delete   erase locally held derived data
 *
 * These are the user's data rights in practice: see it, take it, delete it.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  CONSENT_FILE_PATH,
  FIELD_LABELS,
  SOURCE_DISCLOSURES,
  disabledFields,
  disabledSources,
  isFieldEnabled,
  isSourceEnabled,
  loadConsent,
  type FieldKey,
  type SourceKey,
} from './lib/consent';

const DATA_DIR = path.join(process.cwd(), 'public', 'data');
const CACHE_DIR = path.join(process.cwd(), '.tokens-cache');
const LATEST = path.join(DATA_DIR, 'latest.json');
const HISTORY = path.join(DATA_DIR, 'history.json');

const bold = (s: string) => `[1m${s}[0m`;
const dim = (s: string) => `[2m${s}[0m`;

function showDisclosure(): void {
  const { config } = loadConsent();

  console.log(`\n${bold('What the TOKENS collector reads, and what it publishes')}\n`);
  for (const source of SOURCE_DISCLOSURES) {
    // 'imported' is opt-in per-command, not a standing scan source.
    const status =
      source.key === 'imported'
        ? dim('(opt-in — only when you run `npm run import`)')
        : isSourceEnabled(config, source.key as SourceKey)
          ? dim('(enabled)')
          : '(DISABLED — never read)';
    const marker = source.key === 'imported' ? '◇' : isSourceEnabled(config, source.key as SourceKey) ? '●' : '○';
    console.log(`${marker} ${bold(source.name)}  ${status}`);
    console.log(`    reads:      ${source.reads}`);
    console.log(`    locations:  ${source.directories.join(', ')}`);
    console.log(`    extracts:   ${source.extracts.join(', ')}`);
    console.log(`    discards:   ${source.discards.join('; ')}`);
    console.log(`    evidence:   ${source.evidenceClass}`);
    console.log(`    network:    ${source.networkAccess}\n`);
  }

  console.log(bold('Published fields (toggle any of these off):'));
  for (const [key, label] of Object.entries(FIELD_LABELS) as [FieldKey, string][]) {
    console.log(`  ${isFieldEnabled(config, key) ? '[x]' : '[ ]'} ${key.padEnd(16)} ${label}`);
  }

  console.log(`\nEdit ${dim(CONSENT_FILE_PATH)} to change any of this.`);
  if (config.createdBy === 'migration-default') {
    console.log(
      `\n${bold('Note:')} this consent file was created automatically to match the collector's\n` +
        `existing behavior (everything enabled). Nothing was newly enabled on your behalf —\n` +
        `but nothing was explicitly agreed to either. Review it and turn off what you do not want.`,
    );
  }
  console.log('');
}

function showPreview(): void {
  if (!existsSync(LATEST)) {
    console.error(`No snapshot found at ${LATEST}. Run \`npm run collect\` first.`);
    process.exit(1);
  }
  const { config } = loadConsent();
  const raw = readFileSync(LATEST, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  console.log(`\n${bold('EXACT payload that would be published')}  ${dim(`(${Buffer.byteLength(raw)} bytes)`)}\n`);
  console.log(raw);

  const withheld = disabledFields(config);
  const offSources = disabledSources(config);
  console.log(`\n${bold('Summary')}`);
  console.log(`  top-level keys: ${Object.keys(parsed).join(', ')}`);
  console.log(`  sources disabled: ${offSources.length ? offSources.join(', ') : 'none'}`);
  console.log(`  fields withheld:  ${withheld.length ? withheld.join(', ') : 'none'}`);
  console.log(
    `\nThis is the complete file served publicly. Nothing else leaves this machine.\n` +
      `No prompt text, response text, file paths, or source logs appear above.\n`,
  );
}

function exportData(): void {
  const target = process.argv[3] || path.join(process.cwd(), 'tokens-export');
  mkdirSync(target, { recursive: true });
  const files = [LATEST, HISTORY, CONSENT_FILE_PATH, path.join(process.cwd(), 'profile', 'profile.json'), path.join(process.cwd(), 'profile', 'work.json')];
  let copied = 0;
  for (const file of files) {
    if (!existsSync(file)) continue;
    copyFileSync(file, path.join(target, path.basename(file)));
    copied += 1;
  }
  const manifest = {
    exportedAt: new Date().toISOString(),
    files: copied,
    note: 'Everything TOKENS holds about you locally. Derived aggregates only — no raw logs are ever stored by this tool.',
  };
  writeFileSync(path.join(target, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Exported ${copied} file(s) to ${target}`);
}

function deleteData(): void {
  const targets = [LATEST, HISTORY, CACHE_DIR];
  let removed = 0;
  for (const target of targets) {
    if (!existsSync(target)) continue;
    rmSync(target, { recursive: true, force: true });
    removed += 1;
    console.log(`  removed ${target}`);
  }
  console.log(
    `\nDeleted ${removed} item(s): published snapshots and the scan checkpoint.\n` +
      `Your identity config (profile/) and consent choices were kept — delete those files\n` +
      `directly if you want them gone too. Source logs belong to the providers and were\n` +
      `never copied by this tool, so there is nothing of theirs to delete here.\n`,
  );
}

const command = process.argv[2] ?? 'show';
if (command === 'show') showDisclosure();
else if (command === 'preview') showPreview();
else if (command === 'export') exportData();
else if (command === 'delete') deleteData();
else {
  console.error(`Unknown command: ${command}\nUse: show | preview | export | delete`);
  process.exit(1);
}
