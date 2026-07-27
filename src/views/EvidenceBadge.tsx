/**
 * Claim-bounded evidence badge.
 *
 * Never a bare "Verified". Title always states what is allowed and excluded.
 */

import type { ClaimAuthoritySignal } from '../lib/usage';
import { href } from '../lib/router';

function titleFor(signal: ClaimAuthoritySignal): string {
  const allow = signal.allowedClaims.length
    ? `May establish: ${signal.allowedClaims.join(', ')}.`
    : 'Establishes no strong claim on its own.';
  const exclude = signal.excludedClaims.length
    ? ` Cannot establish: ${signal.excludedClaims.slice(0, 6).join(', ')}.`
    : '';
  return `${signal.explains} ${allow}${exclude} Confidence: ${signal.confidence}.`;
}

export function EvidenceBadge({
  signal,
  compact = false,
}: {
  signal: ClaimAuthoritySignal;
  compact?: boolean;
}) {
  return (
    <span
      className={`ebadge ebadge-${signal.tier} ${signal.present ? 'is-present' : 'is-absent'} ${compact ? 'ebadge-compact' : ''}`}
      title={titleFor(signal)}
    >
      <b aria-hidden="true">{signal.present ? '●' : '○'}</b>
      {signal.badgeLabel}
      {!compact ? <em className="ebadge-tier">{signal.tier.replace(/_/g, ' ')}</em> : null}
    </span>
  );
}

export function EvidenceBadgeRow({
  signals,
  onlyPresent = true,
  compact = false,
  max = 6,
}: {
  signals: ClaimAuthoritySignal[] | undefined;
  onlyPresent?: boolean;
  compact?: boolean;
  max?: number;
}) {
  if (!signals?.length) return null;
  const list = (onlyPresent ? signals.filter((s) => s.present) : signals).slice(0, max);
  if (!list.length) return null;
  return (
    <div className="ebadge-row" role="list" aria-label="Evidence claim boundaries">
      {list.map((s) => (
        <span key={s.signalType} role="listitem">
          <EvidenceBadge signal={s} compact={compact} />
        </span>
      ))}
      <a className="ebadge-more" href={href({ name: 'claims' })}>
        Claim boundaries →
      </a>
    </div>
  );
}
