/**
 * Key trust interpretation for published snapshots.
 *
 * A rotated key is not the same as a revoked key:
 *   - rotated  → historical signatures still prove integrity under that key
 *   - revoked  → cryptographically valid, but trust interpretation changes
 *
 * Never erase history when a key rotates or is revoked.
 */

import type { SignatureState } from './registry';

export interface KeyHistoryEntry {
  keyId: string;
  publicKey?: string;
  firstSeen?: string | null;
  status?: 'active' | 'rotated' | 'revoked' | string;
  revokedAt?: string | null;
  reason?: string | null;
}

export interface KeyHistoryDoc {
  updatedAt?: string;
  activeKeyId?: string;
  keys?: KeyHistoryEntry[];
}

export type KeyTrustClass =
  | 'unsigned'
  | 'invalid'
  | 'unreachable'
  | 'checking'
  | 'active' // signed by current active key
  | 'historical' // signed by rotated, non-revoked key
  | 'revoked' // well-formed but revoked
  | 'history_unavailable'; // valid crypto; no history to classify further

export interface KeyTrustResult {
  /** Coarse UI state used by badges and filters. */
  state: SignatureState;
  /** Fine-grained trust class. */
  trust: KeyTrustClass;
  reason: string;
  keyId?: string;
}

/**
 * Classify a crypto-valid signature using published key history + revocation list.
 * Call only after cryptographic verification has already succeeded (or failed).
 */
export function classifyKeyTrust(input: {
  cryptoState: 'checking' | 'valid' | 'invalid' | 'unsigned' | 'unreachable';
  cryptoReason: string;
  keyId?: string;
  issuedAt?: string;
  revokedKeyIds?: string[];
  history?: KeyHistoryDoc | null;
}): KeyTrustResult {
  const { cryptoState, cryptoReason, keyId, issuedAt, revokedKeyIds = [], history } = input;

  if (cryptoState === 'checking') {
    return { state: 'checking', trust: 'checking', reason: cryptoReason, keyId };
  }
  if (cryptoState === 'unsigned') {
    return { state: 'unsigned', trust: 'unsigned', reason: cryptoReason, keyId };
  }
  if (cryptoState === 'unreachable') {
    return { state: 'unreachable', trust: 'unreachable', reason: cryptoReason, keyId };
  }
  if (cryptoState === 'invalid') {
    return { state: 'invalid', trust: 'invalid', reason: cryptoReason, keyId };
  }

  // cryptoState === 'valid'
  if (!keyId) {
    return {
      state: 'valid',
      trust: 'history_unavailable',
      reason: `${cryptoReason} Key id missing — cannot classify rotation/revocation state.`,
    };
  }

  if (revokedKeyIds.includes(keyId)) {
    const entry = history?.keys?.find((k) => k.keyId === keyId);
    const when = entry?.revokedAt ? ` on ${entry.revokedAt}` : '';
    const why = entry?.reason ? ` (${entry.reason})` : '';
    return {
      state: 'revoked_key',
      trust: 'revoked',
      keyId,
      reason:
        `Signature is cryptographically well-formed, but key ${keyId} was revoked${when}${why}. ` +
        'Historical records may remain visible; trust interpretation changes. Not erased.',
    };
  }

  if (!history?.keys?.length) {
    return {
      state: 'valid',
      trust: 'history_unavailable',
      keyId,
      reason:
        `${cryptoReason} Key history unavailable — treated as device-signed integrity only, without rotation classification.`,
    };
  }

  const entry = history.keys.find((k) => k.keyId === keyId);
  const activeId = history.activeKeyId;

  if (entry?.status === 'revoked' || (entry?.revokedAt && entry.status !== 'active' && entry.status !== 'rotated')) {
    return {
      state: 'revoked_key',
      trust: 'revoked',
      keyId,
      reason: `Key ${keyId} is listed as revoked in key history${entry.revokedAt ? ` at ${entry.revokedAt}` : ''}.`,
    };
  }

  if (activeId && keyId === activeId) {
    return {
      state: 'valid',
      trust: 'active',
      keyId,
      reason: `${cryptoReason} Signed by the current active device key.`,
    };
  }

  if (entry?.status === 'rotated' || (activeId && keyId !== activeId)) {
    // Issued after a key's revocation date would be anomalous; history usually
    // marks that revoked. If only rotated, historical signatures remain valid.
    if (entry?.revokedAt && issuedAt && Date.parse(issuedAt) > Date.parse(entry.revokedAt)) {
      return {
        state: 'revoked_key',
        trust: 'revoked',
        keyId,
        reason: `Signature issued at ${issuedAt} is after key ${keyId} revocation at ${entry.revokedAt}.`,
      };
    }
    return {
      state: 'historical',
      trust: 'historical',
      keyId,
      reason:
        `${cryptoReason} Signed by a historical rotated key (${keyId}). Integrity still holds; key is no longer active.`,
    };
  }

  return {
    state: 'valid',
    trust: 'history_unavailable',
    keyId,
    reason: `${cryptoReason} Key ${keyId} not found in published history.`,
  };
}

/** Load same-origin key history + revocations for browser verification. */
export async function loadKeyTrustMaterials(
  signal?: AbortSignal,
): Promise<{ revokedKeyIds: string[]; history: KeyHistoryDoc | null }> {
  const base = import.meta.env.BASE_URL;
  let revokedKeyIds: string[] = [];
  let history: KeyHistoryDoc | null = null;
  try {
    const revRes = await fetch(`${base}data/revoked-keys.json`, { signal, cache: 'no-cache' });
    if (revRes.ok) {
      const rev = (await revRes.json()) as { revoked?: { keyId?: string }[] };
      revokedKeyIds = (rev.revoked ?? [])
        .map((e) => e.keyId)
        .filter((id): id is string => typeof id === 'string' && /^[a-f0-9]{16}$/.test(id));
    }
  } catch {
    /* optional */
  }
  try {
    const histRes = await fetch(`${base}data/key-history.json`, { signal, cache: 'no-cache' });
    if (histRes.ok) history = (await histRes.json()) as KeyHistoryDoc;
  } catch {
    /* optional */
  }
  return { revokedKeyIds, history };
}
