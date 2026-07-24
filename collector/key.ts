/**
 * Device key management.
 *
 *   npm run key            show the current key id and revocation list
 *   npm run key -- rotate  generate a new key and revoke the outgoing one
 *   npm run key -- revoke <keyId> [reason]
 */
import { loadOrCreateDeviceKey, loadRevocations, publicKeyFrom, revokeKey, rotateKey } from './lib/signing';

const [command, ...rest] = process.argv.slice(2);

if (!command || command === 'show') {
  const key = loadOrCreateDeviceKey();
  console.log(`Current key: ${publicKeyFrom(key.privateKeyPem).keyId}  (stored in ${key.storage})`);
  const revoked = loadRevocations();
  console.log(revoked.length ? `Revoked keys (${revoked.length}):` : 'Revoked keys: none');
  for (const entry of revoked) console.log(`  ${entry.keyId}  ${entry.revokedAt}  ${entry.reason}`);
} else if (command === 'rotate') {
  const { oldKeyId, newKeyId } = rotateKey(rest.join(' ') || 'routine rotation');
  console.log(`Rotated. New key: ${newKeyId}`);
  console.log(oldKeyId ? `Previous key ${oldKeyId} revoked.` : 'No previous key found to revoke.');
  console.log('Re-run `npm run collect` to publish a snapshot signed by the new key.');
} else if (command === 'revoke') {
  const [keyId, ...reason] = rest;
  if (!keyId || !/^[a-f0-9]{16}$/.test(keyId)) {
    console.error('Usage: npm run key -- revoke <16-hex-keyId> [reason]');
    process.exit(1);
  }
  revokeKey(keyId, reason.join(' ') || 'manually revoked');
  console.log(`Revoked ${keyId}. Snapshots signed by it will now fail verification.`);
} else {
  console.error(`Unknown command: ${command}\nUse: show | rotate | revoke <keyId>`);
  process.exit(1);
}
