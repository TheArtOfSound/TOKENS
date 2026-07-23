/**
 * Publication validator (`npm run validate:data`).
 *
 * This is the release gate that runs locally before commit and in CI before
 * deploy. It enforces, in order:
 *   1. latest.json matches the canonical JSON Schema (allowlist: unknown fields fail).
 *   2. The embedded snapshot hash matches the content (tamper-evidence intact).
 *   3. No prohibited pattern survives anywhere in latest.json OR history.json.
 *   4. The explicit privacy guarantees are present and true.
 *
 * Any failure exits non-zero so the build/deploy stops.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { scanForProhibited } from './lib/secretScan';
import { verifySnapshotHash, type PublishedSnapshot } from './lib/publish';

const DATA_DIR = path.join(process.cwd(), 'public', 'data');
const LATEST = path.join(DATA_DIR, 'latest.json');
const HISTORY = path.join(DATA_DIR, 'history.json');
const SCHEMA = path.join(process.cwd(), 'collector', 'schema', 'canonical-snapshot.schema.json');

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function main(): void {
  const text = readFileSync(LATEST, 'utf8');
  let snapshot: PublishedSnapshot;
  try {
    snapshot = JSON.parse(text) as PublishedSnapshot;
  } catch (error) {
    fail(`latest.json is not valid JSON: ${(error as Error).message}`);
  }

  // 1. Schema (allowlist) validation.
  const schema = JSON.parse(readFileSync(SCHEMA, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(snapshot)) {
    const errors = (validate.errors ?? []).slice(0, 15).map((e) => `${e.instancePath || '/'} ${e.message}`);
    fail(`latest.json failed schema validation:\n  ${errors.join('\n  ')}`);
  }

  // 2. Tamper-evidence: the embedded hash must match the content.
  if (!verifySnapshotHash(snapshot)) {
    fail('snapshotSha256 does not match the recomputed content hash.');
  }

  // 3. No prohibited content anywhere in the published latest snapshot.
  const latestFindings = scanForProhibited(snapshot);
  if (latestFindings.length > 0) {
    const lines = latestFindings.slice(0, 15).map((f) => `${f.label} at ${f.path} (${f.excerpt})`);
    fail(`latest.json contains prohibited content:\n  ${lines.join('\n  ')}`);
  }

  // 4. Explicit privacy guarantees.
  if (snapshot.verification?.rawLogsPublished !== false) fail('verification.rawLogsPublished must be false.');
  if (snapshot.privacy?.rawContentPersisted !== false) fail('privacy.rawContentPersisted must be false.');
  if (snapshot.privacy?.allowlistPublication !== true) fail('privacy.allowlistPublication must be true.');

  // history.json (if present): compact series shape + no prohibited content.
  if (existsSync(HISTORY)) {
    const historyText = readFileSync(HISTORY, 'utf8');
    let history: unknown;
    try {
      history = JSON.parse(historyText);
    } catch (error) {
      fail(`history.json is not valid JSON: ${(error as Error).message}`);
    }
    if (typeof history !== 'object' || history === null || (history as { kind?: string }).kind !== 'compact_daily_series') {
      fail('history.json must be a compact_daily_series object (run the collector to regenerate it).');
    }
    const historyFindings = scanForProhibited(history);
    if (historyFindings.length > 0) {
      const lines = historyFindings.slice(0, 15).map((f) => `${f.label} at ${f.path} (${f.excerpt})`);
      fail(`history.json contains prohibited content:\n  ${lines.join('\n  ')}`);
    }
    const historySizeKb = Math.round(Buffer.byteLength(historyText) / 1024);
    if (historySizeKb > 4096) {
      fail(`history.json is ${historySizeKb} KB; expected a compact series (<4 MB). Regenerate with the collector.`);
    }
    console.log(`✓ history.json: compact series, ${historySizeKb} KB`);
  }

  console.log(`✓ latest.json: schema valid, hash verified, no prohibited content`);
  console.log(`✓ exact total tokens: ${snapshot.measurement?.exactTotalTokens ?? 'n/a'}`);
  console.log('✓ publication validation passed');
}

main();
