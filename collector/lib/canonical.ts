/**
 * Canonical evidence model for the TOKENS local collector.
 *
 * This is the versioned, source-of-truth vocabulary the dossier requires
 * (Section 14, "Canonical Evidence Model"). It exists BEHIND the frozen public
 * JSON contract so the platform is not permanently bound to the current shape.
 *
 * The single most important rule this file encodes: every published measurement
 * carries an explicit MeasurementClass and a human-readable method. We never
 * label a number "verified" with no provenance, and we never silently combine
 * measurement classes (a tokenizer estimate is never summed into an exact total).
 */

/** Bump when the published snapshot shape or provenance semantics change. */
export const CANONICAL_SCHEMA_VERSION = '2.0.0';

/** Collector implementation version. Distinct from the schema version. */
export const COLLECTOR_VERSION = '0.5.0';

/**
 * How a measured value was obtained. Terminology is fixed by the dossier so the
 * whole platform (collector, site, future backend) speaks one language.
 */
export type MeasurementClass =
  /** The provider's own usage accounting (e.g. API `usage` fields in local logs). */
  | 'provider_reported'
  /** An application/tool reported the value (e.g. a CLI's own counter). */
  | 'application_reported'
  /** Deterministically computed by this collector from reported values (e.g. a sum). */
  | 'collector_derived'
  /** Modeled/estimated (e.g. a price-table cost). Never an authoritative figure. */
  | 'tokenizer_estimated'
  /** Entered by a human and not independently verified. */
  | 'user_submitted';

export type Confidence = 'high' | 'medium' | 'low';

/**
 * Provider id (slug). Claude/Codex remain the original first-class sources;
 * Grok, Kimi, Gemini, and other agents are also valid. See lib/providers.ts.
 */
export type Provider = string;

/** The token metric shape used by totals / providers / daily rows (frozen contract). */
export interface TokenMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** collector_derived: cacheCreationTokens + cacheReadTokens */
  cachedTokens: number;
  /** collector_derived: inputTokens + outputTokens */
  freshTokens: number;
  /** collector_derived: input + output + cacheCreation + cacheRead */
  totalTokens: number;
  /** tokenizer_estimated. `null` (not `0`) when no estimate is available. */
  estimatedCostUsd: number | null;
}

/** Provenance descriptor for a metric family, published so the UI can label honestly. */
export interface MetricProvenance {
  measurementClass: MeasurementClass;
  confidence: Confidence;
  /** Human-readable description of how the value was obtained. */
  method: string;
}

/**
 * Provenance for every metric family we publish. This is the machine-readable
 * backing for the "how do we know this" copy on the dashboard.
 *
 * Grounded in the real `ccusage daily --json` shape: input/output/cache token
 * fields come straight from the provider usage accounting parsed out of the
 * local Claude Code / Codex logs; the totals are our deterministic sums; cost is
 * ccusage's price-table estimate (not an invoice).
 */
export const METRIC_PROVENANCE: Record<string, MetricProvenance> = {
  inputTokens: {
    measurementClass: 'provider_reported',
    confidence: 'high',
    method: 'Non-cached input tokens from provider usage accounting in local logs (parsed by ccusage).',
  },
  outputTokens: {
    measurementClass: 'provider_reported',
    confidence: 'high',
    method: 'Generated output tokens from provider usage accounting in local logs (parsed by ccusage).',
  },
  cacheCreationTokens: {
    measurementClass: 'provider_reported',
    confidence: 'high',
    method: 'Cache-write tokens from provider usage accounting in local logs (parsed by ccusage).',
  },
  cacheReadTokens: {
    measurementClass: 'provider_reported',
    confidence: 'high',
    method: 'Cache-read tokens from provider usage accounting in local logs (parsed by ccusage).',
  },
  cachedTokens: {
    measurementClass: 'collector_derived',
    confidence: 'high',
    method: 'Deterministic sum: cacheCreationTokens + cacheReadTokens.',
  },
  freshTokens: {
    measurementClass: 'collector_derived',
    confidence: 'high',
    method: 'Deterministic sum: inputTokens + outputTokens.',
  },
  totalTokens: {
    measurementClass: 'collector_derived',
    confidence: 'high',
    method: 'Deterministic sum of the four provider-reported token components.',
  },
  estimatedCostUsd: {
    measurementClass: 'tokenizer_estimated',
    confidence: 'low',
    method: 'ccusage price-table estimate. Not an authoritative invoice; excluded from exact token totals.',
  },
  models: {
    measurementClass: 'provider_reported',
    confidence: 'high',
    method: 'Model identifiers reported by the provider logs.',
  },
};

/** Money is represented in the published contract as float USD (frozen), but the
 * canonical model prefers integer micro-USD to avoid floating point drift. This
 * helper converts a float USD estimate to integer micro-USD for canonical records. */
export function toMicroUsd(usd: number | null): number | null {
  if (usd === null || !Number.isFinite(usd)) return null;
  return Math.round(usd * 1_000_000);
}

/** The published "measurement" block. Lets any consumer label values honestly. */
export interface MeasurementBlock {
  /** Provenance per metric family. */
  classes: Record<string, MetricProvenance>;
  /** The honest "measured" total: only provider-reported + collector-derived tokens. */
  exactTotalTokens: number;
  /** Estimates are kept structurally separate so they can never be summed into exact totals. */
  estimatedOnly: { costUsd: number | null; costMicroUsd: number | null };
  /** Plain-language note reinforcing what these numbers do and do not mean. */
  note: string;
}

export const MEASUREMENT_NOTE =
  'Token counts are provider-reported usage accounting or deterministic sums of them. ' +
  'Cost is an estimate from a price table, not an invoice, and is never added into token totals. ' +
  'Activity volume is not a measure of skill, productivity, or employability.';

/** Build the measurement block for a given exact token total and cost estimate. */
export function buildMeasurementBlock(exactTotalTokens: number, costUsd: number | null): MeasurementBlock {
  return {
    classes: METRIC_PROVENANCE,
    exactTotalTokens,
    estimatedOnly: { costUsd, costMicroUsd: toMicroUsd(costUsd) },
    note: MEASUREMENT_NOTE,
  };
}

/** Privacy posture published alongside the data so viewers can see the guarantees. */
export interface PrivacyBlock {
  /** True guarantee: raw prompt/response/source content is never persisted or published. */
  rawContentPersisted: false;
  /** The published object is constructed from an allowlist, not redacted from a raw object. */
  allowlistPublication: true;
  /** Whether this snapshot is eligible to be included in any future aggregate sync. */
  eligibleForAggregateSync: boolean;
  /** The exact set of top-level field families published (for the "what leaves the device" preview). */
  fieldsPublished: string[];
  /**
   * Fields the user switched OFF via consent. Naming the withheld field is
   * deliberate: a viewer can see something was withheld without learning its
   * value, which is more honest than silently omitting it.
   */
  fieldsWithheld: string[];
  /** Sources the user declined entirely; those logs were never read. */
  sourcesDisabled: string[];
}
