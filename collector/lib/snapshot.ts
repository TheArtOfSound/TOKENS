/**
 * Pure snapshot assembly for the TOKENS collector.
 *
 * Takes already-fetched raw ccusage JSON per provider (plus the local project
 * scan result and a clock value) and assembles a DraftSnapshot. No I/O, so it is
 * fully testable. The collector CLI does the ccusage + filesystem I/O and hands
 * the results here.
 */

import {
  mergeDailyRows,
  normalizeProviderJson,
  summarizeProviders,
  totalsFromProviders,
  type NormalizedDaily,
} from './normalize';
import type { DraftSnapshot } from './publish';
import type { Provider } from './canonical';

export interface RawSource {
  /** Any agent slug (claude, codex, kimi, gemini, grok, …). */
  provider: Provider;
  /** Parsed JSON from `ccusage <provider> daily --json`, or null if it failed. */
  json: unknown;
  /** A warning to record if this source failed to produce data. */
  failureWarning?: string;
}

export interface AssembleInput {
  sources: RawSource[];
  generatedAt: string;
  timezone: string;
  qiraProjects: unknown[];
  scanner: {
    rootsChecked: number;
    allowlistedProjects: number;
    foundProjects: number;
    privacyMode: 'allowlist_no_paths';
  };
  gitCommit: string | null;
  eligibleForAggregateSync?: boolean;
  extraWarnings?: string[];
  /**
   * Daily rows sourced from the event ledger. When present these REPLACE the
   * ccusage sources entirely; ccusage is then only a cross-check.
   */
  preNormalizedRows?: NormalizedDaily[];
}

export interface AssembleResult {
  draft: DraftSnapshot;
  daily: NormalizedDaily[];
  warnings: string[];
}

export function assembleDraft(input: AssembleInput): AssembleResult {
  const warnings: string[] = [...(input.extraWarnings ?? [])];
  const rowSets: NormalizedDaily[][] = [];

  // Preferred path: rows already normalized from the event ledger. The ledger is
  // event-level and deduplicated, so no provider JSON parsing is needed.
  if (input.preNormalizedRows?.length) rowSets.push(input.preNormalizedRows);

  for (const source of input.preNormalizedRows?.length ? [] : input.sources) {
    if (source.json == null) {
      if (source.failureWarning) warnings.push(source.failureWarning);
      continue;
    }
    const { rows, warnings: sourceWarnings } = normalizeProviderJson(source.json, source.provider);
    if (!rows.length && !sourceWarnings.length) {
      warnings.push(`ccusage ${source.provider} daily returned JSON but no recognized token records`);
    }
    warnings.push(...sourceWarnings);
    rowSets.push(rows);
  }

  const merged = mergeDailyRows(rowSets);
  warnings.push(...merged.warnings);

  const providers = summarizeProviders(merged.rows);
  const totals = totalsFromProviders(providers);

  const draft: DraftSnapshot = {
    generatedAt: input.generatedAt,
    timezone: input.timezone,
    source: 'local_mac_sanitized_ccusage',
    isSampleData: false,
    totals,
    providers,
    daily: merged.rows,
    qiraProjects: input.qiraProjects,
    scanner: input.scanner,
    warnings: dedupeWarnings(warnings),
    gitCommit: input.gitCommit,
    eligibleForAggregateSync: input.eligibleForAggregateSync ?? true,
  };

  return { draft, daily: merged.rows, warnings: draft.warnings };
}

/** De-duplicate warning strings while preserving order; cap the published count. */
function dedupeWarnings(warnings: string[], max = 12): string[] {
  return [...new Set(warnings)].slice(0, max);
}
