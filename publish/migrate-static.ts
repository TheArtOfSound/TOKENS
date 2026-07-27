/**
 * Migrate the existing static registry member (Bryan Leonard) into the
 * publication service without breaking public URLs.
 *
 *   npm run publish:migrate
 *
 * After migration:
 *   - Handle `bryan` is published through Ledger (hosted snapshot).
 *   - Static registry entry remains valid as a fallback (snapshotUrl /data/latest.json).
 *   - Directory UI merges both sources and de-dupes by handle.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublishStore } from './lib/store';
import { PublishService } from './lib/service';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB_PATH = process.env.PUBLISH_DB ?? path.join(ROOT, '.tokens-cache', 'publish.db');
const PUBLIC_BASE = process.env.PUBLISH_PUBLIC_BASE ?? 'http://localhost:5199';

function main(): void {
  const snapshotPath = path.join(ROOT, 'public', 'data', 'latest.json');
  if (!existsSync(snapshotPath)) {
    console.error('Missing public/data/latest.json — run the collector first.');
    process.exit(1);
  }
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Record<string, unknown>;
  const store = new PublishStore(DB_PATH);
  const service = new PublishService(store, {
    publicBaseUrl: PUBLIC_BASE,
    devExposeCodes: true,
  });

  const email = process.env.MIGRATE_EMAIL ?? 'bryan@imagineqira.com';
  const result = service.migrateStaticMember({
    email,
    handle: 'bryan',
    snapshot,
    operator: true,
  });

  console.log('Migrated static profile into publication service:');
  console.log(`  handle:     ${result.handle}`);
  console.log(`  account:    ${result.accountId}`);
  console.log(`  keyId:      ${result.keyId}`);
  console.log(`  snapshot:   ${PUBLIC_BASE}/api/publish/v1/snapshots/bryan`);
  console.log(`  profile:    ${PUBLIC_BASE}/u/bryan`);
  console.log('');
  console.log('Static fallback still available at /data/latest.json and /data/profiles/index.json.');
  console.log('Rollback: delete .tokens-cache/publish.db (or set PUBLISH_DB) — static registry is unchanged.');
  store.close();
}

main();
