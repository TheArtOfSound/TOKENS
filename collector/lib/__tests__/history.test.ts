import { describe, expect, it } from 'vitest';
import { buildCompactHistory } from '../history';
import { mergeDailyRows, normalizeProviderJson } from '../normalize';
import claudeSample from '../../fixtures/ccusage-claude-daily.sample.json';
import codexSample from '../../fixtures/ccusage-codex-daily.sample.json';

function mergedRows() {
  const claude = normalizeProviderJson(claudeSample, 'claude').rows;
  const codex = normalizeProviderJson(codexSample, 'codex').rows;
  return mergeDailyRows([claude, codex]).rows;
}

describe('buildCompactHistory', () => {
  it('emits one compact point per (date, provider), sorted and derived', () => {
    const history = buildCompactHistory(mergedRows(), '2026-07-23T12:00:00.000Z');
    expect(history.kind).toBe('compact_daily_series');
    expect(history.pointCount).toBe(3);
    expect(history.updatedThrough).toBe('2026-04-12');
    // sorted by date then provider
    expect(history.points.map((p) => `${p.date}:${p.provider}`)).toEqual([
      '2026-04-11:claude',
      '2026-04-11:codex',
      '2026-04-12:claude',
    ]);
    // carries derived splits, not raw content
    expect(history.points[0]).toHaveProperty('freshTokens');
    expect(history.points[0]).toHaveProperty('cachedTokens');
  });

  it('is deterministic and small (idempotent rebuild)', () => {
    const a = buildCompactHistory(mergedRows(), '2026-07-23T12:00:00.000Z');
    const b = buildCompactHistory(mergedRows(), '2026-07-23T12:00:00.000Z');
    expect(a).toEqual(b);
    expect(Buffer.byteLength(JSON.stringify(a))).toBeLessThan(4096);
  });
});
