/**
 * Independent signature verification for a published snapshot.
 *
 *   npm run verify                      verify the local public/data/latest.json
 *   npm run verify -- <path-or-url>     verify any snapshot file
 *
 * Uses ONLY the public key embedded in the file, so anyone can run it against a
 * downloaded snapshot without trusting this machine.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { verifySnapshot } from './lib/signing';

const target = process.argv[2] || path.join(process.cwd(), 'public', 'data', 'latest.json');

let snapshot: Record<string, unknown>;
try {
  snapshot = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;
} catch (error) {
  console.error(`Could not read ${target}: ${(error as Error).message}`);
  process.exit(1);
}

const manifest = snapshot.signature as Record<string, unknown> | undefined;
const result = verifySnapshot(snapshot);

console.log(`\nSnapshot: ${target}`);
if (manifest) {
  console.log(`  key id:        ${manifest.keyId}`);
  console.log(`  algorithm:     ${manifest.algorithm}`);
  console.log(`  issued at:     ${manifest.issuedAt}`);
  console.log(`  canonical:     ${manifest.canonicalizationSpec}`);
}
console.log(`\n  ${result.valid ? 'VALID' : 'INVALID'} — ${result.reason}\n`);

if (manifest) {
  console.log(`  Proves:        ${manifest.proves}`);
  console.log('  Does NOT prove:');
  for (const item of (manifest.doesNotProve as string[]) ?? []) console.log(`    - ${item}`);
  console.log('');
}

process.exit(result.valid ? 0 : 1);
