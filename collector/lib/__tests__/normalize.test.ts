import { describe, expect, it } from 'vitest';
import {
  addMetrics,
  dailyDedupeKey,
  emptyMetrics,
  mergeDailyRows,
  normalizeMetrics,
  normalizeProviderJson,
  pickModels,
  summarizeProviders,
  totalsFromProviders,
} from '../normalize';
import claudeSample from '../../fixtures/ccusage-claude-daily.sample.json';
import codexSample from '../../fixtures/ccusage-codex-daily.sample.json';
import claudeMalformed from '../../fixtures/ccusage-claude-daily.malformed.json';

describe('normalizeMetrics', () => {
  it('derives totalTokens as the deterministic sum of reported components', () => {
    const { metrics, reportedTotal } = normalizeMetrics({
      inputTokens: 393,
      outputTokens: 199455,
      cacheCreationTokens: 2875716,
      cacheReadTokens: 94382683,
      totalTokens: 97458247,
    });
    expect(metrics.freshTokens).toBe(199848);
    expect(metrics.cachedTokens).toBe(97258399);
    expect(metrics.totalTokens).toBe(97458247);
    expect(reportedTotal).toBe(97458247);
  });

  it('keeps the derived total and reports a mismatch when the source total disagrees', () => {
    const { metrics, reportedTotal } = normalizeMetrics({
      inputTokens: 100,
      outputTokens: 200,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 999999,
    });
    expect(metrics.totalTokens).toBe(300);
    expect(reportedTotal).toBe(999999);
  });

  it('returns null cost (never a fabricated 0) when no estimate is present', () => {
    const { metrics } = normalizeMetrics({ inputTokens: 10, outputTokens: 20 });
    expect(metrics.estimatedCostUsd).toBeNull();
  });
});

describe('pickModels', () => {
  it('keeps safe model identifiers and rejects path-shaped values', () => {
    expect(pickModels(['claude-opus-4-8', '/Users/bry/evil', 'gpt-5-codex', 'a\\b'])).toEqual([
      'claude-opus-4-8',
      'gpt-5-codex',
    ]);
  });
});

describe('normalizeProviderJson', () => {
  it('normalizes a real-shaped ccusage claude payload', () => {
    const { rows, warnings } = normalizeProviderJson(claudeSample, 'claude');
    expect(rows).toHaveLength(2);
    expect(warnings).toHaveLength(0);
    expect(rows[0].date).toBe('2026-04-11');
    expect(rows[0].provider).toBe('claude');
    expect(rows[0].totalTokens).toBe(97458247);
    expect(rows[0].models).toContain('claude-opus-4-6');
  });

  it('does not inflate on duplicate (date, provider) and warns instead of summing', () => {
    const { rows, warnings } = normalizeProviderJson(claudeMalformed, 'claude');
    const may1 = rows.find((r) => r.date === '2026-05-01');
    expect(may1?.totalTokens).toBe(300); // kept the larger derived total, NOT 300+100
    expect(warnings.some((w) => w.startsWith('duplicate-daily-row:'))).toBe(true);
    expect(warnings.some((w) => w.startsWith('reported-total-mismatch:2026-05-01:claude'))).toBe(true);
    // path-shaped model was rejected during normalization
    expect(may1?.models).toEqual(['claude-opus-4-8']);
    // zero-token and undated rows dropped
    expect(rows.map((r) => r.date).sort()).toEqual(['2026-05-01', '2026-05-03']);
  });

  it('is idempotent: normalizing twice yields identical output', () => {
    const a = normalizeProviderJson(claudeSample, 'claude');
    const b = normalizeProviderJson(claudeSample, 'claude');
    expect(a).toEqual(b);
  });
});

describe('mergeDailyRows / summaries', () => {
  it('treats same-date different-provider rows as distinct and never merges across providers', () => {
    const claude = normalizeProviderJson(claudeSample, 'claude').rows;
    const codex = normalizeProviderJson(codexSample, 'codex').rows;
    const merged = mergeDailyRows([claude, codex]);
    expect(merged.rows).toHaveLength(3);
    expect(merged.warnings).toHaveLength(0);
    const keys = merged.rows.map((r) => dailyDedupeKey(r.date, r.provider));
    expect(keys).toContain('2026-04-11:claude');
    expect(keys).toContain('2026-04-11:codex');
  });

  it('provider and grand totals equal the source ccusage totals (semantic equivalence)', () => {
    const claude = normalizeProviderJson(claudeSample, 'claude').rows;
    const codex = normalizeProviderJson(codexSample, 'codex').rows;
    const providers = summarizeProviders(mergeDailyRows([claude, codex]).rows);
    expect(providers.claude.totalTokens).toBe(claudeSample.totals.totalTokens);
    expect(providers.codex.totalTokens).toBe(codexSample.totals.totalTokens);
    const totals = totalsFromProviders(providers);
    expect(totals.totalTokens).toBe(
      claudeSample.totals.totalTokens + codexSample.totals.totalTokens,
    );
  });
});

describe('addMetrics', () => {
  it('re-derives internal sums and keeps cost null only when both sides are null', () => {
    const a = { ...emptyMetrics(), inputTokens: 5, outputTokens: 5, totalTokens: 10, freshTokens: 10 };
    const b = { ...emptyMetrics(), cacheReadTokens: 100, cachedTokens: 100, totalTokens: 100, estimatedCostUsd: 1.5 };
    const sum = addMetrics(a, b);
    expect(sum.totalTokens).toBe(110);
    expect(sum.cachedTokens).toBe(100);
    expect(sum.freshTokens).toBe(10);
    expect(sum.estimatedCostUsd).toBe(1.5);
  });
});
