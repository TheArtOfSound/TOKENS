/**
 * Claim-authority ladder.
 *
 * The logical floor every piece of evidence must pass through:
 *
 *     signal → provenance → allowed claim → confidence → limitations
 *
 * Each signal establishes ONLY a specific, narrow claim. None of them —
 * individually or combined — automatically establish identity, authorship,
 * permission, expertise, quality, causation, or business impact. And the load-
 * bearing invariant:
 *
 *     A combined figure never inherits more authority than its weakest
 *     supporting evidence. TOKENS therefore publishes NO universal or combined
 *     skill / quality / employability score.
 *
 * This file is the single source of truth. The collector publishes it as
 * data/claim-authority.json; the site renders it; a test enforces the
 * invariants so the boundaries can't quietly erode.
 */

export type ClaimStatus = 'built' | 'roadmap';
export type ClaimConfidence = 'high' | 'medium' | 'low' | 'conditional' | 'none';

export interface ClaimSignal {
  id: string;
  /** The observable thing. */
  signal: string;
  /** Where it comes from and how it is attested. */
  provenance: string;
  /** The one claim this signal is allowed to support. */
  allowedClaim: string;
  confidence: ClaimConfidence;
  /** Specific, narrow things this signal can establish. */
  establishes: string[];
  /** Things this signal does NOT establish (superset of the universal list). */
  doesNotEstablish: string[];
  status: ClaimStatus;
}

/** None of these are ever established automatically by any signal or combination. */
export const UNIVERSAL_NON_CLAIMS = [
  'identity',
  'authorship',
  'permission',
  'expertise',
  'quality',
  'causation',
  'business impact',
] as const;

const withUniversal = (extra: string[] = []): string[] => [...UNIVERSAL_NON_CLAIMS, ...extra];

export const CLAIM_LADDER: ClaimSignal[] = [
  {
    id: 'active-day',
    signal: 'Active AI-work day',
    provenance: 'Collector-derived from provider-reported usage in local logs.',
    allowedClaim: 'AI-assisted activity occurred on a given calendar day.',
    confidence: 'high',
    establishes: ['That AI tooling was used on that day'],
    doesNotEstablish: withUniversal(['hours worked', 'effort', 'output value']),
    status: 'built',
  },
  {
    id: 'token-volume',
    signal: 'Token volume',
    provenance: "Provider-reported usage accounting, deduplicated at the event level.",
    allowedClaim: 'A quantity of model usage was accounted for.',
    confidence: 'high',
    establishes: ['How much model usage occurred'],
    doesNotEstablish: withUniversal(['skill', 'productivity', 'effort', 'that more is better']),
    status: 'built',
  },
  {
    id: 'signed-snapshot',
    signal: 'Signed snapshot',
    provenance: 'Ed25519 signature by a device key, verifiable in the browser.',
    allowedClaim: 'This record was produced by a specific device key and has not been altered since.',
    confidence: 'high',
    establishes: ['Record integrity', 'That one key produced it'],
    doesNotEstablish: withUniversal(['who holds the key', 'that the source logs were genuine']),
    status: 'built',
  },
  {
    id: 'collector-observed-repo',
    signal: 'Collector-observed repository',
    provenance: 'Local filesystem/git scan on the member’s own machine.',
    allowedClaim: 'A project is present and active on the member’s machine.',
    confidence: 'medium',
    establishes: ['Local presence of a project', 'Recent local git/file activity'],
    doesNotEstablish: withUniversal(['ownership', 'that the linked URL is that project']),
    status: 'built',
  },
  {
    id: 'identity-proof',
    signal: 'Identity proof (account control)',
    provenance:
      'A statement signed by the device key, published by the member under an external account (e.g. a public GitHub gist), fetched and verified in the browser.',
    allowedClaim: 'The holder of this signing key also controls the named external account.',
    confidence: 'medium',
    establishes: ['Control of the linked account is tied to the signing key'],
    doesNotEstablish: [
      'legal identity',
      'that the external account itself is genuine or belongs to a real named person',
      'authorship',
      'expertise',
      'quality',
      'permission',
    ],
    status: 'built',
  },
  {
    id: 'merged-pull-request',
    signal: 'Merged pull request',
    provenance: 'Imported from a version-control host (planned adapter).',
    allowedClaim: 'A change authored under an identity landed in a repository.',
    confidence: 'medium',
    establishes: ['That a change was merged'],
    doesNotEstablish: withUniversal(['code quality', 'that it stayed', 'impact']),
    status: 'roadmap',
  },
  {
    id: 'post-merge-durability',
    signal: 'Post-merge durability',
    provenance: 'Version-control history tracked over time (planned; see DURABILITY_SPEC.md).',
    allowedClaim: 'A landed change survived N days without revert, rewrite, or hotfix.',
    confidence: 'medium',
    establishes: ['That a change persisted for a measured window', 'Absence of corrective rework in that window'],
    doesNotEstablish: withUniversal(['that the author is skilled', 'that stability was caused by the change']),
    status: 'roadmap',
  },
  {
    id: 'passing-benchmark',
    signal: 'Passing benchmark',
    provenance: 'A defined assessment run under stated conditions (planned).',
    allowedClaim: 'A performance level was achieved on a specific benchmark under stated conditions.',
    confidence: 'conditional',
    establishes: ['Performance on that benchmark, on that date'],
    doesNotEstablish: withUniversal(['general expertise', 'performance outside the benchmark']),
    status: 'roadmap',
  },
  {
    id: 'third-party-confirmation',
    signal: 'Third-party confirmation',
    provenance: 'An attestation from a named external party (planned).',
    allowedClaim: 'A named party confirmed a specific claimed outcome.',
    confidence: 'conditional',
    establishes: ['That a specific outcome was confirmed by that party'],
    doesNotEstablish: withUniversal(['generalizable skill', 'that AI caused the outcome']),
    status: 'roadmap',
  },
  {
    id: 'self-submitted',
    signal: 'Self-submitted claim',
    provenance: 'Entered by the member. Not verified.',
    allowedClaim: 'The member asserts this.',
    confidence: 'none',
    establishes: ['That the member made the claim'],
    doesNotEstablish: withUniversal(['that the claim is true']),
    status: 'built',
  },
];

