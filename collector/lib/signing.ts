/**
 * Ed25519 device signing for published snapshots.
 *
 * What a signature here DOES prove:
 *   this exact snapshot was produced by a collector holding this device's
 *   private key, and has not been altered by a single byte since.
 *
 * What it DOES NOT prove — stated plainly because overclaiming is the failure
 * mode this product exists to avoid:
 *   - It does not prove the provider's source logs were genuine or unmodified.
 *     Anyone controlling this machine could feed the collector fabricated logs.
 *   - It does not prove the human identity behind the device key.
 *   - It is not a third-party attestation. It is a device attestation.
 *
 * Key handling: the private key lives in the macOS Keychain when available, and
 * otherwise in a 0600 file under .tokens-cache/. The private key is NEVER
 * published, logged, or included in any payload — only the public key is.
 */

import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalize } from './canonicalJson';

export const SIGNATURE_VERSION = '1.0.0';
const KEYCHAIN_SERVICE = 'com.qira.tokens.device-key';
const KEY_DIR = path.join(process.cwd(), '.tokens-cache');
const KEY_FILE = path.join(KEY_DIR, 'device-key.pem');

export interface SignedManifest {
  signatureVersion: string;
  algorithm: 'ed25519';
  /** Public key, base64 SPKI DER. The private key never leaves the device. */
  publicKey: string;
  /** Short stable fingerprint of the public key, for rotation/revocation lists. */
  keyId: string;
  issuedAt: string;
  /** Single-use value binding this signature to this specific issuance. */
  nonce: string;
  /** What the signature covers. */
  scope: 'published_snapshot';
  canonicalizationSpec: string;
  /** Canonical-JSON digest of the snapshot with signature fields excluded. */
  payloadSha256: string;
  signature: string;
  /** Honest statement of what this proves — published alongside the signature. */
  proves: string;
  doesNotProve: string[];
}

const PROVES =
  'This snapshot was produced by a collector holding this device key and has not been altered since signing.';
const DOES_NOT_PROVE = [
  'It does not prove the provider source logs were genuine or unmodified.',
  'It does not prove the human identity behind this device key.',
  'It is a device attestation, not a third-party audit.',
];

// ---------- key storage ----------

