/**
 * Professional profile derivation for TOKENS.
 *
 * This is the "verified AI-work identity" layer. The rules that keep it honest:
 *  - IDENTITY fields (name, headline, bio, availability, links) are user-submitted.
 *    They are labeled `self_submitted` and are never presented as verified.
 *  - ACTIVITY fields (active days, streaks, tools, models) are DERIVED
 *    deterministically from the measured daily data — no fabrication, no
 *    "expert" inference from volume.
 *  - VERIFICATION categories state exactly what is and is not verified. Things we
 *    cannot verify yet (identity, work outcomes) are `pending`, never faked.
 *
 * All functions here are pure and unit-tested. Sanitization of the free-form
 * identity strings happens in the allowlist publication transform (publish.ts).
 */

import type { NormalizedDaily, ProviderSummary } from './normalize';
import { providerDisplayName } from './normalize';
import type { Provider } from './canonical';

// ---- user-submitted identity (from profile/profile.json) ----
export interface ProfileLink {
  label: string;
  url: string;
}
export interface ProfileIdentity {
  displayName: string;
  headline: string;
  pronouns?: string | null;
  location?: string | null;
  bio?: string | null;
  availability?: string | null;
  workCategories?: string[];
  openTo?: string[];
  links?: ProfileLink[];
}

// ---- measured activity (derived from daily data) ----
export interface ProfileActivity {
  referenceDate: string;
  activeDays: number;
  firstActiveDate: string | null;
  lastActiveDate: string | null;
  spanDays: number;
  activeDaysLast30: number;
  activeDaysLast90: number;
  currentStreakDays: number;
  longestStreakDays: number;
  toolsUsed: string[];
  modelsUsed: string[];
  projectsActive: number;
}

export type VerificationStatus = 'verified' | 'reported' | 'self_submitted' | 'unverified' | 'pending';
export interface VerificationCategory {
  label: string;
  status: VerificationStatus;
  basis: string;
}

export interface ProfileBlock {
  identity: ProfileIdentity;
  activity: ProfileActivity;
  verification: VerificationCategory[];
  note: string;
}

export const PROFILE_NOTE =
  'Identity fields are self-submitted and unverified. Activity is derived from measured, ' +
  'provider-reported usage. Activity volume is evidence of practice, not a measure of skill, ' +
  'seniority, or employability.';

// Sustained-usage threshold: enough distinct active days over a long enough span.
const SUSTAINED_MIN_DAYS = 20;
const SUSTAINED_MIN_SPAN = 56; // ~8 weeks

const DAY_MS = 86_400_000;

function toUtc(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}
export function addDaysUtc(date: string, delta: number): string {
  return new Date(toUtc(date) + delta * DAY_MS).toISOString().slice(0, 10);
}
export function diffDaysUtc(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** Distinct active calendar dates (union across providers), sorted ascending. */
export function activeDates(daily: NormalizedDaily[]): string[] {
  return [...new Set(daily.filter((row) => row.totalTokens > 0).map((row) => row.date))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function longestStreak(sortedDates: string[]): number {
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const date of sortedDates) {
    run = prev && diffDaysUtc(prev, date) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = date;
  }
  return longest;
}

function currentStreak(sortedDates: string[], referenceDate: string): number {
  if (!sortedDates.length) return 0;
  const set = new Set(sortedDates);
  const last = sortedDates[sortedDates.length - 1];
  // Only a "current" streak if the last active day is today or yesterday.
  if (diffDaysUtc(last, referenceDate) > 1) return 0;
  let streak = 1;
  let cursor = last;
  while (set.has(addDaysUtc(cursor, -1))) {
    streak += 1;
    cursor = addDaysUtc(cursor, -1);
  }
  return streak;
}

function withinLastDays(sortedDates: string[], referenceDate: string, windowDays: number): number {
  return sortedDates.filter((date) => {
    const gap = diffDaysUtc(date, referenceDate);
    return gap >= 0 && gap <= windowDays - 1;
  }).length;
}

export function deriveActivity(
  daily: NormalizedDaily[],
  providers: Record<string, ProviderSummary>,
  referenceDate: string,
  projectsActive: number,
): ProfileActivity {
  const dates = activeDates(daily);
  const firstActiveDate = dates[0] ?? null;
  const lastActiveDate = dates.length ? dates[dates.length - 1] : null;
  const spanDays = firstActiveDate && lastActiveDate ? diffDaysUtc(firstActiveDate, lastActiveDate) + 1 : 0;

  const toolsUsed = Object.keys(providers)
    .filter((key): key is Provider => key === 'claude' || key === 'codex')
    .map((key) => providerDisplayName(key));
  const modelsUsed = [...new Set(daily.flatMap((row) => row.models))].sort((a, b) => a.localeCompare(b)).slice(0, 24);

  return {
    referenceDate,
    activeDays: dates.length,
    firstActiveDate,
    lastActiveDate,
    spanDays,
    activeDaysLast30: withinLastDays(dates, referenceDate, 30),
    activeDaysLast90: withinLastDays(dates, referenceDate, 90),
    currentStreakDays: currentStreak(dates, referenceDate),
    longestStreakDays: longestStreak(dates),
    toolsUsed,
    modelsUsed,
    projectsActive,
  };
}

export function deriveVerification(activity: ProfileActivity): VerificationCategory[] {
  const sustained = activity.activeDays >= SUSTAINED_MIN_DAYS && activity.spanDays >= SUSTAINED_MIN_SPAN;
  return [
    {
      label: 'Collector verified',
      status: 'verified',
      basis: 'Aggregate built by the open-source local collector; the snapshot hash verifies the public file was not altered after generation.',
    },
    {
      label: 'Provider reported',
      status: 'reported',
      basis: 'Token counts come from provider usage accounting parsed out of local Claude Code / Codex logs.',
    },
    {
      label: 'Sustained usage',
      status: sustained ? 'verified' : 'unverified',
      basis: `${activity.activeDays} active AI-work days over a ${activity.spanDays}-day span (threshold: ${SUSTAINED_MIN_DAYS} days across ${SUSTAINED_MIN_SPAN} days).`,
    },
    {
      label: 'Active across multiple projects',
      status: activity.projectsActive >= 2 ? 'verified' : 'unverified',
      basis: `${activity.projectsActive} allowlisted project(s) detected locally.`,
    },
    {
      label: 'Identity verified',
      status: 'pending',
      basis: 'No identity verification has been performed. Name and headline are self-submitted.',
    },
    {
      label: 'Work verified',
      status: 'pending',
      basis: 'No work-output or outcome verification is connected yet.',
    },
  ];
}

export function buildProfile(
  identity: ProfileIdentity,
  daily: NormalizedDaily[],
  providers: Record<string, ProviderSummary>,
  referenceDate: string,
  projectsActive: number,
): ProfileBlock {
  const activity = deriveActivity(daily, providers, referenceDate, projectsActive);
  return {
    identity,
    activity,
    verification: deriveVerification(activity),
    note: PROFILE_NOTE,
  };
}
