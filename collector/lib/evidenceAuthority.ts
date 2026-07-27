/**
 * Claim-bounded evidence authority for published snapshots.
 *
 * signal → provenance → allowedClaims → excludedClaims → confidence → limitations
 *
 * Emitted as `claimAuthority` on every published snapshot so browsers and
 * third parties can hold each badge to an explicit claim boundary — never a
 * generic "Verified" endorsement.
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

export interface ClaimAuthoritySignal {
  signalType: string;
  provenance: string;
  tier: EvidenceTier;
  allowedClaims: ClaimKey[];
  excludedClaims: ClaimKey[];
  confidence: Confidence;
  limitations: string[];
  badgeLabel: string;
  /** Whether this signal is present in this particular snapshot. */
  present: boolean;
  explains: string;
}

export interface ClaimAuthorityBlock {
  model: 'signal → provenance → allowed claim → confidence → limitations';
  combinedAuthorityRule: string;
  universalNonClaims: ClaimKey[];
  tierOrder: EvidenceTier[];
  signals: ClaimAuthoritySignal[];
  note: string;
}

const NEVER_FROM_ACTIVITY: ClaimKey[] = [
  'identity',
  'authorship',
  'expertise',
  'quality',
  'productivity',
  'permission',
  'outcome',
  'compensation_fit',
];

export const UNIVERSAL_NON_CLAIMS: ClaimKey[] = [
  'identity',
  'authorship',
  'permission',
  'expertise',
  'quality',
  'outcome',
];

export const TIER_ORDER: EvidenceTier[] = [
  'self_submitted',
  'collector_observed',
  'device_signed',
  'provider_attested',
  'benchmark_assessed',
  'third_party_confirmed',
];

export interface ClaimAuthorityContext {
  hasActivity: boolean;
  hasTokenTotals: boolean;
  hasSignature: boolean;
  hasCollectorObservedWork: boolean;
  hasLinkProvidedWork: boolean;
  hasSelfReportedOutcomes: boolean;
  hasSelfSubmittedIdentity: boolean;
  hasIdentityProofs: boolean;
}

/**
 * Build the claimAuthority block for a published snapshot.
 * Only allowlisted, fixed strings — no free-form user content.
 */
