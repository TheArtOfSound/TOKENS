/**
 * Integrity checks over the measured series.
 *
 * A local signature proves a snapshot is authentic and unaltered — it does NOT
 * prove the source logs were genuine. Someone controlling a machine could feed
 * the collector fabricated inputs and sign them faithfully. We can't fully solve
 * that locally, but we can surface statistical tells so a reader (and the member)
 * sees them.
 *
 * The rule the Reddit review insisted on: FLAG, do not accuse. Every check
 * reports a neutral status and a plain detail. Nothing here calls anyone a fraud;
 * it points at data worth a second look.
 */

import type { NormalizedDaily } from './normalize';

export type IntegrityStatus = 'ok' | 'flag';

export interface IntegrityCheck {
  name: string;
  status: IntegrityStatus;
  detail: string;
}

export interface IntegrityReport {
  checks: IntegrityCheck[];
  flags: number;
  note: string;
}

// A single day above this is physically implausible for one person's local
// tooling and is worth a second look. Deliberately generous.
const IMPLAUSIBLE_DAILY_TOKENS = 50_000_000_000; // 50B/day
const KNOWN_MODEL = /^(claude|gpt|o[0-9]|gemini|llama|mistral|deepseek|qwen|grok|codex|command|sonar)/i;

function dateKey(row: NormalizedDaily): string {
  return row.date;
}

export function detectAnomalies(
  daily: NormalizedDaily[],
  referenceDate: string,
  previousDaily: NormalizedDaily[] = [],
): IntegrityReport {
  const checks: IntegrityCheck[] = [];

  // 1. No future-dated activity.
  const future = daily.filter((row) => row.date > referenceDate);
  checks.push(
    future.length
      ? { name: 'No future-dated activity', status: 'flag', detail: `${future.length} day-row(s) dated after ${referenceDate}.` }
      : { name: 'No future-dated activity', status: 'ok', detail: 'All activity is dated on or before the snapshot date.' },
  );

  // 2. No implausible single-day volume.
  const spikes = daily.filter((row) => row.totalTokens > IMPLAUSIBLE_DAILY_TOKENS);
  checks.push(
    spikes.length
      ? { name: 'Plausible daily volume', status: 'flag', detail: `${spikes.length} day(s) exceed ${(IMPLAUSIBLE_DAILY_TOKENS / 1e9).toFixed(0)}B tokens.` }
      : { name: 'Plausible daily volume', status: 'ok', detail: 'No day exceeds the implausible-volume threshold.' },
  );

  // 3. No negative or malformed totals.
  const negative = daily.filter((row) => row.totalTokens < 0 || !Number.isFinite(row.totalTokens));
  checks.push(
    negative.length
      ? { name: 'Well-formed totals', status: 'flag', detail: `${negative.length} row(s) have negative or non-finite totals.` }
      : { name: 'Well-formed totals', status: 'ok', detail: 'All totals are finite and non-negative.' },
  );

  // 4. No duplicate (date, provider) rows.
  const seen = new Set<string>();
  let dupes = 0;
  for (const row of daily) {
    const key = `${dateKey(row)}:${row.provider}`;
    if (seen.has(key)) dupes += 1;
    seen.add(key);
  }
  checks.push(
    dupes
      ? { name: 'No duplicate day-rows', status: 'flag', detail: `${dupes} duplicate (date, provider) row(s).` }
      : { name: 'No duplicate day-rows', status: 'ok', detail: 'Each (date, provider) appears once.' },
  );

  // 5. Recognized model families only (informational).
  const unknownModels = [...new Set(daily.flatMap((row) => row.models))].filter((model) => !KNOWN_MODEL.test(model));
  checks.push(
    unknownModels.length
      ? { name: 'Recognized model families', status: 'flag', detail: `Unrecognized model name(s): ${unknownModels.slice(0, 5).join(', ')}.` }
      : { name: 'Recognized model families', status: 'ok', detail: 'All model names match known provider families.' },
  );

  // 6. No large retroactive backfill vs. the previously published snapshot.
  if (previousDaily.length) {
    const prevMax = previousDaily.reduce((max, row) => (row.date > max ? row.date : max), '');
    const backfilled = daily.filter((row) => row.date < prevMax && !previousDaily.some((p) => p.date === row.date && p.provider === row.provider));
    checks.push(
      backfilled.length > 5
        ? { name: 'No large retroactive backfill', status: 'flag', detail: `${backfilled.length} historical day-row(s) appeared that were not in the previous snapshot.` }
        : { name: 'No large retroactive backfill', status: 'ok', detail: 'No unusual retroactive changes versus the last snapshot.' },
    );
  }

  const flags = checks.filter((check) => check.status === 'flag').length;
  return {
    checks,
    flags,
    note:
      flags === 0
        ? 'All automated integrity checks passed. These detect statistical tells, not fraud, and a passing result does not prove the source logs were genuine.'
        : 'One or more checks flagged data worth a second look. A flag is not an accusation — it points at values a reader should examine.',
  };
}