function keychainAvailable(): boolean {
  if (process.platform !== 'darwin') return false;
  try {
    execFileSync('which', ['security'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Decode whatever `security` hands back.
 *
 * `security -w` returns HEX (not the raw string) whenever the stored secret
 * contains newlines — which a PEM always does. The first version of this checked
 * the raw output for "PRIVATE KEY", never matched, and therefore minted a brand
 * new device key on every single run. We now store base64 to sidestep the
 * newline problem, and still decode hex so keys written by that earlier version
 * are recovered rather than orphaned.
 */
export function decodeKeychainValue(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.includes('PRIVATE KEY')) return value;

  if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) {
    const decoded = Buffer.from(value, 'hex').toString('utf8');
    if (decoded.includes('PRIVATE KEY')) return decoded.trim();
  }
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    if (decoded.includes('PRIVATE KEY')) return decoded.trim();
  } catch {
    /* not base64 */
  }
  return null;
}

function keychainRead(): string | null {
  try {
    const raw = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return decodeKeychainValue(raw);
  } catch {
    return null;
  }
}

function keychainWrite(pem: string): boolean {
  try {
    // Store base64 so the value is single-line and round-trips predictably.
    execFileSync(
      'security',
      ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', 'tokens', '-w', Buffer.from(pem, 'utf8').toString('base64')],
      { stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

function fileRead(): string | null {
  if (!existsSync(KEY_FILE)) return null;
  try {
    return readFileSync(KEY_FILE, 'utf8');
  } catch {
    return null;
  }
}

function fileWrite(pem: string): void {
  mkdirSync(KEY_DIR, { recursive: true });
  writeFileSync(KEY_FILE, pem, { mode: 0o600 });
  try {
    chmodSync(KEY_FILE, 0o600);
  } catch {
    /* best effort */
  }
}

export interface KeyLoadResult {
  privateKeyPem: string;
  storage: 'keychain' | 'file';
  created: boolean;
}

/** Load the device key, generating one on first use. */
export function loadOrCreateDeviceKey(): KeyLoadResult {
  const useKeychain = keychainAvailable();

  const fromKeychain = useKeychain ? keychainRead() : null;
  if (fromKeychain) return { privateKeyPem: fromKeychain, storage: 'keychain', created: false };

  const fromFile = fileRead();
  if (fromFile && fromFile.includes('PRIVATE KEY')) {
    return { privateKeyPem: fromFile, storage: 'file', created: false };
  }

  const { privateKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  if (useKeychain && keychainWrite(pem)) {
    return { privateKeyPem: pem, storage: 'keychain', created: true };
  }
  fileWrite(pem);
  return { privateKeyPem: pem, storage: 'file', created: true };
}

export function publicKeyFrom(privateKeyPem: string): { base64: string; keyId: string } {
  const publicKey = createPublicKey(createPrivateKey(privateKeyPem));
  const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const base64 = der.toString('base64');
  return { base64, keyId: shortHash(base64) };
}

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

// ---------- signing ----------

/** Strip signature fields so signing and verification cover the same bytes. */
function signableFrom(snapshot: Record<string, unknown>): Record<string, unknown> {
  const { signature: _signature, ...rest } = snapshot;
  return rest;
}

export function payloadDigest(snapshot: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalize(signableFrom(snapshot))).digest('hex');
}

export function signSnapshot(snapshot: Record<string, unknown>, privateKeyPem: string, nonce: string): SignedManifest {
  const { base64, keyId } = publicKeyFrom(privateKeyPem);
  const digest = payloadDigest(snapshot);

  // Sign the manifest header bound to the payload digest, so the signature
  // covers the nonce, scope, and issuance time as well as the content.
  const issuedAt = new Date().toISOString();
  const bound = canonicalize({
    algorithm: 'ed25519',
    issuedAt,
    keyId,
    nonce,
    payloadSha256: digest,
    scope: 'published_snapshot',
    signatureVersion: SIGNATURE_VERSION,
  });

  const signature = sign(null, Buffer.from(bound, 'utf8'), createPrivateKey(privateKeyPem)).toString('base64');

  return {
    signatureVersion: SIGNATURE_VERSION,
    algorithm: 'ed25519',
    publicKey: base64,
    keyId,
    issuedAt,
    nonce,
    scope: 'published_snapshot',
    canonicalizationSpec: 'RFC8785-subset; see docs/architecture/CANONICALIZATION.md',
    payloadSha256: digest,
    signature,
    proves: PROVES,
    doesNotProve: DOES_NOT_PROVE,
  };
}

export interface VerifyResult {
  valid: boolean;
  reason: string;
}

/**
 * Verify a signed snapshot using ONLY the public key embedded in it.
 * Recomputes the payload digest from the snapshot's own bytes, so any
 * modification to the data invalidates the signature.
 */
export function verifySnapshot(snapshot: Record<string, unknown>): VerifyResult {
  const manifest = snapshot.signature as SignedManifest | undefined;
  if (!manifest) return { valid: false, reason: 'no signature present' };
  if (manifest.algorithm !== 'ed25519') return { valid: false, reason: `unsupported algorithm ${manifest.algorithm}` };

  const recomputed = payloadDigest(snapshot);
  if (recomputed !== manifest.payloadSha256) {
    return { valid: false, reason: 'payload digest mismatch — the snapshot was modified after signing' };
  }

  const bound = canonicalize({
    algorithm: manifest.algorithm,
    issuedAt: manifest.issuedAt,
    keyId: manifest.keyId,
    nonce: manifest.nonce,
    payloadSha256: manifest.payloadSha256,
    scope: manifest.scope,
    signatureVersion: manifest.signatureVersion,
  });

  try {
    const publicKey = createPublicKey({
      key: Buffer.from(manifest.publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const ok = verify(null, Buffer.from(bound, 'utf8'), publicKey, Buffer.from(manifest.signature, 'base64'));
    return ok
      ? { valid: true, reason: 'signature valid for the embedded public key' }
      : { valid: false, reason: 'signature does not verify against the embedded public key' };
  } catch (error) {
    return { valid: false, reason: `verification error: ${(error as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Key rotation and revocation
// ---------------------------------------------------------------------------

/**
 * Rotation alone is not enough: rotating leaves previously published snapshots
 * still verifying under the old key, so a stolen key stays useful to an attacker
 * forever. A revocation list lets a verifier reject them.
 *
 * The list is published alongside the snapshot so any third party can apply it,
 * and it holds only key ids, timestamps, and reasons — no key material.
 */
export interface RevokedKey {
  keyId: string;
  revokedAt: string;
  reason: string;
}

const REVOCATION_FILE = path.join(process.cwd(), 'profile', 'revoked-keys.json');

export function loadRevocations(): RevokedKey[] {
  try {
    const parsed = JSON.parse(readFileSync(REVOCATION_FILE, 'utf8')) as { revoked?: RevokedKey[] };
    return Array.isArray(parsed?.revoked)
      ? parsed.revoked.filter(
          (entry) => entry && typeof entry.keyId === 'string' && /^[a-f0-9]{16}$/.test(entry.keyId),
        )
      : [];
  } catch {
    return [];
  }
}

export function saveRevocations(revoked: RevokedKey[]): void {
  mkdirSync(path.dirname(REVOCATION_FILE), { recursive: true });
  writeFileSync(
    REVOCATION_FILE,
    `${JSON.stringify(
      {
        _comment:
          'Revoked TOKENS device keys. A snapshot signed by any keyId listed here must be treated as INVALID even though its signature is cryptographically well-formed. Published with the snapshot so third parties can apply it.',
        revoked,
      },
      null,
      2,
    )}\n`,
  );
}

export function isRevoked(keyId: string, revoked: RevokedKey[] = loadRevocations()): RevokedKey | null {
  return revoked.find((entry) => entry.keyId === keyId) ?? null;
}

/** Revoke a key id. Idempotent. */
export function revokeKey(keyId: string, reason: string): RevokedKey[] {
  const revoked = loadRevocations();
  if (!revoked.some((entry) => entry.keyId === keyId)) {
    revoked.push({ keyId, revokedAt: new Date().toISOString(), reason: reason.slice(0, 200) });
    saveRevocations(revoked);
  }
  return revoked;
}

/**
 * Generate a fresh device key, revoking the outgoing one.
 * Revoking on rotation is the default because the usual reason to rotate is that
 * the old key may be compromised.
 */
export function rotateKey(reason = 'routine rotation'): { oldKeyId: string | null; newKeyId: string } {
  let oldKeyId: string | null = null;
  try {
    const existing = loadOrCreateDeviceKey();
    if (!existing.created) oldKeyId = publicKeyFrom(existing.privateKeyPem).keyId;
  } catch {
    /* no usable existing key */
  }

  const { privateKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  if (!(keychainAvailable() && keychainWrite(pem))) fileWrite(pem);

  if (oldKeyId) revokeKey(oldKeyId, reason);
  return { oldKeyId, newKeyId: publicKeyFrom(pem).keyId };
}

/** Verify, additionally rejecting a signature from a revoked key. */
export function verifySnapshotWithRevocations(
  snapshot: Record<string, unknown>,
  revoked: RevokedKey[] = loadRevocations(),
): VerifyResult {
  const base = verifySnapshot(snapshot);
  if (!base.valid) return base;
  const manifest = snapshot.signature as SignedManifest;
  const hit = isRevoked(manifest.keyId, revoked);
  if (hit) {
    return {
      valid: false,
      reason: `signature is well-formed but key ${hit.keyId} was REVOKED on ${hit.revokedAt} (${hit.reason})`,
    };
  }
  return base;
}

// ---------------------------------------------------------------------------
// Key history
// ---------------------------------------------------------------------------

/**
 * A revoked key must not erase history — it changes how that history should be
 * interpreted. So a snapshot signed by a key that was later rotated (but never
 * revoked) still verifies; a snapshot signed by a revoked key reads as invalid.
 * To support that, we keep an append-only local record of when each key was
 * first seen, and publish a key-history document so any verifier can interpret a
 * snapshot's signing key without contacting us.
 *
 * The published history contains only key ids, public keys, and dates/reasons —
 * never private material.
 */
const KEY_HISTORY_FILE = path.join(process.cwd(), '.tokens-cache', 'key-history.json');

interface KeyHistoryRecord {
  keyId: string;
  publicKey: string;
  firstSeen: string;
}

function loadLocalKeyHistory(): KeyHistoryRecord[] {
  try {
    const parsed = JSON.parse(readFileSync(KEY_HISTORY_FILE, 'utf8')) as { keys?: KeyHistoryRecord[] };
    return Array.isArray(parsed?.keys) ? parsed.keys : [];
  } catch {
    return [];
  }
}

/** Record the current key's first-seen date (append-only, idempotent). */
export function recordKeySeen(keyId: string, publicKey: string, now: string): void {
  const history = loadLocalKeyHistory();
  if (history.some((entry) => entry.keyId === keyId)) return;
  history.push({ keyId, publicKey, firstSeen: now });
  try {
    mkdirSync(path.dirname(KEY_HISTORY_FILE), { recursive: true });
    writeFileSync(KEY_HISTORY_FILE, `${JSON.stringify({ keys: history }, null, 2)}\n`);
  } catch {
    /* best effort */
  }
}

export type KeyStatus = 'active' | 'rotated' | 'revoked';
export interface PublicKeyHistoryEntry {
  keyId: string;
  publicKey: string;
  firstSeen: string | null;
  status: KeyStatus;
  revokedAt: string | null;
  reason: string | null;
}

/**
 * Build the publishable key history: every key we've signed with, marked active
 * (the current key), rotated (a previous key, still trusted for its snapshots),
 * or revoked (compromised — its snapshots must be rejected).
 */
export function buildPublicKeyHistory(currentKeyId: string, currentPublicKey: string, now: string): {
  updatedAt: string;
  activeKeyId: string;
  keys: PublicKeyHistoryEntry[];
} {
  const local = loadLocalKeyHistory();
  if (!local.some((entry) => entry.keyId === currentKeyId)) {
    local.push({ keyId: currentKeyId, publicKey: currentPublicKey, firstSeen: now });
  }
  const revoked = new Map(loadRevocations().map((entry) => [entry.keyId, entry]));
  const keys: PublicKeyHistoryEntry[] = local.map((entry) => {
    const rev = revoked.get(entry.keyId);
    const status: KeyStatus = rev ? 'revoked' : entry.keyId === currentKeyId ? 'active' : 'rotated';
    return {
      keyId: entry.keyId,
      publicKey: entry.publicKey,
      firstSeen: entry.firstSeen ?? null,
      status,
      revokedAt: rev?.revokedAt ?? null,
      reason: rev?.reason ?? null,
    };
  });
  return { updatedAt: now, activeKeyId: currentKeyId, keys };
}
