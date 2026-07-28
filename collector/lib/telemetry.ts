/**
 * Sanitized agent-operation telemetry for publication.
 *
 * Reddit consensus (agenticAI): people who operate agents deeply talk about
 * hierarchical telemetry — request → agent/tool calls → timing — not token
 * vanity. We publish ONLY what the local event ledger can derive without raw
 * prompts, paths, session ids, or tool payloads:
 *
 *   provider → model → session-count / event-count hierarchy
 *   session-size distribution (events per pseudonymized session)
 *   inter-event timing when timestamps allow
 *
 * Full hierarchical tool-call traces are not available from provider usage
 * logs today; when adapters can extract them safely, they land as an additive
 * layer with the same allowlist discipline.
 */

import type { Ledger } from './ledger';

export interface TelemetryProviderNode {
  provider: string;
  events: number;
  sessions: number;
  totalTokens: number;
  models: Array<{
    model: string;
    events: number;
    sessions: number;
    totalTokens: number;
  }>;
}

export interface TelemetrySessionStats {
  /** Distinct HMAC session pseudonyms with at least one event. */
  distinctSessions: number;
  /** Events with no session pseudonym (still counted in totals). */
  eventsWithoutSession: number;
  medianEventsPerSession: number | null;
  p95EventsPerSession: number | null;
  maxEventsPerSession: number | null;
  /** Median gap between successive events within a session, in seconds. */
  medianInterEventSeconds: number | null;
}

export interface TelemetryBlock {
  measurementClass: 'collector_derived';
  confidence: 'medium' | 'low';
  totalEvents: number;
  hierarchy: TelemetryProviderNode[];
  sessions: TelemetrySessionStats;
  note: string;
  limitations: string[];
  doesNotEstablish: string[];
}

export const TELEMETRY_NOTE =
  'Agent-operation telemetry derived from local provider usage events. ' +
  'Counts and timing only — no prompts, responses, tool arguments, paths, or raw session ids. ' +
  'Session identity is an on-device HMAC pseudonym and is not published.';

export const TELEMETRY_LIMITATIONS = [
  'Provider usage logs do not currently expose full tool-call trees (caller → agent → tools) with payloads.',
  'Timing is inter-event gaps from usage timestamps, not end-to-end wall-clock traces of tool latency.',
  'Session pseudonyms are device-local HMACs; they never leave this machine and are not in the public snapshot.',
  'Codex event-level totals may overstate relative to ccusage aggregates; see EVENT_LEDGER docs.',
] as const;

export const TELEMETRY_NON_CLAIMS = [
  'expertise',
  'quality_of_reasoning',
  'that_high_event_volume_means_skill',
  'full_tool_call_fidelity',
  'legal_identity',
] as const;

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? null;
}

function median(sorted: number[]): number | null {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const a = sorted[mid - 1];
  const b = sorted[mid];
  if (a == null || b == null) return null;
  return Math.round((a + b) / 2);
}

