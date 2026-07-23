/**
 * Pure normalization + deterministic deduplication for the TOKENS collector.
 *
 * Nothing in this file touches the network, the clock, or the filesystem, so it
 * is fully unit-testable against fixtures. The collector CLI wires these pure
 * functions to real I/O.
 *
 * Design rules (from the dossier's Measurement Integrity + Deduplication sections):
 *  - totalTokens is ALWAYS recomputed as the deterministic sum of the four
 *    provider-reported components. If a source also reports its own total and it
 *    disagrees, we keep the derived total and emit a reconciliation warning.
 *  - Deduplication is deterministic and idempotent: the same input set yields the
 *    same output regardless of order, and re-running never inflates counts.
 */

import type { Provider, TokenMetrics } from './canonical';

export interface NormalizedDaily extends TokenMetrics {
  date: string;
  provider: Provider;
  displayName: string;
  models: string[];
}

export interface NormalizeResult {
  rows: NormalizedDaily[];
  warnings: string[];
}

export const emptyMetrics = (): TokenMetrics => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  cachedTokens: 0,
  freshTokens: 0,
  totalTokens: 0,
  estimatedCostUsd: null,
});

const isObj = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

const hasDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);

export const providerDisplayName = (p: Provider): string =>
  p === 'claude' ? 'Claude Code' : p === 'codex' ? 'Codex' : 'Unknown';

/** Add two metric objects. Cost stays null unless at least one side has an estimate. */
export function addMetrics(a: TokenMetrics, b: TokenMetrics): TokenMetrics {
  const combined: TokenMetrics = {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cachedTokens: 0,
    freshTokens: 0,
    totalTokens: 0,
    estimatedCostUsd:
      a.estimatedCostUsd === null && b.estimatedCostUsd === null
        ? null
        : (a.estimatedCostUsd ?? 0) + (b.estimatedCostUsd ?? 0),
  };
  // Re-derive the sums so an aggregate is always internally consistent.
  combined.cachedTokens = combined.cacheCreationTokens + combined.cacheReadTokens;
  combined.freshTokens = combined.inputTokens + combined.outputTokens;
  combined.totalTokens = combined.freshTokens + combined.cachedTokens;
  return combined;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/[$,]/g, ''));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

/** Extract safe model identifiers. Rejects anything path-like or oddly shaped. */
export function pickModels(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return [
    ...new Set(
      raw
        .map(String)
        .map((item) => item.trim())
        .filter((item) => /^[a-zA-Z0-9._:-]{2,80}$/.test(item))
        .filter((item) => !item.includes('/') && !item.includes('\\')),
    ),
  ].slice(0, 8);
}

/**
 * Normalize a single raw usage record into TokenMetrics.
 *
 * totalTokens is the deterministic sum of the reported components. If the source
 * also reports a total that disagrees, the caller is told via `reportedTotal` so
 * it can emit a reconciliation warning; we still publish the derived total.
 */
export function normalizeMetrics(record: Record<string, unknown>): {
  metrics: TokenMetrics;
  reportedTotal: number | null;
} {
  const inputTokens = pickNumber(record, ['inputTokens', 'input_tokens', 'input', 'tokensInput']);
  const outputTokens = pickNumber(record, ['outputTokens', 'output_tokens', 'output', 'tokensOutput']);
  const cacheCreationTokens = pickNumber(record, [
    'cacheCreationTokens',
    'cache_creation_tokens',
    'cacheWriteTokens',
    'cache_write_tokens',
    'cacheCreateTokens',
  ]);
  const cacheReadTokens = pickNumber(record, [
    'cacheReadTokens',
    'cache_read_tokens',
    'cachedInputTokens',
    'cache_read',
  ]);
  const cachedTokens = cacheCreationTokens + cacheReadTokens;
  const freshTokens = inputTokens + outputTokens;
  const derivedTotal = freshTokens + cachedTokens;

  const rawReportedTotal = pickNumber(record, ['totalTokens', 'total_tokens', 'tokensTotal', 'total']);
  const reportedTotal = rawReportedTotal > 0 ? rawReportedTotal : null;

  const cost = pickNumber(record, [
    'estimatedCostUsd',
    'totalCost',
    'total_cost',
    'cost',
    'costUsd',
    'cost_usd',
  ]);

  return {
    metrics: {
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      cachedTokens,
      freshTokens,
      totalTokens: derivedTotal,
      estimatedCostUsd: cost > 0 ? cost : null,
    },
    reportedTotal,
  };
}

