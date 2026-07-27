import { describe, expect, it } from 'vitest';
import {
  AUTHORITIES,
  EVIDENCE_TIER_ORDER,
  authority,
  signatureAuthorityLabel,
} from '../evidenceAuthority';

describe('evidence authority ladder', () => {
  it('never lets device signature claim identity or source honesty', () => {
    const a = authority('deviceSignedSnapshot');
    expect(a.allowedClaims).toContain('snapshot_integrity');
    expect(a.allowedClaims).toContain('device_key_possession');
    expect(a.excludedClaims).toEqual(
      expect.arrayContaining(['identity', 'authorship', 'expertise', 'outcome', 'activity_occurred']),
    );
    expect(a.badgeLabel).toMatch(/device-signed/i);
    expect(a.badgeLabel).not.toMatch(/^verified$/i);
  });

  it('never lets token/activity volume claim expertise', () => {
    const a = authority('providerReportedTokens');
    expect(a.allowedClaims).toEqual(['activity_occurred']);
    expect(a.excludedClaims).toEqual(
      expect.arrayContaining(['expertise', 'quality', 'productivity', 'outcome']),
    );
  });

  it('keeps account login separate from legal identity', () => {
    const a = AUTHORITIES.accountAuthenticated;
    expect(a.allowedClaims).toEqual(['account_control']);
    expect(a.excludedClaims).toContain('identity');
  });

  it('maps signature states to precise badges, not Verified person', () => {
    expect(signatureAuthorityLabel('valid').label).toMatch(/device-signed/i);
    expect(signatureAuthorityLabel('valid').explains).toMatch(/does not independently prove identity/i);
    expect(signatureAuthorityLabel('invalid').label).toMatch(/invalid/i);
    expect(signatureAuthorityLabel('revoked_key').label).toMatch(/revoked/i);
    for (const tier of EVIDENCE_TIER_ORDER) {
      expect(typeof tier).toBe('string');
    }
  });
});
