/**
 * Publish from the event ledger instead of `ccusage`.
 *
 * The ledger is the better source: it is event-level, deduplicated, incremental,
 * and reconciles against the providers' own numbers. `ccusage` remains available
 * as a cross-check and as a fallback when the ledger is empty.
 *
 * Reconciliation measured 2026-07-24 (135,838 events, 136 days):
 *
 *   Claude  ledger 23,875,395,830  vs ccusage 23,885,578,855  = -0.04%
 *                                                              0 of 68 days off by >2%
 *   Codex   ledger  9,916,569,804  vs ccusage  9,297,043,446  = +6.66%
 *                                                             11 of 68 days off by >2%
 *
 * The Codex gap is understood, not a mystery: in ~15% of sessions (35 of 226
 * sampled) Codex re-emits the same turn's `last_token_usage` without its
 * cumulative counter advancing, so summing counts those turns twice. It cannot be
 * gated on the cumulative counter — that counter only advances at turn end while
 * `last_token_usage` updates per sub-call, so gating drops every intra-turn call
 * (measured: -45%). Deriving events from the cumulative delta is likewise worse
 * (-44%). Summing is the most accurate option available today.
 *
 * Because that residual is real and one-directional, Codex rows are published at
 * REDUCED confidence and the uncertainty is stated in the UI rather than hidden.
 */

import { Ledger, type ImportedSource } from './ledger';
import { providerDisplayName } from './normalize';
import type { NormalizedDaily } from './normalize';
import type { Provider } from './canonical';

export interface LedgerSourceResult {
  rows: NormalizedDaily[];
  warnings: string[];
  eventCount: number;
  /** Per-provider confidence, surfaced in the published snapshot. */
  providerConfidence: Record<string, { confidence: 'high' | 'medium'; note: string }>;
  /** Self-imported sources (origin='imported'), kept apart from measured rows. */
  imported: ImportedSource[];
}

const CLAUDE_NOTE =
  'Event-level, deduplicated by provider message id. Reconciles to within 0.05% of ccusage across all measured days.';
const CODEX_NOTE =
  'Event-level. Codex re-emits a turn’s usage without advancing its cumulative counter in roughly 15% of sessions, so totals may overstate by up to ~7%. Treated as approximate.';

export function readLedgerDaily(ledgerFile?: string): LedgerSourceResult {
  const ledger = ledgerFile ? new Ledger(ledgerFile) : new Ledger();
  try {
    ledger.migrate();
    const imported = ledger.importedSources();
    const eventCount = ledger.eventCount('local_log');
    if (eventCount === 0) {
      return {
        rows: [],
        warnings: ['Event ledger has no measured events; run `npm run ingest` to populate it.'],
        eventCount: 0,
        providerConfidence: {},
        imported,
      };
    }

    const modelsByProvider = new Map<string, Set<string>>();
    for (const model of ledger.modelsUsed()) {
      // Model ids are provider-identifiable by prefix; keep this cheap and safe.
      const provider = model.startsWith('gpt') || model.includes('codex') ? 'codex' : 'claude';
      if (!modelsByProvider.has(provider)) modelsByProvider.set(provider, new Set());
      modelsByProvider.get(provider)!.add(model);
    }

    const rows: NormalizedDaily[] = ledger.dailyTotals().map((row) => {
      const provider = (row.provider === 'codex' ? 'codex' : 'claude') as Provider;
      const inputTokens = Number(row.inputTokens) || 0;
      const outputTokens = Number(row.outputTokens) || 0;
      const cacheCreationTokens = Number(row.cacheCreationTokens) || 0;
      const cacheReadTokens = Number(row.cacheReadTokens) || 0;
      return {
        date: row.date,
        provider,
        displayName: providerDisplayName(provider),
        models: [...(modelsByProvider.get(provider) ?? [])].sort().slice(0, 8),
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        cachedTokens: cacheCreationTokens + cacheReadTokens,
        freshTokens: inputTokens + outputTokens,
        totalTokens: Number(row.totalTokens) || 0,
        // Cost is a price-table estimate, not a provider-reported figure. The
        // ledger stores measured tokens only and does not invent a price.
        estimatedCostUsd: null,
      };
    });

    const providers = new Set(rows.map((row) => row.provider));
    const providerConfidence: LedgerSourceResult['providerConfidence'] = {};
    if (providers.has('claude')) providerConfidence.claude = { confidence: 'high', note: CLAUDE_NOTE };
    if (providers.has('codex')) providerConfidence.codex = { confidence: 'medium', note: CODEX_NOTE };

    return {
      rows,
      warnings: providers.has('codex')
        ? ['Codex totals are approximate (~+7% upper bound) due to provider re-emission; see methodology.']
        : [],
      eventCount,
      providerConfidence,
      imported,
    };
  } finally {
    ledger.close();
  }
}