/** Depth-first collection of records that look like dated usage rows. */
export function collectUsageRecords(
  value: unknown,
  out: Record<string, unknown>[] = [],
): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const child of value) collectUsageRecords(child, out);
    return out;
  }
  if (!isObj(value)) return out;
  const date = value.date ?? value.day ?? value.timestamp ?? value.createdAt ?? value.lastActivity;
  const usageShaped = [
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheCreationTokens',
    'totalTokens',
    'totalCost',
    'cachedInputTokens',
  ].some((key) => key in value);
  if (hasDate(date) && usageShaped) out.push(value);
  for (const child of Object.values(value)) collectUsageRecords(child, out);
  return out;
}

/** Stable dedup key for a daily aggregate. Never derived from user/account identity. */
export const dailyDedupeKey = (date: string, provider: Provider): string => `${date}:${provider}`;

/**
 * Normalize raw ccusage-style JSON for a known provider into daily rows.
 * Deterministic and idempotent.
 */
export function normalizeProviderJson(json: unknown, provider: Provider): NormalizeResult {
  const warnings: string[] = [];
  const byKey = new Map<string, NormalizedDaily>();

  for (const record of collectUsageRecords(json)) {
    const rawDate =
      record.date ?? record.day ?? record.timestamp ?? record.createdAt ?? record.lastActivity;
    if (!hasDate(rawDate)) continue;
    const date = rawDate.slice(0, 10);

    // Respect an explicit provider on the record if present and known.
    const recordProvider =
      typeof record.provider === 'string' && (record.provider === 'claude' || record.provider === 'codex')
        ? (record.provider as Provider)
        : provider;
    if (recordProvider !== 'claude' && recordProvider !== 'codex') continue;

    const { metrics, reportedTotal } = normalizeMetrics(record);
    if (metrics.totalTokens <= 0) continue;

    if (reportedTotal !== null && reportedTotal !== metrics.totalTokens) {
      warnings.push(
        `reported-total-mismatch:${date}:${recordProvider}:reported=${reportedTotal}:derived=${metrics.totalTokens}`,
      );
    }

    const key = dailyDedupeKey(date, recordProvider);
    const models = pickModels(record.models ?? record.modelsUsed ?? record.model ?? record.modelName);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        date,
        provider: recordProvider,
        displayName: providerDisplayName(recordProvider),
        models,
        ...metrics,
      });
      continue;
    }

    // Duplicate key within one source: this must NOT sum (that would inflate).
    // Deterministically keep the row with the larger derived total and warn.
    warnings.push(`duplicate-daily-row:${key}`);
    if (metrics.totalTokens > existing.totalTokens) {
      byKey.set(key, {
        date,
        provider: recordProvider,
        displayName: providerDisplayName(recordProvider),
        models: [...new Set([...existing.models, ...models])].slice(0, 8),
        ...metrics,
      });
    } else {
      existing.models = [...new Set([...existing.models, ...models])].slice(0, 8);
    }
  }

  const rows = [...byKey.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.provider.localeCompare(b.provider),
  );
  return { rows, warnings };
}

/**
 * Merge daily rows from multiple providers into one deduplicated, sorted list.
 * Rows from different providers on the same date are DISTINCT rows (not summed).
 * Rows sharing (date, provider) are reconciled by dedup (idempotent).
 */
export function mergeDailyRows(rowSets: NormalizedDaily[][]): NormalizeResult {
  const warnings: string[] = [];
  const byKey = new Map<string, NormalizedDaily>();
  for (const set of rowSets) {
    for (const row of set) {
      const key = dailyDedupeKey(row.date, row.provider);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, row);
        continue;
      }
      warnings.push(`duplicate-daily-row:${key}`);
      if (row.totalTokens > existing.totalTokens) byKey.set(key, row);
    }
  }
  const rows = [...byKey.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.provider.localeCompare(b.provider),
  );
  return { rows, warnings };
}

/** Roll daily rows up into per-provider summaries (frozen contract shape). */
export interface ProviderSummary extends TokenMetrics {
  provider: Provider;
  displayName: string;
  models: string[];
}

export function summarizeProviders(rows: NormalizedDaily[]): Record<string, ProviderSummary> {
  const providers: Record<string, ProviderSummary> = {};
  for (const row of rows) {
    const current: ProviderSummary =
      providers[row.provider] ?? {
        provider: row.provider,
        displayName: row.displayName,
        models: [],
        ...emptyMetrics(),
      };
    const merged = addMetrics(current, row);
    providers[row.provider] = {
      provider: row.provider,
      displayName: row.displayName,
      models: [...new Set([...current.models, ...row.models])].slice(0, 10),
      ...merged,
    };
  }
  return providers;
}

/** Sum per-provider summaries into all-agents totals. */
export function totalsFromProviders(providers: Record<string, ProviderSummary>): TokenMetrics {
  let totals = emptyMetrics();
  for (const summary of Object.values(providers)) totals = addMetrics(totals, summary);
  return totals;
}
