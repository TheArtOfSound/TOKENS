import { describe, expect, it } from 'vitest';
import {
  CCUSAGE_AGENTS,
  LOCAL_ADAPTER_PROVIDERS,
  isValidProviderSlug,
  providerDisplayName,
  sanitizeProvider,
} from '../providers';
import { normalizeProviderJson, emptyMetrics } from '../normalize';
import { publishSnapshot, type DraftSnapshot } from '../publish';
import { assembleDraft } from '../snapshot';

describe('provider slugs', () => {
  it('accepts known multi-provider ids including grok and kimi', () => {
    for (const id of ['claude', 'codex', 'grok', 'kimi', 'gemini', 'copilot', 'opencode']) {
      expect(isValidProviderSlug(id)).toBe(true);
      expect(sanitizeProvider(id)).toBe(id);
    }
  });

  it('rejects path-shaped or empty labels', () => {
    expect(sanitizeProvider('/etc/passwd')).toBeNull();
    expect(sanitizeProvider('')).toBeNull();
    expect(sanitizeProvider('../x')).toBeNull();
  });

  it('humanizes display names', () => {
    expect(providerDisplayName('grok')).toBe('Grok');
    expect(providerDisplayName('kimi')).toBe('Kimi');
    expect(providerDisplayName('claude')).toBe('Claude Code');
  });

  it('lists ccusage agents including kimi and gemini', () => {
    expect(CCUSAGE_AGENTS).toContain('kimi');
    expect(CCUSAGE_AGENTS).toContain('gemini');
    expect(CCUSAGE_AGENTS).toContain('claude');
  });

  it('registers local adapters for claude, codex, grok, and kimi', () => {
    expect(LOCAL_ADAPTER_PROVIDERS).toEqual(
      expect.arrayContaining(['claude', 'codex', 'grok', 'kimi']),
    );
  });
});

describe('assembleDraft multi-provider merge', () => {
  it('merges ccusage providers that are missing from the event ledger', () => {
    const { daily, draft } = assembleDraft({
      sources: [
        {
          provider: 'kimi',
          json: {
            daily: [
              {
                date: '2026-08-01',
                inputTokens: 20,
                outputTokens: 10,
                cacheCreationTokens: 0,
                cacheReadTokens: 0,
                totalTokens: 30,
                modelsUsed: ['kimi-k2'],
              },
            ],
          },
        },
        {
          provider: 'gemini',
          json: {
            daily: [
              {
                date: '2026-08-01',
                inputTokens: 5,
                outputTokens: 5,
                cacheCreationTokens: 0,
                cacheReadTokens: 0,
                totalTokens: 10,
              },
            ],
          },
        },
        // Claude also in ccusage — must NOT double-count when ledger has claude
        {
          provider: 'claude',
          json: {
            daily: [
              {
                date: '2026-08-01',
                inputTokens: 9999,
                outputTokens: 9999,
                cacheCreationTokens: 0,
                cacheReadTokens: 0,
                totalTokens: 19998,
              },
            ],
          },
        },
      ],
      preNormalizedRows: [
        {
          date: '2026-08-01',
          provider: 'claude',
          displayName: 'Claude Code',
          models: ['claude-opus'],
          ...emptyMetrics(),
          inputTokens: 100,
          outputTokens: 50,
          freshTokens: 150,
          totalTokens: 150,
        },
        {
          date: '2026-08-01',
          provider: 'grok',
          displayName: 'Grok',
          models: ['grok-4.5'],
          ...emptyMetrics(),
          inputTokens: 80,
          outputTokens: 40,
          freshTokens: 120,
          totalTokens: 120,
        },
      ],
      generatedAt: '2026-08-06T00:00:00.000Z',
      timezone: 'UTC',
      qiraProjects: [],
      scanner: {
        rootsChecked: 0,
        allowlistedProjects: 0,
        foundProjects: 0,
        privacyMode: 'allowlist_no_paths',
      },
      gitCommit: null,
    });

    const providers = new Set(daily.map((d) => d.provider));
    expect(providers.has('claude')).toBe(true);
    expect(providers.has('grok')).toBe(true);
    expect(providers.has('kimi')).toBe(true);
    expect(providers.has('gemini')).toBe(true);
    // Ledger claude wins — not the inflated ccusage row
    const claude = daily.find((d) => d.provider === 'claude')!;
    expect(claude.totalTokens).toBe(150);
    expect(draft.totals.totalTokens).toBe(150 + 120 + 30 + 10);
  });
});

