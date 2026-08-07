/**
 * Publish from the event ledger instead of `ccusage`.
 *
 * The ledger is the better source: it is event-level, deduplicated, incremental,
 * and reconciles against the providers' own numbers. `ccusage` remains available
 * as a cross-check and as a fallback when the ledger is empty.
 *
 * Multi-provider: daily rows keep the provider column from ingested events
 * (claude, codex, grok, kimi, …). Models are attached by best-effort guess when
 * the ledger only exposes model ids without a join.
 */

import { Ledger, type ImportedSource } from './ledger';
import { providerDisplayName } from './normalize';
import type { NormalizedDaily } from './normalize';
import type { Provider } from './canonical';
import { defaultProviderConfidence, sanitizeProvider } from './providers';

export interface LedgerSourceResult {
  rows: NormalizedDaily[];
  warnings: string[];
  eventCount: number;
  /** Per-provider confidence, surfaced in the published snapshot. */
  providerConfidence: Record<string, { confidence: 'high' | 'medium'; note: string }>;
  /** Self-imported sources (origin='imported'), kept apart from measured rows. */
  imported: ImportedSource[];
}

function guessProviderForModel(model: string): Provider {
  const m = model.toLowerCase();
  if (m.includes('codex') || m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) {
    return 'codex';
  }
  if (m.includes('claude') || m.startsWith('opus') || m.startsWith('sonnet') || m.startsWith('haiku')) {
    return 'claude';
  }
  if (m.includes('grok')) return 'grok';
  if (m.includes('kimi') || m.includes('moonshot')) return 'kimi';
  if (m.includes('gemini')) return 'gemini';
  if (m.includes('qwen')) return 'qwen';
  return 'unknown';
}

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
      const provider = guessProviderForModel(model);
      if (!modelsByProvider.has(provider)) modelsByProvider.set(provider, new Set());
      modelsByProvider.get(provider)!.add(model);
    }

    const rows: NormalizedDaily[] = ledger.dailyTotals().map((row) => {
      const provider = (sanitizeProvider(row.provider) ?? 'unknown') as Provider;
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
        estimatedCostUsd: null,
      };
    });

    const providers = new Set(rows.map((row) => row.provider));
    const providerConfidence: LedgerSourceResult['providerConfidence'] = {};
    for (const provider of providers) {
      providerConfidence[provider] = defaultProviderConfidence(provider);
    }

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
