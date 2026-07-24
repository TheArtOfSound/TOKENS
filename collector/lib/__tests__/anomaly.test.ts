/**
 * Integrity-check tests. The checks flag, they never accuse — so the assertions
 * are about detecting statistical tells, not about judging anyone.
 */
import { describe, expect, it } from 'vitest';
import { detectAnomalies } from '../anomaly';
import type { NormalizedDaily } from '../normalize';

function row(date: string, tokens: number, provider: 'claude' | 'codex' = 'claude', models: string[] = ['claude-opus-4-8']): NormalizedDaily {
  return {
    date, provider, displayName: 'Claude Code', models,
    inputTokens: tokens, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
    cachedTokens: 0, freshTokens: tokens, totalTokens: tokens, estimatedCostUsd: null,
  };
}

describe('detectAnomalies', () => {
  it('passes clean data with zero flags', () => {
    const report = detectAnomalies([row('2026-07-20', 1000), row('2026-07-21', 2000)], '2026-07-24');
    expect(report.flags).toBe(0);
    expect(report.checks.every((c) => c.status === 'ok')).toBe(true);
  });

  it('flags future-dated activity', () => {
    const report = detectAnomalies([row('2026-08-01', 1000)], '2026-07-24');
    expect(report.checks.find((c) => c.name.includes('future'))?.status).toBe('flag');
    expect(report.flags).toBeGreaterThan(0);
  });

  it('flags an implausible single-day volume', () => {
    const report = detectAnomalies([row('2026-07-20', 60_000_000_000)], '2026-07-24');
    expect(report.checks.find((c) => c.name.includes('Plausible'))?.status).toBe('flag');
  });

  it('flags duplicate (date, provider) rows', () => {
    const report = detectAnomalies([row('2026-07-20', 10), row('2026-07-20', 20)], '2026-07-24');
    expect(report.checks.find((c) => c.name.includes('duplicate'))?.status).toBe('flag');
  });

  it('flags an unrecognized model family', () => {
    const report = detectAnomalies([row('2026-07-20', 10, 'claude', ['totally-made-up-model'])], '2026-07-24');
    expect(report.checks.find((c) => c.name.includes('model'))?.status).toBe('flag');
  });

  it('accepts known model families across providers', () => {
    const report = detectAnomalies([row('2026-07-20', 10, 'codex', ['gpt-5.3-codex', 'gemini-2.5'])], '2026-07-24');
    expect(report.checks.find((c) => c.name.includes('model'))?.status).toBe('ok');
  });

  it('flags a large retroactive backfill vs. the previous snapshot', () => {
    const prev = [row('2026-07-20', 10)];
    const now = [row('2026-07-20', 10), ...Array.from({ length: 8 }, (_, i) => row(`2026-06-0${i + 1}`, 100))];
    const report = detectAnomalies(now, '2026-07-24', prev);
    expect(report.checks.find((c) => c.name.includes('backfill'))?.status).toBe('flag');
  });

  it('never uses accusatory language', () => {
    const report = detectAnomalies([row('2026-08-01', 60_000_000_000)], '2026-07-24');
    expect(report.note.toLowerCase()).not.toMatch(/fraud|fake|cheat|liar/);
    expect(report.note.toLowerCase()).toContain('not an accusation');
  });
});
