/**
 * Signature state badge.
 *
 * Extracted from Directory so the directory, employer, and member views can all
 * import it without depending on a page component. State is never conveyed by
 * colour alone — each state also carries distinct text.
 */

import type { SignatureState } from '../lib/registry';

const LABEL: Record<SignatureState, string> = {
  checking: 'Verifying…',
  valid: 'Signature verified',
  invalid: 'Signature failed',
  unsigned: 'Unsigned',
  unreachable: 'Unreachable',
};

export function SignatureBadge({ state, reason }: { state: SignatureState; reason?: string }) {
  return (
    <span className={`sig sig-${state}`} title={reason ?? LABEL[state]}>
      <span aria-hidden="true" className="sig-dot" />
      {LABEL[state]}
    </span>
  );
}
