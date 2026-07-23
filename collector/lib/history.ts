/**
 * Compact daily history for the TOKENS collector.
 *
 * The previous design appended a FULL snapshot (totals + providers + daily +
 * qiraProjects + verification) to history.json on every run and kept the last
 * 500. That produced a 28 MB file, rewritten in full every 30 minutes, that the
 * frontend never even loads — pure git and deploy bloat.
 *
 * This replaces it with a compact, DERIVED per-day time series. It is computed
 * deterministically from the daily rows, so the same data always yields the same
 * file (idempotent), it is a few KB instead of tens of MB, and it is actually
 * useful to a trend chart.
 */

import { CANONICAL_SCHEMA_VERSION, type Provider } from './canonical';
import type { NormalizedDaily } from './normalize';

export interface HistoryPoint {
  date: string;
  provider: Provider;
  totalTokens: number;
  freshTokens: number;
  cachedTokens: number;
  estimatedCostUsd: number | null;
}

export interface CompactHistory {
  schemaVersion: string;
  kind: 'compact_daily_series';
  generatedAt: string;
  updatedThrough: string | null;
  pointCount: number;
  points: HistoryPoint[];
  note: string;
}

const NOTE =
  'Derived per-day token series (one point per date+provider). Replaces the former ' +
  'append-every-run full-snapshot history to eliminate multi-megabyte bloat. Rebuilt ' +
  'deterministically from daily data on each run.';

/** Build the compact history deterministically from daily rows. */
export function buildCompactHistory(daily: NormalizedDaily[], generatedAt: string): CompactHistory {
  const points: HistoryPoint[] = daily
    .map((row) => ({
      date: row.date,
      provider: row.provider,
      totalTokens: row.totalTokens,
      freshTokens: row.freshTokens,
      cachedTokens: row.cachedTokens,
      estimatedCostUsd: row.estimatedCostUsd,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.provider.localeCompare(b.provider));

  const updatedThrough = points.length ? points[points.length - 1].date : null;

  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    kind: 'compact_daily_series',
    generatedAt,
    updatedThrough,
    pointCount: points.length,
    points,
    note: NOTE,
  };
}
