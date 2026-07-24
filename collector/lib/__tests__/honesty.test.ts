/**
 * Honesty gates.
 *
 * A full-dossier audit found 14 places where this repo's own docs and published
 * data claimed more than the code delivered — on a product whose entire thesis is
 * honest measurement. These tests make the worst of those regressions fail CI
 * instead of shipping.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildProfile, deriveVerification, deriveWorkEvidence, type ProfileIdentity } from '../profile';
import type { NormalizedDaily, ProviderSummary } from '../normalize';

const REPO = path.join(__dirname, '..', '..', '..');

const identity: ProfileIdentity = { displayName: 'Test', headline: 'Test' };
const daily: NormalizedDaily[] = [
  {
    date: '2026-07-01',
    provider: 'claude',
    displayName: 'Claude Code',
    models: ['claude-opus-4-8'],
    inputTokens: 10,
    outputTokens: 20,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    cachedTokens: 0,
    freshTokens: 30,
    totalTokens: 30,
    estimatedCostUsd: null,
  } as NormalizedDaily,
];
const providers: Record<string, ProviderSummary> = {};

describe('open-source claims must be backed by an actual license', () => {
  const hasLicense =
    existsSync(path.join(REPO, 'LICENSE')) ||
    existsSync(path.join(REPO, 'LICENSE.md')) ||
    Boolean((JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8')) as { license?: string }).license);

  it('no verification basis string claims "open source" unless a LICENSE exists', () => {
    const categories = deriveVerification(
      buildProfile(identity, daily, providers, '2026-07-01', [], {}).activity,
    );
    const claims = categories.filter((c) => /open[- ]source/i.test(c.basis));
    if (!hasLicense) {
      expect(
        claims,
        'Published data must not advertise an "open source" collector while the repo has no LICENSE ' +
          'and no package.json license field. Either add a license or drop the claim.',
      ).toEqual([]);
    }
  });
});

describe('work evidence cannot overstate itself', () => {
  it('outcomes are always self_reported — never verified by the collector', () => {
    const work = deriveWorkEvidence(
      { outcomes: [{ title: 'Shipped a thing', description: 'x', metric: '100%' }] },
      [],
    );
    expect(work.outcomes.every((o) => o.verification === 'self_reported')).toBe(true);
  });

  it('a collector_observed badge requires the collector to have actually found the project', () => {
    // Config claims a link to a project the scanner did NOT find.
    const work = deriveWorkEvidence(
      { artifacts: [{ type: 'repository', title: 'Ghost', linkedProject: 'NotScanned', url: 'https://example.com' }] },
      [{ name: 'SomethingElse', found: true }],
    );
    expect(work.artifacts[0].verification).not.toBe('collector_observed');
    expect(work.collectorObserved).toBe(0);
  });

  it('a project present in the allowlist but NOT found locally does not earn the badge', () => {
    const work = deriveWorkEvidence(
      { artifacts: [{ type: 'research', title: 'LOLM', linkedProject: 'LOLM' }] },
      [{ name: 'LOLM', found: false }],
    );
    expect(work.artifacts[0].verification).toBe('self_reported');
  });
});

describe('unverifiable categories stay pending', () => {
  it('identity and outcome verification are never claimed as verified', () => {
    const categories = deriveVerification(
      buildProfile(identity, daily, providers, '2026-07-01', [], {}).activity,
    );
    const identityCat = categories.find((c) => c.label === 'Identity verified');
    const outcomeCat = categories.find((c) => c.label === 'Outcome verified');
    expect(identityCat?.status).toBe('pending');
    expect(outcomeCat?.status).toBe('pending');
  });
});
