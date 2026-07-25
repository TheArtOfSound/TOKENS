/**
 * The "what these signals establish" footer note.
 *
 * The directory and the employer page each carried their own hand-written copy
 * of this paragraph. They had already drifted — one said "a verified signature
 * proves a snapshot was produced by a device key", the other "a verified
 * signature proves a snapshot is authentic and unaltered" — which is two
 * different claims about the same mechanism, on two pages a hiring manager is
 * likely to read back to back.
 */

import { CAVEATS } from '../lib/caveats';
import { href } from '../lib/router';

export function EvidenceNote({ tiers = false }: { tiers?: boolean }) {
  return (
    <p className="muted evidence-note">
      {CAVEATS.signatureProves} {CAVEATS.signatureNotIdentity}
      {tiers ? ' Provider-attested usage and third-party-confirmed outcomes are separate, stronger tiers, shown per profile.' : ''}{' '}
      <a href={href({ name: 'claims' })}>What each signal can and cannot establish →</a>
    </p>
  );
}
