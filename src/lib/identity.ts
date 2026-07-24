/**
 * Browser-side identity-proof verification.
 *
 * A member proves control of an external account by publishing a statement,
 * signed by their TOKENS device key, under that account. Here we independently
 * check it — in the visitor's browser, trusting no one:
 *
 *   1. Fetch the gist from api.github.com (CORS-enabled). Its owner.login is the
 *      account that actually published it.
 *   2. The claimed handle must equal that owner.
 *   3. The proof's keyId must equal the key that signed THIS profile snapshot —
 *      so the account and the profile are bound to the same key.
 *   4. The proof's signature must verify against its public key over the exact
 *      canonical bytes the collector signed.
 *
 * What a pass establishes: the holder of the profile's signing key also controls
 * that GitHub account. NOT legal identity, and not that the account is genuine.
 */

import { canonicalize, verifyEd25519 } from './verify';

export type IdentityState = 'checking' | 'verified' | 'failed' | 'unreachable';

export interface IdentityResult {
  type: 'github';
  handle: string;
  url: string;
  state: IdentityState;
  detail: string;
}

interface Proof {
  type: string;
  handle: string;
  gistId: string;
}

/** Verify one identity proof against the profile's signing keyId. */
export async function verifyIdentityProof(proof: Proof, snapshotKeyId: string | undefined): Promise<IdentityResult> {
  const url = `https://github.com/${proof.handle}`;
  const base: IdentityResult = { type: 'github', handle: proof.handle, url, state: 'checking', detail: '' };
  if (proof.type !== 'github') return { ...base, state: 'failed', detail: 'Unsupported proof type.' };

  try {
    const response = await fetch(`https://api.github.com/gists/${proof.gistId}`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) {
      return { ...base, state: 'unreachable', detail: `Could not fetch the proof gist (HTTP ${response.status}).` };
    }
    const gist = (await response.json()) as {
      owner?: { login?: string };
      files?: Record<string, { content?: string }>;
    };

    const owner = gist.owner?.login ?? '';
    if (owner.toLowerCase() !== proof.handle.toLowerCase()) {
      return { ...base, state: 'failed', detail: `The gist is owned by @${owner}, not @${proof.handle}.` };
    }

    const file = gist.files?.['tokens-identity.json'] ?? Object.values(gist.files ?? {})[0];
    if (!file?.content) return { ...base, state: 'failed', detail: 'The gist has no tokens-identity.json content.' };

    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(file.content);
    } catch {
      return { ...base, state: 'failed', detail: 'The proof content is not valid JSON.' };
    }

    const { signature, ...body } = doc as { signature?: string; keyId?: string; publicKey?: string };
    if (typeof signature !== 'string' || typeof body.keyId !== 'string' || typeof body.publicKey !== 'string') {
      return { ...base, state: 'failed', detail: 'The proof is missing a keyId, publicKey, or signature.' };
    }

    if (snapshotKeyId && body.keyId !== snapshotKeyId) {
      return {
        ...base,
        state: 'failed',
        detail: 'The proof is signed by a different key than the one that signed this profile.',
      };
    }

    const ok = await verifyEd25519(body.publicKey, signature, canonicalize(body));
    if (!ok) return { ...base, state: 'failed', detail: 'The proof signature did not verify.' };

    return {
      ...base,
      state: 'verified',
      detail: `Verified in your browser: the holder of this profile's key controls github.com/${proof.handle}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'fetch failed';
    return { ...base, state: 'unreachable', detail: `Could not verify (${message}).` };
  }
}
