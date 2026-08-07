/**
 * Consent enforcement tests.
 *
 * "Explicit, revocable consent" is a page-1 dossier principle, so a toggle that
 * merely *looks* respected is worse than none. These assert that a withheld
 * field is genuinely absent from the payload — not blanked, not zeroed — and
 * that the withholding is declared honestly.
 */
import { describe, expect, it } from 'vitest';
import { publishSnapshot, type DraftSnapshot } from '../publish';
import { FIELD_LABELS, SOURCE_DISCLOSURES, disabledFields, disabledSources, type ConsentConfig } from '../consent';
import type { NormalizedDaily, ProviderSummary } from '../normalize';

function consentWith(overrides: Partial<ConsentConfig['fields']>, sources: Partial<ConsentConfig['sources']> = {}): ConsentConfig {
  return {
    version: 1,
    createdBy: 'user',
    sources: {
      claude: true,
      codex: true,
      kimi: true,
      gemini: true,
      grok: true,
      opencode: true,
      amp: true,
      droid: true,
      codebuff: true,
      hermes: true,
      pi: true,
      goose: true,
      kilo: true,
      copilot: true,
      qwen: true,
      openclaw: true,
      projectScan: true,
      ...sources,
    },
    fields: {
      totals: true, providers: true, daily: true, estimatedCost: true, models: true,
      qiraProjects: true, profileIdentity: true, profileActivity: true, profileWork: true,
      ...overrides,
    },
    updatedAt: '2026-07-23T00:00:00.000Z',
  };
}

const metrics = {
  inputTokens: 10, outputTokens: 20, cacheCreationTokens: 0, cacheReadTokens: 0,
  cachedTokens: 0, freshTokens: 30, totalTokens: 30, estimatedCostUsd: 1.25,
};

function draft(consent?: ConsentConfig): DraftSnapshot {
  const row = { date: '2026-07-01', provider: 'claude', displayName: 'Claude Code', models: ['claude-opus-4-8'], ...metrics } as NormalizedDaily;
  const provider = { provider: 'claude', displayName: 'Claude Code', models: ['claude-opus-4-8'], ...metrics } as ProviderSummary;
  return {
    generatedAt: '2026-07-23T00:00:00.000Z',
    timezone: 'America/Phoenix',
    source: 'local_mac_sanitized_ccusage',
    isSampleData: false,
    totals: { ...metrics },
    providers: { claude: provider },
    daily: [row],
    qiraProjects: [{ name: 'TOKENS', category: 'x', status: 'y', description: 'z', found: true, stack: [], scripts: [], fileCounts: {}, lastModified: null, scannerWarnings: [] }],
    scanner: { rootsChecked: 1, allowlistedProjects: 1, foundProjects: 1, privacyMode: 'allowlist_no_paths' },
    warnings: [],
    gitCommit: null,
    eligibleForAggregateSync: false,
    consent,
  };
}

describe('per-field publication toggles', () => {
  it('removes estimated cost everywhere when withheld', () => {
    const { published } = publishSnapshot(draft(consentWith({ estimatedCost: false })));
    expect(published.totals.estimatedCostUsd).toBeNull();
    expect(published.providers.claude.estimatedCostUsd).toBeNull();
    expect(published.daily.every((row) => row.estimatedCostUsd === null)).toBe(true);
  });

  it('removes model names when withheld', () => {
    const { published } = publishSnapshot(draft(consentWith({ models: false })));
    expect(published.providers.claude.models).toEqual([]);
    expect(published.daily.every((row) => row.models.length === 0)).toBe(true);
  });

  it('drops the project matrix entirely when withheld', () => {
    const { published } = publishSnapshot(draft(consentWith({ qiraProjects: false })));
    expect(published.qiraProjects).toEqual([]);
    expect(published.privacy.fieldsPublished).not.toContain('qiraProjects');
  });

  it('drops the daily series entirely when withheld', () => {
    const { published } = publishSnapshot(draft(consentWith({ daily: false })));
    expect(published.daily).toEqual([]);
    expect(published.privacy.fieldsPublished).not.toContain('daily');
  });

  it('declares what was withheld without revealing the values', () => {
    const { published } = publishSnapshot(draft(consentWith({ estimatedCost: false, models: false }, { codex: false })));
    expect(published.privacy.fieldsWithheld).toEqual(expect.arrayContaining(['estimatedCost', 'models']));
    expect(published.privacy.sourcesDisabled).toContain('codex');
    // The withheld cost value must not survive anywhere in the payload.
    expect(JSON.stringify(published)).not.toContain('1.25');
  });

  it('publishes everything and withholds nothing when consent is full', () => {
    const { published } = publishSnapshot(draft(consentWith({})));
    expect(published.privacy.fieldsWithheld).toEqual([]);
    expect(published.privacy.sourcesDisabled).toEqual([]);
    expect(published.totals.estimatedCostUsd).toBe(1.25);
  });
});

describe('disclosure completeness', () => {
  it('every source discloses what it reads, extracts, and discards', () => {
    for (const source of SOURCE_DISCLOSURES) {
      expect(source.reads.length).toBeGreaterThan(0);
      expect(source.directories.length).toBeGreaterThan(0);
      expect(source.extracts.length).toBeGreaterThan(0);
      expect(source.discards.length).toBeGreaterThan(0);
      expect(source.evidenceClass).toBeTruthy();
    }
  });

  it('every toggleable field has a human-readable label', () => {
    const config = consentWith({});
    for (const key of Object.keys(config.fields)) {
      expect(FIELD_LABELS[key as keyof typeof FIELD_LABELS]).toBeTruthy();
    }
  });

  it('reports disabled fields and sources', () => {
    const config = consentWith({ models: false }, { projectScan: false });
    expect(disabledFields(config)).toEqual(['models']);
    expect(disabledSources(config)).toEqual(['projectScan']);
  });
});
