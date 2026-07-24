/**
 * Signing and canonicalization tests.
 *
 * The point of a signature is that an INDEPENDENT party can check it. So these
 * verify tamper detection field-by-field, and pin the canonical form so a
 * non-JavaScript implementation can reproduce the exact signing bytes.
 */
import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { canonicalize } from '../canonicalJson';
import { decodeKeychainValue, isRevoked, payloadDigest, publicKeyFrom, signSnapshot, verifySnapshot, verifySnapshotWithRevocations } from '../signing';

function testKey(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

const snapshot = () => ({
  generatedAt: '2026-07-23T00:00:00.000Z',
  totals: { totalTokens: 1234, estimatedCostUsd: 5.5 },
  daily: [{ date: '2026-07-01', totalTokens: 1234 }],
  profile: { identity: { displayName: 'Test' } },
});

describe('canonical JSON', () => {
  it('is independent of key insertion order', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it('sorts keys by UTF-16 code unit and emits no whitespace', () => {
    expect(canonicalize({ b: 1, A: 2, a: 3 })).toBe('{"A":2,"a":3,"b":1}');
  });

  it('normalizes -0 and preserves array order', () => {
    expect(canonicalize({ z: -0, list: [3, 1, 2] })).toBe('{"list":[3,1,2],"z":0}');
  });

  it('escapes control characters and quotes', () => {
    expect(canonicalize({ s: 'a"b\nc' })).toBe('{"s":"a\\"b\\nc"}');
  });

  it('rejects non-finite numbers rather than emitting invalid JSON', () => {
    expect(() => canonicalize({ n: Number.NaN })).toThrow();
    expect(() => canonicalize({ n: Number.POSITIVE_INFINITY })).toThrow();
  });

  it('omits undefined members but keeps undefined array slots as null', () => {
    expect(canonicalize({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalize({ a: [1, undefined, 2] })).toBe('{"a":[1,null,2]}');
  });

  it('produces a stable digest across differently-ordered but equal documents', () => {
    const a = { x: 1, y: { p: 1, q: 2 } };
    const b = { y: { q: 2, p: 1 }, x: 1 };
    expect(payloadDigest(a)).toBe(payloadDigest(b));
  });
});

describe('sign and verify', () => {
  it('round-trips: a freshly signed snapshot verifies', () => {
    const key = testKey();
    const doc: Record<string, unknown> = snapshot();
    doc.signature = signSnapshot(doc, key, 'nonce-1');
    expect(verifySnapshot(doc)).toMatchObject({ valid: true });
  });

  it('detects a modified token total', () => {
    const key = testKey();
    const doc: Record<string, unknown> = snapshot();
    doc.signature = signSnapshot(doc, key, 'nonce-1');
    (doc.totals as Record<string, unknown>).totalTokens = 999_999;
    const result = verifySnapshot(doc);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/digest mismatch/);
  });

  it('detects an added field', () => {
    const key = testKey();
    const doc: Record<string, unknown> = snapshot();
    doc.signature = signSnapshot(doc, key, 'nonce-1');
    doc.injected = 'extra';
    expect(verifySnapshot(doc).valid).toBe(false);
  });

  it('detects a removed field', () => {
    const key = testKey();
    const doc: Record<string, unknown> = snapshot();
    doc.signature = signSnapshot(doc, key, 'nonce-1');
    delete doc.daily;
    expect(verifySnapshot(doc).valid).toBe(false);
  });

  it('rejects a signature swapped from a different key', () => {
    const doc: Record<string, unknown> = snapshot();
    doc.signature = signSnapshot(doc, testKey(), 'nonce-1');
    const other = signSnapshot(snapshot(), testKey(), 'nonce-1');
    // Keep the honest digest but graft another key's signature bytes.
    (doc.signature as Record<string, unknown>).signature = other.signature;
    expect(verifySnapshot(doc).valid).toBe(false);
  });

  it('rejects a tampered nonce', () => {
    const doc: Record<string, unknown> = snapshot();
    doc.signature = signSnapshot(doc, testKey(), 'nonce-1');
    (doc.signature as Record<string, unknown>).nonce = 'nonce-2';
    expect(verifySnapshot(doc).valid).toBe(false);
  });

  it('reports missing signatures instead of passing them', () => {
    expect(verifySnapshot(snapshot() as Record<string, unknown>)).toMatchObject({ valid: false });
  });

  it('never exposes private key material in the manifest', () => {
    const key = testKey();
    const doc: Record<string, unknown> = snapshot();
    const manifest = signSnapshot(doc, key, 'nonce-1');
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain('PRIVATE KEY');
    expect(serialized).not.toContain(key.slice(40, 80));
  });

  it('derives a stable keyId from the public key', () => {
    const key = testKey();
    expect(publicKeyFrom(key).keyId).toBe(publicKeyFrom(key).keyId);
    expect(publicKeyFrom(key).keyId).toHaveLength(16);
  });
});

describe('honesty of the signature claim', () => {
  it('states what it does not prove', () => {
    const manifest = signSnapshot(snapshot(), testKey(), 'n');
    expect(manifest.doesNotProve.join(' ')).toMatch(/source logs/i);
    expect(manifest.doesNotProve.join(' ')).toMatch(/identity/i);
    expect(manifest.proves).not.toMatch(/immutable|tamper-proof|guarantee/i);
  });
});

describe('keychain value decoding', () => {
  // Regression: `security -w` returns HEX for any secret containing newlines,
  // which a PEM always does. The original check looked for "PRIVATE KEY" in the
  // raw output, never matched, and silently minted a NEW device key every run.
  const pem = '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIA==\n-----END PRIVATE KEY-----\n';

  it('decodes a hex-encoded PEM (what `security` actually returns)', () => {
    const hex = Buffer.from(pem, 'utf8').toString('hex');
    expect(decodeKeychainValue(hex)).toBe(pem.trim());
  });

  it('decodes a base64-encoded PEM (how we now store it)', () => {
    expect(decodeKeychainValue(Buffer.from(pem, 'utf8').toString('base64'))).toBe(pem.trim());
  });

  it('passes through a raw PEM unchanged', () => {
    expect(decodeKeychainValue(pem)).toBe(pem.trim());
  });

  it('returns null for empty or non-key data instead of a bogus key', () => {
    expect(decodeKeychainValue('')).toBeNull();
    expect(decodeKeychainValue('   ')).toBeNull();
    expect(decodeKeychainValue('not a key at all')).toBeNull();
    expect(decodeKeychainValue('deadbeef')).toBeNull();
  });
});

describe('key revocation', () => {
  // Rotation alone leaves already-published snapshots verifying under a stolen
  // key forever. A revocation list is what makes a compromise repudiable.
  const key = testKey();
  const signed = () => {
    const doc: Record<string, unknown> = snapshot();
    doc.signature = signSnapshot(doc, key, 'nonce-1');
    return doc;
  };

  it('a well-formed signature from a revoked key is INVALID', () => {
    const doc = signed();
    const keyId = (doc.signature as { keyId: string }).keyId;
    const result = verifySnapshotWithRevocations(doc, [
      { keyId, revokedAt: '2026-07-24T00:00:00.000Z', reason: 'laptop stolen' },
    ]);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/REVOKED/);
    expect(result.reason).toMatch(/laptop stolen/);
  });

  it('remains valid when a DIFFERENT key is revoked', () => {
    expect(verifySnapshotWithRevocations(signed(), [
      { keyId: '0000000000000000', revokedAt: '2026-07-24T00:00:00.000Z', reason: 'unrelated' },
    ]).valid).toBe(true);
  });

  it('an empty revocation list changes nothing', () => {
    expect(verifySnapshotWithRevocations(signed(), []).valid).toBe(true);
  });

  it('isRevoked matches only the exact key id', () => {
    const list = [{ keyId: 'abcdef0123456789', revokedAt: '2026-07-24T00:00:00.000Z', reason: 'test' }];
    expect(isRevoked('abcdef0123456789', list)).toBeTruthy();
    expect(isRevoked('abcdef012345678a', list)).toBeNull();
  });

  it('tampering still loses to revocation checks (both must pass)', () => {
    const doc = signed();
    (doc.totals as Record<string, unknown>).totalTokens = 1;
    expect(verifySnapshotWithRevocations(doc, []).valid).toBe(false);
  });
});
