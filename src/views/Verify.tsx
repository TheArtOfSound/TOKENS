/**
 * Verification explainer + a live checker.
 *
 * Anyone can paste a snapshot URL and verify it here, in their own browser. The
 * point is that trust in this directory should not require trusting us.
 */

import { useState } from 'react';
import { verifySnapshotInBrowser } from '../lib/verify';
import { isSafeSnapshotUrl, type SignatureState } from '../lib/registry';
import { SignatureBadge } from './Directory';

export function Verify() {
  const [url, setUrl] = useState('');
  const [state, setState] = useState<SignatureState | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function check(event: React.FormEvent) {
    event.preventDefault();
    if (!isSafeSnapshotUrl(url)) {
      setState('invalid');
      setReason('Enter an https:// URL (or a same-origin path starting with /).');
      return;
    }
    setBusy(true);
    setState('checking');
    setReason('');
    try {
      const response = await fetch(url, { cache: 'no-cache' });
      if (!response.ok) {
        setState('unreachable');
        setReason(`Could not fetch that URL (HTTP ${response.status}).`);
        return;
      }
      const outcome = await verifySnapshotInBrowser(await response.json());
      setState(outcome.state);
      setReason(outcome.reason);
    } catch (error) {
      setState('unreachable');
      setReason(
        error instanceof Error
          ? `${error.message}. If this is another origin, it must send CORS headers.`
          : 'Fetch failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="verify-page" id="verify">
      <h1>How verification works</h1>
      <p className="lede">
        Every profile in this directory is backed by a snapshot the member hosts themselves, signed by a key
        that never leaves their machine. Your browser checks that signature directly. You do not have to trust
        this site, the member, or us.
      </p>

      <ol className="steps">
        <li>
          <h2>1. The collector signs locally</h2>
          <p>
            An Ed25519 keypair is generated on the member's machine and the private key is stored in their OS
            keychain. The snapshot is canonicalized (a fixed RFC 8785 subset, so byte order is deterministic),
            hashed with SHA-256, and that digest is signed together with a nonce, scope, and issue time.
          </p>
        </li>
        <li>
          <h2>2. Your browser re-derives the same bytes</h2>
          <p>
            This page canonicalizes the snapshot the same way, recomputes the digest, and verifies the
            signature against the public key embedded in the file. If a single byte of the data changed after
            signing, the digest will not match.
          </p>
        </li>
        <li>
          <h2>3. Revoked keys are rejected</h2>
          <p>
            A cryptographically valid signature from a key its owner has revoked is still reported as invalid.
            Revocations are published separately from snapshots so a compromised key cannot suppress its own
            revocation.
          </p>
        </li>
      </ol>

      <form className="verify-form" onSubmit={check}>
        <label htmlFor="verify-url">Verify any snapshot yourself</label>
        <div className="verify-row">
          <input
            id="verify-url"
            type="url"
            inputMode="url"
            placeholder="https://example.com/data/latest.json"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <button type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Verify'}
          </button>
        </div>
      </form>

      {state && (
        <div className="verify-result">
          <SignatureBadge state={state} reason={reason} />
          <p>{reason}</p>
        </div>
      )}

      <section className="join-honest">
        <h2>What a signature does not prove</h2>
        <ul>
          <li>
            <strong>Not legal identity.</strong> It proves a key signed this, not who holds the key. A member
            can additionally link an external account (e.g. GitHub), which your browser verifies here — that
            proves control of that account, still not who they legally are.
          </li>
          <li>
            <strong>Not log authenticity.</strong> Anyone controlling a machine could feed the collector
            fabricated provider logs and it would sign them faithfully. The signature attests to the device and
            the content, not to the truth of the underlying logs.
          </li>
          <li>
            <strong>Not skill.</strong> Token volume measures practice, not ability. Nothing here ranks people
            by it.
          </li>
        </ul>
      </section>
    </section>
  );
}
