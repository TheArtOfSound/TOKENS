/**
 * Signature state badge.
 *
 * Never a generic "Verified" person badge. Valid state means device-signed
 * integrity of the published bytes — not identity, skill, or source honesty.
 */

import type { SignatureState } from '../lib/registry';
import { signatureAuthorityLabel } from '../lib/evidenceAuthority';

export function SignatureBadge({ state, reason }: { state: SignatureState; reason?: string }) {
  const auth = signatureAuthorityLabel(state === 'valid' ? 'valid' : state);
  const title = reason ?? auth.explains;
  return (
    <span className={`sig sig-${state}`} title={title}>
      <span aria-hidden="true" className="sig-dot" />
      {auth.label}
    </span>
  );
}
