/**
 * Claim-bounded evidence authority.
 *
 * Reddit feedback crystallized the ladder every signal must climb:
 *
 *   signal → provenance → allowed claim → confidence → limitations
 *
 * A valid signature proves integrity of published bytes and possession of a
 * device key. It does not prove identity, authorship, skill, source honesty,
 * permission, or outcomes. This module is the shared vocabulary so badges and
 * UI never invent a generic "Verified" endorsement.
 */

export type EvidenceTier =
  | 'self_submitted'
  | 'collector_observed'
  | 'device_signed'
  | 'provider_attested'
  | 'benchmark_assessed'
  | 'third_party_confirmed';

export type ClaimKey =
  | 'activity_occurred'
  | 'snapshot_integrity'
  | 'device_key_possession'
  | 'account_control'
  | 'identity'
  | 'authorship'
  | 'expertise'
  | 'quality'
  | 'productivity'
  | 'permission'
  | 'outcome'
  | 'compensation_fit';

export type Confidence = 'high' | 'medium' | 'low';

export interface EvidenceAuthority {
  signalType: string;
  provenance: string;
  tier: EvidenceTier;
  allowedClaims: ClaimKey[];
  excludedClaims: ClaimKey[];
  confidence: Confidence;
  limitations: string[];
  /** Short badge label — never a bare "Verified". */
  badgeLabel: string;
  /** One-line explanation shown next to the badge. */
  explains: string;
}

const NEVER_FROM_VOLUME: ClaimKey[] = [
  'identity',
  'authorship',
  'expertise',
  'quality',
  'productivity',
  'permission',
  'outcome',
  'compensation_fit',
];

/** Canonical authorities used across the product surface. */
export const AUTHORITIES = {
  collectorObservedActivity: {
    signalType: 'collector_observed_activity',
    provenance: 'local_provider_usage_record',
    tier: 'collector_observed',
    allowedClaims: ['activity_occurred'],
    excludedClaims: NEVER_FROM_VOLUME,
    confidence: 'high',
    limitations: ['locally controlled source', 'does not establish work quality'],
    badgeLabel: 'Collector-observed activity',
    explains: 'A compatible local usage record was observed. Not expertise or productivity.',
  },
  deviceSignedSnapshot: {
    signalType: 'device_signed_snapshot',
    provenance: 'ed25519_device_key',
    tier: 'device_signed',
    allowedClaims: ['snapshot_integrity', 'device_key_possession'],
    excludedClaims: [
      'identity',
      'authorship',
      'expertise',
      'quality',
      'productivity',
      'permission',
      'outcome',
      'activity_occurred', // signature alone does not prove the activity happened honestly
    ],
    confidence: 'high',
    limitations: [
      'does not prove source logs were honest or unmodified',
      'does not prove legal identity of the key holder',
    ],
    badgeLabel: 'Device-signed activity record',
    explains:
      'Signature confirms integrity and signing key of this snapshot. It does not independently prove identity, authorship, skill, source honesty, permission, or outcomes.',
  },
  providerReportedTokens: {
    signalType: 'provider_reported_token_counts',
    provenance: 'local_agent_usage_accounting',
    tier: 'provider_attested',
    allowedClaims: ['activity_occurred'],
    excludedClaims: NEVER_FROM_VOLUME,
    confidence: 'medium',
    limitations: ['provider accounting, not an invoice', 'locally controlled source files'],
    badgeLabel: 'Provider-reported usage',
    explains: 'Token counts come from provider usage accounting in local logs — not a skill score.',
  },
  selfSubmittedIdentity: {
    signalType: 'self_submitted_identity',
    provenance: 'profile_json',
    tier: 'self_submitted',
    allowedClaims: [],
    excludedClaims: ['identity', 'authorship', 'expertise', 'outcome'],
    confidence: 'low',
    limitations: ['user-authored fields', 'not independently verified'],
    badgeLabel: 'Self-submitted',
    explains: 'Stated by the profile owner. Not identity verification.',
  },
  accountAuthenticated: {
    signalType: 'account_authenticated',
    provenance: 'magic_link_or_oauth',
    tier: 'self_submitted',
    allowedClaims: ['account_control'],
    excludedClaims: ['identity', 'expertise', 'authorship', 'outcome'],
    confidence: 'high',
    limitations: ['proves control of an account, not legal identity'],
    badgeLabel: 'Account authenticated',
    explains: 'Login proves control of a publication account — not legal identity or expertise.',
  },
  activeDay: {
    signalType: 'active_day',
    provenance: 'collector_daily_aggregate',
    tier: 'collector_observed',
    allowedClaims: ['activity_occurred'],
    excludedClaims: NEVER_FROM_VOLUME,
    confidence: 'high',
    limitations: ['tool activity occurred that day', 'not a measure of output quality'],
    badgeLabel: 'Active day',
    explains: 'Tool activity occurred. Not expertise or productivity.',
  },
} as const satisfies Record<string, EvidenceAuthority>;

export type AuthorityKey = keyof typeof AUTHORITIES;

export function authority(key: AuthorityKey): EvidenceAuthority {
  return AUTHORITIES[key];
}

/** Human-readable evidence tier ladder for methodology pages. */
export const EVIDENCE_TIER_ORDER: EvidenceTier[] = [
  'self_submitted',
  'collector_observed',
  'device_signed',
  'provider_attested',
  'benchmark_assessed',
  'third_party_confirmed',
];

export const EVIDENCE_TIER_LABEL: Record<EvidenceTier, string> = {
  self_submitted: 'Self-submitted',
  collector_observed: 'Collector-observed',
  device_signed: 'Device-signed',
  provider_attested: 'Provider-attested',
  benchmark_assessed: 'Benchmark-assessed',
  third_party_confirmed: 'Third-party confirmed',
};

/**
 * Map browser signature verification state to a precise badge — never a generic
 * "Verified person" or "Verified AI worker".
 */
export function signatureAuthorityLabel(
  state: 'checking' | 'valid' | 'historical' | 'invalid' | 'unsigned' | 'unreachable' | 'revoked_key',
): { label: string; explains: string } {
  switch (state) {
    case 'checking':
      return { label: 'Checking signature…', explains: 'Recomputing the device signature in your browser.' };
    case 'valid':
      return {
        label: AUTHORITIES.deviceSignedSnapshot.badgeLabel,
        explains: AUTHORITIES.deviceSignedSnapshot.explains,
      };
    case 'historical':
      return {
        label: 'Signed by rotated key',
        explains:
          'Integrity holds under a historical device key that was later rotated (not revoked). The record is not erased.',
      };
    case 'invalid':
      return {
        label: 'Invalid signature',
        explains: 'The published bytes do not match the signature. Treat this snapshot as untrusted.',
      };
    case 'unsigned':
      return {
        label: 'Unsigned snapshot',
        explains: 'No device signature is present. Integrity cannot be checked.',
      };
    case 'unreachable':
      return {
        label: 'Snapshot unreachable',
        explains: 'The snapshot URL could not be fetched, so nothing was verified.',
      };
    case 'revoked_key':
      return {
        label: 'Signed by revoked key',
        explains:
          'Cryptographically well-formed, but the signing key was revoked. Historical record may remain; trust interpretation changes.',
      };
    default:
      return { label: 'Unknown signature state', explains: 'Could not classify signature state.' };
  }
}
