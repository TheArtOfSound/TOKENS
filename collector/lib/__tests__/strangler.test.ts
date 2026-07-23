import { describe, expect, it } from 'vitest';
import { assembleDraft } from '../snapshot';
import { computeContentHash, publishSnapshot } from '../publish';
import { scanForProhibited } from '../secretScan';
import claudeSample from '../../fixtures/ccusage-claude-daily.sample.json';
import codexSample from '../../fixtures/ccusage-codex-daily.sample.json';

function run(generatedAt: string) {
  const { draft } = assembleDraft({
    sources: [
      { provider: 'claude', json: claudeSample },
      { provider: 'codex', json: codexSample },
    ],
    generatedAt,
    timezone: 'America/Phoenix',
    qiraProjects: [],
    scanner: { rootsChecked: 5, allowlistedProjects: 8, foundProjects: 0, privacyMode: 'allowlist_no_paths' },
    gitCommit: null,
  });
  return publishSnapshot(draft).published;
}

describe('strangler pipeline (ccusage -> canonical -> published)', () => {
  it('preserves semantic equivalence with the source ccusage totals', () => {
    const published = run('2026-07-23T12:00:00.000Z');
    // Grand total equals the sum of the two providers' own reported totals.
    expect(published.totals.totalTokens).toBe(
      claudeSample.totals.totalTokens + codexSample.totals.totalTokens,
    );
    // The published grand total also equals the sum of the daily rows.
    const dailySum = published.daily.reduce((sum, row) => sum + row.totalTokens, 0);
    expect(published.totals.totalTokens).toBe(dailySum);
  });

  it('produces a clean, allowlisted, schema-shaped snapshot with the frozen contract fields', () => {
    const published = run('2026-07-23T12:00:00.000Z');
    // Frozen contract fields the deployed frontend depends on:
    for (const key of ['totals', 'providers', 'daily', 'scanner', 'warnings', 'verification']) {
      expect(published).toHaveProperty(key);
    }
    expect(scanForProhibited(published)).toEqual([]);
  });

  it('is idempotent at the content level across runs (only the timestamp changes)', () => {
    const a = run('2026-07-23T12:00:00.000Z');
    const b = run('2026-07-23T18:45:00.000Z');
    expect(computeContentHash(a)).toBe(computeContentHash(b));
  });
});
