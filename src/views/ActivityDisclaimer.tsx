/**
 * The permanent "not a score" statement.
 *
 * Reddit feedback was blunt: people read the token number as skill, productivity,
 * or pay. This line must appear NEXT TO every token total — never buried in a
 * methodology page — so the number is always framed the moment it is seen.
 *
 * It used to carry two different wordings of that idea, one per density. Both now
 * lead with the same canonical sentence; the full form only adds the reasoning.
 */

import { CAVEATS } from '../lib/caveats';

export function ActivityDisclaimer({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="activity-disclaimer activity-disclaimer-compact">{CAVEATS.volume}</p>
    );
  }
  return (
    <p className="activity-disclaimer" role="note">
      <strong>{CAVEATS.volume}</strong> {CAVEATS.volumeWhy}
    </p>
  );
}

/** Short integrity note for signature panels. */
export function SignatureDisclaimer({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="activity-disclaimer activity-disclaimer-compact">
        {CAVEATS.signatureProves} {CAVEATS.signatureNotHonesty}
      </p>
    );
  }
  return (
    <p className="activity-disclaimer" role="note">
      <strong>{CAVEATS.signatureProves}</strong> {CAVEATS.signatureNotHonesty} {CAVEATS.signatureNotIdentity}
    </p>
  );
}
