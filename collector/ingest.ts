/**
 * Event ingest CLI — reads provider logs into the local SQLite ledger.
 *
 *   npm run ingest              incremental (resumes from stored checkpoints)
 *   npm run ingest -- --full    ignore checkpoints and re-read everything
 *   npm run ingest -- --stats   report ledger contents without scanning
 *
 * Consent is enforced here: a source the user disabled is never opened.
 */

import { detectAll, ADAPTERS } from './adapters';
import { Ledger } from './lib/ledger';
import { loadOrCreateSalt } from './lib/events';
import { isSourceEnabled, loadConsent } from './lib/consent';

const args = new Set(process.argv.slice(2));
const full = args.has('--full');
const statsOnly = args.has('--stats');

const ledger = new Ledger();
const applied = ledger.migrate();
if (applied > 0) console.log(`Applied ${applied} migration(s).`);

if (statsOnly) {
  const rows = ledger.dailyTotals();
  console.log(`Events:      ${ledger.eventCount()}`);
  console.log(`Checkpoints: ${ledger.checkpointCount()}`);
  console.log(`Days:        ${rows.length}`);
  console.log(`Models:      ${ledger.modelsUsed().join(', ') || 'none'}`);
  const total = rows.reduce((sum, row) => sum + Number(row.totalTokens), 0);
  console.log(`Total tokens (event-level): ${total.toLocaleString('en-US')}`);
  ledger.close();
  process.exit(0);
}

const { config: consent } = loadConsent();
const salt = loadOrCreateSalt();
const ingestedAt = new Date().toISOString();

console.log('Detected sources:');
for (const detection of detectAll()) {
  const enabled = isSourceEnabled(consent, detection.provider as 'claude' | 'codex');
  console.log(
    `  ${detection.name.padEnd(20)} ${detection.present ? `${detection.fileCount} files` : 'not present'}` +
      `  ${enabled ? '' : '(DISABLED by consent — will not be read)'}`,
  );
}

let totalInserted = 0;
let totalDuplicates = 0;
const started = Date.now();

for (const adapter of ADAPTERS) {
  if (!isSourceEnabled(consent, adapter.provider as 'claude' | 'codex')) continue;
  if (!adapter.detect().present) continue;

  const t0 = Date.now();
  // Stream events to the ledger per file: the log corpus is multi-gigabyte and
  // must never be held in memory all at once.
  let inserted = 0;
  let duplicates = 0;
  let extracted = 0;
  const result = adapter.scan({
    getCheckpoint: (fingerprint) => (full ? null : ledger.getCheckpoint(fingerprint)),
    salt,
    ingestedAt,
    onBatch: (batch) => {
      extracted += batch.length;
      const outcome = ledger.insertEvents(batch);
      inserted += outcome.inserted;
      duplicates += outcome.duplicates;
    },
  });
  totalInserted += inserted;
  totalDuplicates += duplicates;

  for (const checkpoint of result.checkpoints) ledger.saveCheckpoint(checkpoint);

  console.log(
    `\n${adapter.name} (${((Date.now() - t0) / 1000).toFixed(1)}s)\n` +
      `  files scanned/skipped: ${result.filesScanned}/${result.filesSkipped}\n` +
      `  lines read:            ${result.linesRead}\n` +
      `  events extracted:      ${extracted}\n` +
      `  inserted / duplicate:  ${inserted} / ${duplicates}`,
  );
  for (const warning of result.warnings) console.warn(`  warning: ${warning}`);
}

const totals = ledger.dailyTotals();
console.log(
  `\nLedger: ${ledger.eventCount()} events across ${totals.length} days, ` +
    `${ledger.checkpointCount()} checkpoints. ` +
    `Inserted ${totalInserted}, deduplicated ${totalDuplicates}. ` +
    `(${((Date.now() - started) / 1000).toFixed(1)}s)`,
);
ledger.close();