describe('normalize multi-provider ccusage payloads', () => {
  it('normalizes kimi daily rows', () => {
    const json = {
      daily: [
        {
          date: '2026-08-01',
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationTokens: 0,
          cacheReadTokens: 10,
          totalTokens: 160,
          modelsUsed: ['kimi-k2'],
        },
      ],
    };
    const { rows } = normalizeProviderJson(json, 'kimi');
    expect(rows).toHaveLength(1);
    expect(rows[0].provider).toBe('kimi');
    expect(rows[0].displayName).toBe('Kimi');
    expect(rows[0].totalTokens).toBe(160);
  });

  it('normalizes period-keyed all-agent rows when provider is assigned', () => {
    const json = {
      daily: [
        {
          period: '2026-08-02',
          agent: 'all',
          inputTokens: 10,
          outputTokens: 5,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          totalTokens: 15,
        },
      ],
    };
    // agent "all" is ignored; caller-assigned provider wins
    const { rows } = normalizeProviderJson(json, 'gemini');
    expect(rows).toHaveLength(1);
    expect(rows[0].provider).toBe('gemini');
    expect(rows[0].date).toBe('2026-08-02');
  });
});

describe('publish accepts multi-provider drafts', () => {
  it('keeps grok and kimi in providers and daily', () => {
    const draft: DraftSnapshot = {
      generatedAt: '2026-08-06T00:00:00.000Z',
      timezone: 'UTC',
      source: 'local_mac_sanitized_ccusage',
      isSampleData: false,
      totals: { ...emptyMetrics(), inputTokens: 100, outputTokens: 50, freshTokens: 150, totalTokens: 150 },
      providers: {
        grok: {
          provider: 'grok',
          displayName: 'Grok',
          models: ['grok-4.5'],
          ...emptyMetrics(),
          inputTokens: 80,
          outputTokens: 40,
          freshTokens: 120,
          totalTokens: 120,
        },
        kimi: {
          provider: 'kimi',
          displayName: 'Kimi',
          models: ['kimi-k2'],
          ...emptyMetrics(),
          inputTokens: 20,
          outputTokens: 10,
          freshTokens: 30,
          totalTokens: 30,
        },
      },
      daily: [
        {
          date: '2026-08-01',
          provider: 'grok',
          displayName: 'Grok',
          models: ['grok-4.5'],
          ...emptyMetrics(),
          inputTokens: 80,
          outputTokens: 40,
          freshTokens: 120,
          totalTokens: 120,
        },
        {
          date: '2026-08-01',
          provider: 'kimi',
          displayName: 'Kimi',
          models: ['kimi-k2'],
          ...emptyMetrics(),
          inputTokens: 20,
          outputTokens: 10,
          freshTokens: 30,
          totalTokens: 30,
        },
      ],
      qiraProjects: [],
      scanner: {
        rootsChecked: 0,
        allowlistedProjects: 0,
        foundProjects: 0,
        privacyMode: 'allowlist_no_paths',
      },
      warnings: [],
      gitCommit: null,
      eligibleForAggregateSync: true,
      providerConfidence: {
        grok: { confidence: 'high', note: 'test' },
        kimi: { confidence: 'medium', note: 'test' },
      },
    };

    const { published } = publishSnapshot(draft);
    expect(Object.keys(published.providers).sort()).toEqual(['grok', 'kimi']);
    expect(published.daily.map((d) => d.provider).sort()).toEqual(['grok', 'kimi']);
    expect(published.providerConfidence.grok?.confidence).toBe('high');
  });
});