export function buildClaimAuthority(ctx: ClaimAuthorityContext): ClaimAuthorityBlock {
  const signals: ClaimAuthoritySignal[] = [
    {
      signalType: 'collector_observed_activity',
      provenance: 'local_provider_usage_record',
      tier: 'collector_observed',
      allowedClaims: ['activity_occurred'],
      excludedClaims: [...NEVER_FROM_ACTIVITY],
      confidence: 'high',
      limitations: ['locally controlled source', 'does not establish work quality'],
      badgeLabel: 'Collector-observed activity',
      present: ctx.hasActivity,
      explains: 'A compatible local usage record was observed. Not expertise or productivity.',
    },
    {
      signalType: 'provider_reported_token_counts',
      provenance: 'local_claude_or_codex_accounting',
      tier: 'provider_attested',
      allowedClaims: ['activity_occurred'],
      excludedClaims: [...NEVER_FROM_ACTIVITY],
      confidence: 'medium',
      limitations: ['provider accounting, not an invoice', 'locally controlled source files'],
      badgeLabel: 'Provider-reported usage',
      present: ctx.hasTokenTotals,
      explains: 'Token counts come from provider usage accounting — evidence of activity, not skill.',
    },
    {
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
        'activity_occurred',
      ],
      confidence: 'high',
      limitations: [
        'does not prove source logs were honest or unmodified',
        'does not prove legal identity of the key holder',
      ],
      badgeLabel: 'Device-signed activity record',
      present: ctx.hasSignature,
      explains:
        'Signature confirms integrity and signing key. It does not independently prove identity, authorship, skill, source honesty, permission, or outcomes.',
    },
    {
      signalType: 'collector_observed_work_artifact',
      provenance: 'local_allowlisted_project_scan',
      tier: 'collector_observed',
      allowedClaims: ['activity_occurred'],
      excludedClaims: [...NEVER_FROM_ACTIVITY, 'authorship'],
      confidence: 'medium',
      limitations: ['local presence of a linked project', 'not sole authorship'],
      badgeLabel: 'Collector-observed work',
      present: ctx.hasCollectorObservedWork,
      explains: 'Local collector found a linked project. Not identity, quality, or sole authorship.',
    },
    {
      signalType: 'link_provided_work',
      provenance: 'member_supplied_https_url',
      tier: 'self_submitted',
      allowedClaims: [],
      excludedClaims: [...NEVER_FROM_ACTIVITY, 'authorship'],
      confidence: 'low',
      limitations: ['URL provided by member', 'not independently verified'],
      badgeLabel: 'Link provided',
      present: ctx.hasLinkProvidedWork,
      explains: 'Public link provided by the member. Not independently verified.',
    },
    {
      signalType: 'self_reported_outcome',
      provenance: 'profile_work_json',
      tier: 'self_submitted',
      allowedClaims: [],
      excludedClaims: [...UNIVERSAL_NON_CLAIMS],
      confidence: 'low',
      limitations: ['requires third-party confirmation to upgrade'],
      badgeLabel: 'Self-reported outcome',
      present: ctx.hasSelfReportedOutcomes,
      explains: 'Stated by the member. Outcome verification requires third-party confirmation.',
    },
    {
      signalType: 'self_submitted_identity',
      provenance: 'profile_json',
      tier: 'self_submitted',
      allowedClaims: [],
      excludedClaims: ['identity', 'authorship', 'expertise', 'outcome'],
      confidence: 'low',
      limitations: ['user-authored fields', 'not independently verified'],
      badgeLabel: 'Self-submitted identity',
      present: ctx.hasSelfSubmittedIdentity,
      explains: 'Display name and bio are self-submitted. Not identity verification.',
    },
    {
      signalType: 'external_account_proof',
      provenance: 'browser_checked_github_gist',
      tier: 'self_submitted',
      allowedClaims: ['account_control'],
      excludedClaims: ['identity', 'expertise', 'authorship', 'outcome'],
      confidence: 'high',
      limitations: ['proves control of a linked account, not legal identity'],
      badgeLabel: 'Account control (linked)',
      present: ctx.hasIdentityProofs,
      explains: 'Browser-checked control of a linked account. Not legal identity.',
    },
    {
      signalType: 'benchmark_assessed',
      provenance: 'defined_task_conditions',
      tier: 'benchmark_assessed',
      allowedClaims: [],
      excludedClaims: [...UNIVERSAL_NON_CLAIMS, 'expertise'],
      confidence: 'medium',
      limitations: ['bounded to the defined task only'],
      badgeLabel: 'Benchmark-assessed',
      present: false,
      explains: 'Not present in this snapshot. When present, only claims performance on that defined task.',
    },
    {
      signalType: 'third_party_confirmed_outcome',
      provenance: 'named_party_confirmation',
      tier: 'third_party_confirmed',
      allowedClaims: ['outcome'],
      excludedClaims: ['identity', 'expertise', 'authorship'],
      confidence: 'medium',
      limitations: ['does not prove independent causation'],
      badgeLabel: 'Third-party confirmed',
      present: false,
      explains: 'Not present in this snapshot. When present, a named party confirmed an outcome — not causation or identity.',
    },
  ];

  return {
    model: 'signal → provenance → allowed claim → confidence → limitations',
    combinedAuthorityRule:
      'A combined figure never inherits more authority than its weakest supporting evidence. No universal skill, quality, or employability score is published.',
    universalNonClaims: [...UNIVERSAL_NON_CLAIMS],
    tierOrder: [...TIER_ORDER],
    signals,
    note:
      'Token volume is evidence of activity, not expertise, productivity, efficiency, or professional value. ' +
      'A valid device signature proves integrity of published bytes and key possession — not source honesty or legal identity.',
  };
}
