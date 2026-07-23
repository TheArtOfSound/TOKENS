import { describe, expect, it } from 'vitest';
import { computeContentHash, publishSnapshot, verifySnapshotHash, type DraftSnapshot } from '../publish';
import { scanForProhibited } from '../secretScan';
import { emptyMetrics } from '../normalize';
import { assembleDraft } from '../snapshot';
import claudeSample from '../../fixtures/ccusage-claude-daily.sample.json';
import codexSample from '../../fixtures/ccusage-codex-daily.sample.json';

function baseDraft(overrides: Partial<DraftSnapshot> = {}): DraftSnapshot {
  return {
    generatedAt: '2026-07-23T12:00:00.000Z',
    timezone: 'America/Phoenix',
    source: 'local_mac_sanitized_ccusage',
    isSampleData: false,
    totals: emptyMetrics(),
    providers: {},
    daily: [],
    qiraProjects: [],
    scanner: { rootsChecked: 5, allowlistedProjects: 8, foundProjects: 0, privacyMode: 'allowlist_no_paths' },
    warnings: [],
    gitCommit: null,
    eligibleForAggregateSync: true,
    ...overrides,
  };
}

function realDraft(): DraftSnapshot {
  return assembleDraft({
    sources: [
      { provider: 'claude', json: claudeSample },
      { provider: 'codex', json: codexSample },
    ],
    generatedAt: '2026-07-23T12:00:00.000Z',
    timezone: 'America/Phoenix',
    qiraProjects: [],
    scanner: { rootsChecked: 5, allowlistedProjects: 8, foundProjects: 0, privacyMode: 'allowlist_no_paths' },
    gitCommit: null,
  }).draft;
}

describe('publishSnapshot — measurement & privacy blocks', () => {
  it('produces the measurement provenance block with correct exact total and separated estimate', () => {
    const { published } = publishSnapshot(realDraft());
    expect(published.measurement.classes.inputTokens.measurementClass).toBe('provider_reported');
    expect(published.measurement.classes.totalTokens.measurementClass).toBe('collector_derived');
    expect(published.measurement.classes.estimatedCostUsd.measurementClass).toBe('tokenizer_estimated');
    expect(published.measurement.exactTotalTokens).toBe(published.totals.totalTokens);
    // Cost is kept OUT of the exact token total and lives only under estimatedOnly.
    expect(published.measurement.estimatedOnly.costUsd).toBeCloseTo(90.648, 3);
  });

  it('publishes the privacy guarantees', () => {
    const { published } = publishSnapshot(realDraft());
    expect(published.privacy.rawContentPersisted).toBe(false);
    expect(published.privacy.allowlistPublication).toBe(true);
    expect(published.verification.rawLogsPublished).toBe(false);
  });

  it('computes a self-consistent snapshot hash', () => {
    const { published } = publishSnapshot(realDraft());
    expect(verifySnapshotHash(published)).toBe(true);
  });
});

describe('publishSnapshot — allowlist construction (the core privacy guarantee)', () => {
  it('drops unknown fields: they cannot pass through the transform', () => {
    const draft = baseDraft({
      qiraProjects: [
        {
          name: 'Evil',
          category: 'Research',
          status: 'active',
          description: 'ok',
          found: true,
          stack: [],
          scripts: ['build', 'test'],
          fileCounts: {},
          lastModified: null,
          scannerWarnings: [],
          // unknown / prohibited extras that MUST NOT appear in output:
          rawPrompt: 'delete production database',
          absolutePath: '/Users/bry/Projects/secret',
        },
      ],
    });
    const { published } = publishSnapshot(draft as unknown as DraftSnapshot);
    const serialized = JSON.stringify(published);
    expect(serialized).not.toContain('rawPrompt');
    expect(serialized).not.toContain('absolutePath');
    expect(serialized).not.toContain('/Users/bry');
    expect(published.qiraProjects[0].scripts).toEqual(['build', 'test']);
  });

  it('drops individual free-form values that trip the secret scanner', () => {
    const draft = baseDraft({
      qiraProjects: [
        {
          name: 'ProjectX',
          category: 'Product',
          status: 'shipping',
          description: 'contact alice@example.com for access',
          found: true,
          git: { branch: '/Users/bry/secret-branch', commit: 'abc123', changedFiles: 3 },
          stack: ['React'],
          scripts: ['build', '/Users/bry/leak.sh'],
          fileCounts: { ts: 10 },
          lastModified: null,
          scannerWarnings: [],
        },
      ],
      warnings: ['reported-total-mismatch:2026-05-01:claude', '/Users/bry/oops-a-path'],
    });
    const { published, dropped } = publishSnapshot(draft as unknown as DraftSnapshot);
    const project = published.qiraProjects[0];
    expect(project.git?.branch).toBeNull(); // unsafe branch dropped
    expect(project.git?.commit).toBe('abc123'); // safe value kept
    expect(project.scripts).toEqual(['build']); // leaking script dropped
    expect(project.description).toBe(''); // email-bearing description dropped to empty
    expect(published.warnings).toEqual(['reported-total-mismatch:2026-05-01:claude']);
    expect(dropped.length).toBeGreaterThan(0);
  });

  it('GUARANTEE: no prohibited pattern survives into the published object', () => {
    const draft = baseDraft({
      qiraProjects: [
        {
          name: 'Poison',
          category: 'X',
          status: 'y',
          description: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345',
          found: true,
          git: { branch: 'C:\\Users\\bryan\\keys', commit: 'ghp_1234567890abcdef1234567890abcdef1234', changedFiles: 0 },
          stack: ['/home/deploy/.ssh/id_rsa'],
          scripts: ['ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx'],
          fileCounts: {},
          lastModified: null,
          scannerWarnings: ['/Users/bry/nope'],
        },
      ],
      warnings: ['AKIAIOSFODNN7EXAMPLE'],
    });
    const { published } = publishSnapshot(draft as unknown as DraftSnapshot);
    expect(scanForProhibited(published)).toEqual([]);
  });

  it('coerces fabricated/negative/NaN metric values to safe numbers, preserves null cost', () => {
    const draft = baseDraft({
      totals: {
        inputTokens: Number.NaN,
        outputTokens: -50,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cachedTokens: 0,
        freshTokens: 0,
        totalTokens: Number.POSITIVE_INFINITY,
        estimatedCostUsd: null,
      },
    });
    const { published } = publishSnapshot(draft);
    expect(published.totals.inputTokens).toBe(0);
    expect(published.totals.outputTokens).toBe(0);
    expect(published.totals.totalTokens).toBe(0);
    expect(published.totals.estimatedCostUsd).toBeNull();
  });
});

describe('publishSnapshot — idempotency hash', () => {
  it('content hash ignores generatedAt so unchanged data yields no diff', () => {
    const a = publishSnapshot(baseDraft({ generatedAt: '2026-07-23T12:00:00.000Z' })).published;
    const b = publishSnapshot(baseDraft({ generatedAt: '2026-07-23T19:30:00.000Z' })).published;
    expect(computeContentHash(a)).toBe(computeContentHash(b));
    // ...but the full snapshot hash DOES change because generatedAt changed.
    expect(a.verification.snapshotSha256).not.toBe(b.verification.snapshotSha256);
  });
});
