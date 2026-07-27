/**
 * Browser-side signature verification.
 *
 * This is what makes a directory of strangers trustworthy. A visitor does not
 * have to believe the registry, the site operator, or the member: they fetch the
 * member's snapshot and check the Ed25519 signature themselves, in their own
 * browser, against the public key embedded in the snapshot.
 *
 * It must reproduce the collector's signing bytes EXACTLY, so the canonical-JSON
 * serializer here mirrors collector/lib/canonicalJson.ts. Any divergence shows up
 * immediately as a failed verification (there are tests on both sides).
 *
 * What a valid signature proves: this snapshot was produced by the holder of
 * that device key and has not been altered since.
 * What it does NOT prove: that the underlying provider logs were genuine, or who
 * that person is. Identity verification is a separate, unbuilt layer.
 */

import type { SignatureState } from './registry';
import { classifyKeyTrust, type KeyHistoryDoc } from './keyTrust';

/** RFC 8785 subset — must match collector/lib/canonicalJson.ts exactly. */
export function canonicalize(value: unknown): string {
  const out: string[] = [];
  write(value, out);
  return out.join('');
}

function write(value: unknown, out: string[]): void {
  if (value === null || value === undefined) {
    out.push('null');
    return;
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    out.push(JSON.stringify(value));
    return;
  }
  if (typeof value === 'string') {
    out.push(JSON.stringify(value));
    return;
  }
  if (Array.isArray(value)) {
    out.push('[');
    value.forEach((item, index) => {
      if (index > 0) out.push(',');
      write(item, out);
    });
    out.push(']');
    return;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    out.push('{');
    entries.forEach(([key, v], index) => {
      if (index > 0) out.push(',');
      out.push(JSON.stringify(key), ':');
      write(v, out);
    });
    out.push('}');
    return;
  }
  out.push('null');
}

/** Verify an Ed25519 signature (all base64) over a UTF-8 message, in-browser. */
export async function verifyEd25519(publicKeyB64: string, signatureB64: string, message: string): Promise<boolean> {
  if (!crypto?.subtle) return false;
  try {
    const key = await crypto.subtle.importKey('spki', base64ToBytes(publicKeyB64), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, base64ToBytes(signatureB64), new TextEncoder().encode(message));
  } catch {
    return false;
  }
}

function base64ToBytes(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface VerifyOutcome {
  state: SignatureState;
  reason: string;
  keyId?: string;
}

export interface SnapshotSignature {
  signatureVersion?: string;
  algorithm?: string;
  publicKey?: string;
  keyId?: string;
  issuedAt?: string;
  nonce?: string;
  scope?: string;
  payloadSha256?: string;
  signature?: string;
}

/**
 * Verify a fetched snapshot. Returns a state rather than throwing so the UI can
 * always render something honest.
 */
export async function verifySnapshotInBrowser(
  snapshot: Record<string, unknown>,
  revokedKeyIds: string[] = [],
  keyHistory: KeyHistoryDoc | null = null,
): Promise<VerifyOutcome> {
  const manifest = snapshot.signature as SnapshotSignature | undefined;
  if (!manifest || typeof manifest !== 'object') {
    return { state: 'unsigned', reason: 'This snapshot carries no signature.' };
  }
  if (manifest.algorithm !== 'ed25519' || !manifest.publicKey || !manifest.signature) {
    return { state: 'invalid', reason: 'Signature manifest is malformed or uses an unsupported algorithm.' };
  }
  if (!crypto?.subtle) {
    return { state: 'unsigned', reason: 'This browser cannot verify signatures (no WebCrypto).' };
  }

  try {
    // 1. The payload digest must match the snapshot as delivered.
    const { signature: _omit, ...signable } = snapshot;
    const digest = await sha256Hex(canonicalize(signable));
    if (digest !== manifest.payloadSha256) {
      return {
        state: 'invalid',
        reason: 'Content does not match the signed digest — the snapshot was altered after signing.',
        keyId: manifest.keyId,
      };
    }

    // 2. The signature must cover the manifest header bound to that digest.
    const bound = canonicalize({
      algorithm: 'ed25519',
      issuedAt: manifest.issuedAt,
      keyId: manifest.keyId,
      nonce: manifest.nonce,
      payloadSha256: manifest.payloadSha256,
      scope: manifest.scope,
      signatureVersion: manifest.signatureVersion,
    });

    const key = await crypto.subtle.importKey('spki', base64ToBytes(manifest.publicKey), { name: 'Ed25519' }, false, [
      'verify',
    ]);
    const ok = await crypto.subtle.verify(
      'Ed25519',
      key,
      base64ToBytes(manifest.signature),
      new TextEncoder().encode(bound),
    );
    if (!ok) {
      return { state: 'invalid', reason: 'Signature does not verify against the embedded public key.', keyId: manifest.keyId };
    }

    // 3. Classify active vs historical vs revoked using published key materials.
    // Revoked keys are a distinct state (not silently "invalid") so history is visible.
    const classified = classifyKeyTrust({
      cryptoState: 'valid',
      cryptoReason: 'Signature verified in your browser against the key embedded in this snapshot.',
      keyId: manifest.keyId,
      issuedAt: manifest.issuedAt,
      revokedKeyIds,
      history: keyHistory,
    });
    return { state: classified.state, reason: classified.reason, keyId: classified.keyId };
  } catch (error) {
    // Ed25519 via WebCrypto is unavailable in some older browsers.
    const message = error instanceof Error ? error.message : String(error);
    if (/Ed25519|not supported|Unrecognized/i.test(message)) {
      return { state: 'unsigned', reason: 'This browser does not support Ed25519 verification.' };
    }
    return { state: 'invalid', reason: `Verification failed: ${message}` };
  }
}
