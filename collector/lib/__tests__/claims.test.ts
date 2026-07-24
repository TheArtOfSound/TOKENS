/**
 * Claim-authority invariants. These are the guardrails that keep the product
 * honest: no signal may over-claim, and there is no universal score.
 */
import { describe, expect, it } from 'vitest';
import { buildClaimAuthority, validateClaimAuthority, UNIVERSAL_NON_CLAIMS, CLAIM_LADDER } from '../claims';

describe('claim authority', () => {
  it('passes its own invariant checks', () => {
    expect(validateClaimAuthority()).toEqual([]);
  });

  it('never publishes a universal or combined score', () => {
    expect(buildClaimAuthority().noUniversalScore).toBe(true);
  });

  it('states the no-inheritance rule', () => {
    expect(buildClaimAuthority().combinedAuthorityRule).toMatch(/never inherits more authority/i);
  });

  it('no signal claims to establish identity, authorship, quality, causation, or business impact', () => {
    for (const signal of CLAIM_LADDER) {
      for (const nonClaim of UNIVERSAL_NON_CLAIMS) {
        expect(
          signal.establishes.map((e) => e.toLowerCase()),
          `${signal.id} must not establish "${nonClaim}"`,
        ).not.toContain(nonClaim.toLowerCase());
      }
    }
  });

  it('every signal explicitly disclaims identity (except the account-control proof, which links accounts not legal identity)', () => {
    for (const signal of CLAIM_LADDER) {
      const disclaims = signal.doesNotEstablish.map((s) => s.toLowerCase());
      if (signal.id === 'identity-proof') {
        expect(disclaims.some((d) => d.includes('legal identity'))).toBe(true);
      } else {
        expect(disclaims).toContain('identity');
      }
    }
  });

  it('every signal has provenance, an allowed claim, and confidence', () => {
    for (const signal of CLAIM_LADDER) {
      expect(signal.provenance.length).toBeGreaterThan(0);
      expect(signal.allowedClaim.length).toBeGreaterThan(0);
      expect(signal.confidence).toBeTruthy();
    }
  });

  it('flags an injected violation (the check actually works)', () => {
    const bad = buildClaimAuthority();
    bad.signals = [{ ...bad.signals[0], establishes: ['expertise'] }];
    expect(validateClaimAuthority(bad).length).toBeGreaterThan(0);
  });
});
