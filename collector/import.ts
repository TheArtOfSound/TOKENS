/**
 * Import CLI — bring in usage exported from another AI source.
 *
 *   npm run import -- <file>                     preview what would be imported
 *   npm run import -- <file> --commit            actually add it to the ledger
 *   npm run import -- <file> --source "ChatGPT"  label the source
 *   npm run import -- <file> --provider openai   provider when the file omits it
 *   npm run import -- --list                      list imported sources
 *   npm run import -- --remove "ChatGPT"         delete an imported source
 *
 * Preview is the default. Nothing is written until you pass --commit — this is
 * the same "see exactly what happens before it happens" discipline as the rest
 * of the collector. Imported data is stored as user_submitted / low confidence
 * and never counts toward measured totals.
 */

import { readFileSync } from 'node:fs';
import { Ledger } from './lib/ledger';
import { parseImport, type ImportFormat } from './importers';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);
const file = argv.find((a) => !a.startsWith('--') && !isFlagValue(a));

function isFlagValue(value: string): boolean {
  const i = argv.indexOf(value);
  return i > 0 && ['--source', '--provider', '--format', '--remove'].includes(argv[i - 1]);
}

const ledger = new Ledger();
ledger.migrate();

if (has('list')) {
  const sources = ledger.importedSources();
  if (!sources.length) console.log('No imported sources. Add one with: npm run import -- <file> --commit');
  for (const s of sources) {
    console.log(
      `• ${s.sourceLabel}  [${s.confidence} confidence · ${s.measurementClass}]\n` +
        `    ${s.events} events · ${s.totalTokens.toLocaleString('en-US')} tokens · ${s.firstDate ?? '?'} → ${s.lastDate ?? '?'}\n` +
        `    models: ${s.models.join(', ') || '—'}`,
    );
  }
  ledger.close();
  process.exit(0);
}

const removeLabel = flag('remove');
if (removeLabel) {
  const removed = ledger.deleteImportedSource(removeLabel);
  console.log(removed ? `Removed "${removeLabel}" (${removed} events).` : `No imported source named "${removeLabel}".`);
  ledger.close();
  process.exit(0);
}

if (!file) {
  console.error('Usage: npm run import -- <file> [--commit] [--source "Label"] [--provider name] [--format csv|json]');
  console.error('       npm run import -- --list');
  console.error('       npm run import -- --remove "Label"');
  ledger.close();
  process.exit(1);
}

let content: string;
try {
  content = readFileSync(file, 'utf8');
} catch (error) {
  console.error(`Could not read ${file}: ${error instanceof Error ? error.message : error}`);
  ledger.close();
  process.exit(1);
}

const result = parseImport(content, {
  filename: file,
  format: (flag('format') as ImportFormat | undefined) ?? 'auto',
  source: flag('source'),
  provider: flag('provider'),
});

console.log(`\nSource:   ${result.source}`);
console.log(`Format:   ${result.format}`);
console.log(`Rows:     ${result.rows} read · ${result.imported} importable · ${result.skipped} skipped (no date or no tokens)`);
console.log(`Tokens:   ${result.totalTokens.toLocaleString('en-US')} (self-submitted, low confidence — NOT counted as measured)`);
for (const warning of result.warnings) console.warn(`  warning: ${warning}`);

if (result.imported > 0) {
  const sample = result.events.slice(0, 3).map((e) => `    ${e.occurredAt.slice(0, 10)} ${e.provider} ${e.model ?? ''} ${e.totalTokens} tok`);
  console.log('Sample:\n' + sample.join('\n'));
}

if (!has('commit')) {
  console.log('\nPreview only. Re-run with --commit to add this to your local ledger:');
  console.log(`  npm run import -- "${file}"${flag('source') ? ` --source "${flag('source')}"` : ''} --commit`);
  ledger.close();
  process.exit(0);
}

if (result.imported === 0) {
  console.log('\nNothing to import.');
  ledger.close();
  process.exit(0);
}

const { inserted, duplicates } = ledger.insertEvents(result.events, { origin: 'imported', sourceLabel: result.source });
console.log(`\nImported "${result.source}": ${inserted} new event(s), ${duplicates} already present.`);
console.log('Run `npm run collect` to include it in your published profile (clearly labeled self-imported).');
ledger.close();