/** Pure builder — used by tests with fixture rows. */
export function buildTelemetryFromRows(
  rows: Array<{
    provider: string;
    model: string | null;
    sessionPseudonym: string | null;
    totalTokens: number;
    occurredAt: string;
  }>,
): TelemetryBlock {
  const totalEvents = rows.length;
  type ModelAgg = { events: number; sessions: Set<string>; totalTokens: number };
  type ProvAgg = { events: number; sessions: Set<string>; totalTokens: number; models: Map<string, ModelAgg> };
  const byProvider = new Map<string, ProvAgg>();
  const sessionEventCounts = new Map<string, number>();
  const sessionTimes = new Map<string, number[]>();
  let eventsWithoutSession = 0;

  for (const row of rows) {
    const provider = row.provider || 'unknown';
    const model = row.model && row.model.length ? row.model : '(unattributed)';
    let prov = byProvider.get(provider);
    if (!prov) {
      prov = { events: 0, sessions: new Set(), totalTokens: 0, models: new Map() };
      byProvider.set(provider, prov);
    }
    prov.events += 1;
    prov.totalTokens += row.totalTokens;
    let mod = prov.models.get(model);
    if (!mod) {
      mod = { events: 0, sessions: new Set(), totalTokens: 0 };
      prov.models.set(model, mod);
    }
    mod.events += 1;
    mod.totalTokens += row.totalTokens;

    if (row.sessionPseudonym) {
      prov.sessions.add(row.sessionPseudonym);
      mod.sessions.add(row.sessionPseudonym);
      sessionEventCounts.set(row.sessionPseudonym, (sessionEventCounts.get(row.sessionPseudonym) ?? 0) + 1);
      const t = Date.parse(row.occurredAt);
      if (Number.isFinite(t)) {
        const times = sessionTimes.get(row.sessionPseudonym) ?? [];
        times.push(t);
        sessionTimes.set(row.sessionPseudonym, times);
      }
    } else {
      eventsWithoutSession += 1;
    }
  }

  const hierarchy: TelemetryProviderNode[] = Array.from(byProvider.entries())
    .map(([provider, prov]) => ({
      provider,
      events: prov.events,
      sessions: prov.sessions.size,
      totalTokens: prov.totalTokens,
      models: Array.from(prov.models.entries())
        .map(([model, mod]) => ({
          model,
          events: mod.events,
          sessions: mod.sessions.size,
          totalTokens: mod.totalTokens,
        }))
        .sort((a, b) => b.events - a.events)
        .slice(0, 24),
    }))
    .sort((a, b) => b.events - a.events);

  const counts = Array.from(sessionEventCounts.values()).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (const times of sessionTimes.values()) {
    if (times.length < 2) continue;
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i += 1) {
      const prev = times[i - 1];
      const cur = times[i];
      if (prev == null || cur == null) continue;
      const gapSec = Math.round((cur - prev) / 1000);
      // Ignore multi-hour gaps (session resume / idle) — those are not step latency.
      if (gapSec >= 0 && gapSec <= 3600) gaps.push(gapSec);
    }
  }
  gaps.sort((a, b) => a - b);

  return {
    measurementClass: 'collector_derived',
    confidence: totalEvents > 0 ? 'medium' : 'low',
    totalEvents,
    hierarchy,
    sessions: {
      distinctSessions: sessionEventCounts.size,
      eventsWithoutSession,
      medianEventsPerSession: median(counts),
      p95EventsPerSession: percentile(counts, 95),
      maxEventsPerSession: counts.length ? counts[counts.length - 1]! : null,
      medianInterEventSeconds: median(gaps),
    },
    note: TELEMETRY_NOTE,
    limitations: [...TELEMETRY_LIMITATIONS],
    doesNotEstablish: [...TELEMETRY_NON_CLAIMS],
  };
}

function percentileSorted(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? null;
}

function medianSorted(sorted: number[]): number | null {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const a = sorted[mid - 1];
  const b = sorted[mid];
  if (a == null || b == null) return null;
  return Math.round((a + b) / 2);
}

/** Fast path: SQL aggregates — safe on large ledgers. */
export function deriveTelemetry(ledger: Ledger | null): TelemetryBlock | null {
  if (!ledger) return null;
  const summary = ledger.telemetrySummary();
  if (!summary.totalEvents) return null;
  const counts = summary.sessionEventCounts;
  return {
    measurementClass: 'collector_derived',
    confidence: 'medium',
    totalEvents: summary.totalEvents,
    hierarchy: summary.hierarchy,
    sessions: {
      distinctSessions: summary.distinctSessions,
      eventsWithoutSession: summary.eventsWithoutSession,
      medianEventsPerSession: medianSorted(counts),
      p95EventsPerSession: percentileSorted(counts, 95),
      maxEventsPerSession: counts.length ? counts[counts.length - 1]! : null,
      medianInterEventSeconds: summary.medianInterEventSeconds,
    },
    note: TELEMETRY_NOTE,
    limitations: [...TELEMETRY_LIMITATIONS],
    doesNotEstablish: [...TELEMETRY_NON_CLAIMS],
  };
}
