import { describe, expect, it } from 'vitest';
import { buildClaimAuthority } from '../evidenceAuthority';
import { publishSnapshot, type DraftSnapshot } from '../publish';
import { emptyMetrics } from '../normalize';

describe('buildClaimAuthority', () => {
  it('never allows device signature to claim identity or activity honesty', () => {
    const block = buildClaimAuthority({
      hasActivity: true,
      hasTokenTotals: true,
      hasSignature: true,
      hasCollectorObservedWork: false,
      hasLinkProvidedWork: false,
      hasSelfReportedOutcomes: false,
      hasSelfSubmittedIdentity: true,
      hasIdentityProofs: false,
    });
    expect(block.model).toMatch(/signal → provenance/);
    expect(block.universalNonClaims).toContain('expertise');
    const signed = block.signals.find((s) => s.signalType === 'device_signed_snapshot')!;
    expect(signed.present).toBe(true);
    expect(signed.allowedClaims).toEqual(expect.arrayContaining(['snapshot_integrity', 'device_key_possession']));
    expect(signed.excludedClaims).toEqual(
      expect.arrayContaining(['identity', 'expertise', 'activity_occurred', 'outcome']),
    );
    expect(signed.badgeLabel).not.toMatch(/^verified$/i);
  });

  it('marks volume/activity as activity_occurred only', () => {
    const block = buildClaimAuthority({
      hasActivity: true,
      hasTokenTotals: true,
      hasSignature: false,
      hasCollectorObservedWork: false,
      hasLinkProvidedWork: false,
      hasSelfReportedOutcomes: false,
      hasSelfSubmittedIdentity: false,
      hasIdentityProofs: false,
    });
    const tokens = block.signals.find((s) => s.signalType === 'provider_reported_token_counts')!;
    expect(tokens.allowedClaims).toEqual(['activity_occurred']);
    expect(tokens.excludedClaims).toContain('expertise');
  });
});

describe('publishSnapshot emits claimAuthority', () => {
  it('includes claimAuthority on every published snapshot', () => {
    const draft: DraftSnapshot = {
      generatedAt: '2026-07-23T12:00:00.000Z',
      timezone: 'UTC',
      source: 'sample',
      isSampleData: true,
      totals: { ...emptyMetrics(), totalTokens: 100, inputTokens: 40, outputTokens: 60, freshTokens: 100 },
      providers: {},
      daily: [],
      qiraProjects: [],
      scanner: { rootsChecked: 0, allowlistedProjects: 0, foundProjects: 0, privacyMode: 'allowlist_no_paths' },
      warnings: [],
      gitCommit: null,
      eligibleForAggregateSync: false,
    };
    const { published } = publishSnapshot(draft);
    expect(published.claimAuthority).toBeDefined();
    expect(published.claimAuthority.signals.length).toBeGreaterThan(5);
    expect(published.privacy.fieldsPublished).toContain('claimAuthority');
    const device = published.claimAuthority.signals.find((s) => s.signalType === 'device_signed_snapshot');
    expect(device?.present).toBe(true);
    // Device signature must not claim source honesty via allowed claims.
    expect(device?.excludedClaims).toContain('identity');
  });
});