export interface ClaimAuthority {
  model: string;
  noUniversalScore: true;
  combinedAuthorityRule: string;
  universalNonClaims: string[];
  signals: ClaimSignal[];
  note: string;
}

export function buildClaimAuthority(): ClaimAuthority {
  return {
    model: 'signal → provenance → allowed claim → confidence → limitations',
    noUniversalScore: true,
    combinedAuthorityRule:
      'A combined figure never inherits more authority than its weakest supporting evidence. TOKENS publishes no universal or combined skill, quality, or employability score.',
    universalNonClaims: [...UNIVERSAL_NON_CLAIMS],
    signals: CLAIM_LADDER,
    note:
      'Read a profile bottom-up: each badge maps to a signal here, and the badge can support only that signal’s allowed claim at its stated confidence. Combining badges does not raise their authority.',
  };
}

/** Returns a list of invariant violations. Empty means the ladder is sound. */
export function validateClaimAuthority(authority: ClaimAuthority = buildClaimAuthority()): string[] {
  const problems: string[] = [];
  if (authority.noUniversalScore !== true) problems.push('noUniversalScore must be true');
  if (!/never inherits more authority/i.test(authority.combinedAuthorityRule)) {
    problems.push('combinedAuthorityRule must state the no-inheritance invariant');
  }
  const universal = new Set(UNIVERSAL_NON_CLAIMS.map((s) => s.toLowerCase()));
  for (const signal of authority.signals) {
    // No signal may claim to establish any universal non-claim.
    for (const established of signal.establishes) {
      if (universal.has(established.toLowerCase())) {
        problems.push(`${signal.id} claims to establish a universal non-claim: ${established}`);
      }
    }
    // Every signal must explicitly disclaim identity (the most abused inference).
    if (signal.id !== 'identity-proof' && !signal.doesNotEstablish.map((s) => s.toLowerCase()).includes('identity')) {
      problems.push(`${signal.id} must explicitly not establish identity`);
    }
    if (!signal.allowedClaim || !signal.provenance) problems.push(`${signal.id} missing provenance/allowedClaim`);
  }
  return problems;
}
