import { describe, expect, it } from 'vitest';
import { renderAgentEvidenceMarkdown } from '../agentEvidenceMd';
import type { PublishedSnapshot } from '../publish';

function minimalSnapshot(): PublishedSnapshot {
  return {
    generatedAt: '2026-07-28T00:00:00.000Z',
    timezone: 'America/Phoenix',
    source: 'local_mac_sanitized_ccusage',
    collectorVersion: '0.4.0',
    isSampleData: false,
    totals: {
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationTokens: 0,
      cacheReadTokens: 100,
      cachedTokens: 100,
      freshTokens: 15,
      totalTokens: 115,
      estimatedCostUsd: null,
    },
    providers: {},
    daily: [],
    qiraProjects: [
      {
        name: 'TOKENS',
        category: 'product',
        status: 'active',
        description: 'Ledger collector',
        found: true,
        stack: [],
        scripts: [],
        fileCounts: {},
        lastModified: null,
        scannerWarnings: [],
      },
    ],
    scanner: {
      rootsChecked: 1,
      allowlistedProjects: 1,
      foundProjects: 1,
      privacyMode: 'allowlist_no_paths',
    },
    warnings: [],
    measurement: {
      classes: {},
      exactTotalTokens: 115,
      estimatedOnly: { costUsd: null, costMicroUsd: null },
      note: 'test',
    },
    privacy: {
      rawContentPersisted: false,
      allowlistPublication: true,
      eligibleForAggregateSync: false,
      fieldsPublished: ['totals', 'profile'],
      fieldsWithheld: [],
      sourcesDisabled: [],
    },
    profile: {
      identity: {
        displayName: 'Test User',
        headline: 'Builder',
        pronouns: null,
        location: 'Earth',
        bio: 'Builds agents.',
        availability: null,
        workCategories: ['Agent tooling'],
        openTo: [],
        links: [{ label: 'GitHub', url: 'https://github.com/example' }],
        identityProofs: [],
        avatarUrl: null,
        contact: null,
      },
      activity: {
        referenceDate: '2026-07-28',
        activeDays: 12,
        firstActiveDate: '2026-07-01',
        lastActiveDate: '2026-07-28',
        spanDays: 28,
        activeDaysLast30: 12,
        activeDaysLast90: 12,
        currentStreakDays: 3,
        longestStreakDays: 5,
        toolsUsed: ['Claude Code'],
        modelsUsed: ['claude-opus-4-6'],
        projectsActive: 1,
      },
      work: {
        artifacts: [
          {
            type: 'repository',
            title: 'example/repo',
            description: 'A repo',
            url: 'https://github.com/example/repo',
            period: '2026',
            linkedProject: 'TOKENS',
            verification: 'collector_observed',
            basis: 'found locally',
          },
        ],
        outcomes: [],
        collectorObserved: 1,
        totalArtifacts: 1,
        totalOutcomes: 0,
      },
      opportunity: {
        engagementTypes: [],
        compensation: null,
        typicalProjectSize: null,
        workArrangement: null,
        timezone: null,
        responseTime: null,
        computeCostRange: 'Low compute via cache',
        note: 'prefs',
      },
      efficiency: {
        cachedSharePct: 90,
        freshSharePct: 10,
        outputSharePct: 20,
        avgTokensPerActiveDay: 10,
        note: 'efficiency note',
      },
      practice: {
        tokenEfficiencyArchitecture: ['Cache-first reuse'],
        contextInjectionSystems: ['CLAUDE.md'],
        problemFocus: ['Evidence systems'],
        leveragePatterns: ['Multi-tool loops'],
        operatingCostNote: 'Keep cost low',
        valueDeliveredNote: 'Ship signed evidence',
        verification: 'self_reported',
        note: 'self-declared',
      },
      verification: [],
      note: 'profile note',
    },
    sourceOfTruth: 'event_ledger',
    providerConfidence: {},
    verification: {
      schemaVersion: '2.0.0',
      canonicalSchemaVersion: '2.0.0',
      snapshotSha256: 'a'.repeat(64),
      rawLogsPublished: false,
      gitCommit: null,
      proves: 'integrity only',
    },
    claimAuthority: {
      model: 'signal → provenance → allowed claim → confidence → limitations',
      combinedAuthorityRule: 'min authority',
      universalNonClaims: ['expertise'],
      tierOrder: ['device_signed'],
      signals: [
        {
          signalType: 'device_signed_snapshot',
          provenance: 'device',
          tier: 'device_signed',
          allowedClaims: ['snapshot_integrity'],
          excludedClaims: ['expertise'],
          confidence: 'high',
          limitations: ['not identity'],
          badgeLabel: 'Device-signed',
          present: true,
          explains: 'bytes intact',
        },
      ],
      note: 'claim note',
    },
    telemetry: {
      measurementClass: 'collector_derived',
      confidence: 'medium',
      totalEvents: 3,
      hierarchy: [
        {
          provider: 'claude',
          events: 3,
          sessions: 1,
          totalTokens: 100,
          models: [{ model: 'claude-opus-4-6', events: 3, sessions: 1, totalTokens: 100 }],
        },
      ],
      sessions: {
        distinctSessions: 1,
        eventsWithoutSession: 0,
        medianEventsPerSession: 3,
        p95EventsPerSession: 3,
        maxEventsPerSession: 3,
        medianInterEventSeconds: 12,
      },
      note: 'telemetry note',
      limitations: ['no tool trees yet'],
      doesNotEstablish: ['expertise'],
    },
  };
}

describe('AI-evaluable evidence markdown', () => {
  it('includes practice, projects, telemetry, and claim boundaries', () => {
    const md = renderAgentEvidenceMarkdown(minimalSnapshot(), {
      profileUrl: 'https://ledger.imagineqira.com/u/bryan',
    });
    expect(md).toContain('# Agent work evidence dossier');
    expect(md).toContain('Test User');
    expect(md).toContain('Cache-first reuse');
    expect(md).toContain('CLAUDE.md');
    expect(md).toContain('Evidence systems');
    expect(md).toContain('example/repo');
    expect(md).toContain('collector_observed');
    expect(md).toContain('Agent operation telemetry');
    expect(md).toContain('claude-opus-4-6');
    expect(md).toContain('no universal AI score');
    expect(md).toContain('Device-signed');
    expect(md).not.toMatch(/sk-[a-zA-Z0-9]{10,}/);
  });
});
