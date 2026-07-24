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
export interface ProfileContact {
  /** Button text, e.g. "Invite to opportunity" or "Contact Bryan". */
  label: string;
  /** mailto: or https: — the recruiter action target. */
  href: string;
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
  /** Optional professional headshot (https URL the member self-hosts). */
  avatarUrl?: string | null;
  /** Primary recruiter action. */
  contact?: ProfileContact | null;
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

// ---- connected work artifacts + outcomes ----
export type WorkType = 'repository' | 'deployment' | 'publication' | 'case_study' | 'evaluation' | 'research';

export interface WorkArtifactConfig {
  type: WorkType;
  title: string;
  description?: string;
  url?: string;
  linkedProject?: string;
  period?: string;
}
export interface OutcomeConfig {
  title: string;
  description?: string;
  metric?: string;
  period?: string;
}
export interface WorkConfig {
  artifacts?: WorkArtifactConfig[];
  outcomes?: OutcomeConfig[];
}

/** How strongly a work artifact is backed by evidence. */
export type WorkVerification = 'collector_observed' | 'link_provided' | 'self_reported';

export interface WorkArtifact {
  type: WorkType;
  title: string;
  description: string;
  url: string | null;
  period: string | null;
  linkedProject: string | null;
  verification: WorkVerification;
  basis: string;
}
export interface Outcome {
  title: string;
  description: string;
  metric: string | null;
  period: string | null;
  verification: 'self_reported';
  basis: string;
}
export interface WorkEvidence {
  artifacts: WorkArtifact[];
  outcomes: Outcome[];
  collectorObserved: number;
  totalArtifacts: number;
  totalOutcomes: number;
}

// ---- opportunity / economics (self-submitted, so a buyer never infers cost from tokens) ----
export interface OpportunityConfig {
  engagementTypes?: string[];
  compensation?: string | null;
  typicalProjectSize?: string | null;
  workArrangement?: string | null;
  timezone?: string | null;
  responseTime?: string | null;
  computeCostRange?: string | null;
}
export interface OpportunityBlock {
  engagementTypes: string[];
  compensation: string | null;
  typicalProjectSize: string | null;
  workArrangement: string | null;
  timezone: string | null;
  responseTime: string | null;
  computeCostRange: string | null;
  note: string;
}

export const OPPORTUNITY_NOTE =
  'Availability, engagement, and compensation are set by the member. They are self-declared preferences, not verified terms.';

export function buildOpportunity(config: OpportunityConfig = {}): OpportunityBlock {
  return {
    engagementTypes: (config.engagementTypes ?? []).slice(0, 12),
    compensation: config.compensation ?? null,
    typicalProjectSize: config.typicalProjectSize ?? null,
    workArrangement: config.workArrangement ?? null,
    timezone: config.timezone ?? null,
    responseTime: config.responseTime ?? null,
    computeCostRange: config.computeCostRange ?? null,
    note: OPPORTUNITY_NOTE,
  };
}

// ---- efficiency signals (reward doing the same with less, not raw volume) ----
export interface EfficiencyBlock {
  cachedSharePct: number | null;
  freshSharePct: number | null;
  outputSharePct: number | null;
  avgTokensPerActiveDay: number | null;
  note: string;
}

export function deriveEfficiency(daily: NormalizedDaily[], activeDays: number): EfficiencyBlock {
  let input = 0;
  let output = 0;
  let cached = 0;
  let fresh = 0;
  let total = 0;
  for (const row of daily) {
    input += row.inputTokens;
    output += row.outputTokens;
    cached += row.cachedTokens;
    fresh += row.freshTokens;
    total += row.totalTokens;
  }
  const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
  return {
    // Cache reuse is an efficiency signal: reusing context instead of resending it.
    cachedSharePct: pct(cached, total),
    freshSharePct: pct(fresh, total),
    outputSharePct: pct(output, input + output),
    avgTokensPerActiveDay: activeDays > 0 ? Math.round(total / activeDays) : null,
    note:
      'Efficiency signals, not a ranking. Producing the same verified result with fewer tokens is better. ' +
      'These are context for the activity figures — cost per outcome requires connected outcomes, which are not built yet.',
  };
}

export interface ProfileBlock {
  identity: ProfileIdentity;
  activity: ProfileActivity;
  work: WorkEvidence;
  opportunity: OpportunityBlock;
  efficiency: EfficiencyBlock;
  verification: VerificationCategory[];
  note: string;
}

export interface ScannedProject {
  name: string;
  found: boolean;
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

const HTTPS = /^https:\/\//i;

/**
 * Cross-reference self-submitted work artifacts with the local project scan.
 * An artifact whose `linkedProject` was actually found by the collector earns a
 * `collector_observed` badge (real, local, tamper-evident evidence). Otherwise it
 * is a self-submitted link or claim, labeled as such. Outcomes are ALWAYS
 * self-reported — they require third-party confirmation and are never faked.
 */
export function deriveWorkEvidence(config: WorkConfig, qiraProjects: ScannedProject[]): WorkEvidence {
  const foundNames = new Set(qiraProjects.filter((p) => p.found).map((p) => p.name.toLowerCase()));

  const artifacts: WorkArtifact[] = (config.artifacts ?? []).map((a) => {
    const linked = typeof a.linkedProject === 'string' && foundNames.has(a.linkedProject.toLowerCase());
    const hasUrl = typeof a.url === 'string' && HTTPS.test(a.url);
    const verification: WorkVerification = linked ? 'collector_observed' : hasUrl ? 'link_provided' : 'self_reported';
    const basis = linked
      ? 'The local collector independently observed git/file activity for this project.'
      : hasUrl
        ? 'Public link provided; not independently verified.'
        : 'Self-reported; not independently verified.';
    return {
      type: a.type,
      title: a.title,
      description: a.description ?? '',
      url: a.url ?? null,
      period: a.period ?? null,
      linkedProject: a.linkedProject ?? null,
      verification,
      basis,
    };
  });

  const outcomes: Outcome[] = (config.outcomes ?? []).map((o) => ({
    title: o.title,
    description: o.description ?? '',
    metric: o.metric ?? null,
    period: o.period ?? null,
    verification: 'self_reported' as const,
    basis: 'Self-reported outcome; requires third-party confirmation to be verified.',
  }));

  return {
    artifacts,
    outcomes,
    collectorObserved: artifacts.filter((a) => a.verification === 'collector_observed').length,
    totalArtifacts: artifacts.length,
    totalOutcomes: outcomes.length,
  };
}

/**
 * Evidence ladder.
 *
 * Reddit review made the point sharply: a generic "verified" badge is
 * misleading, because it collapses very different strengths of evidence. Every
 * item now names EXACTLY what was checked, in a fixed ladder from strongest
 * independent evidence to weakest self-assertion. Nothing here says "verified"
 * without saying verified-by-what.
 */
export function deriveVerification(activity: ProfileActivity, work?: WorkEvidence): VerificationCategory[] {
  const observed = work?.collectorObserved ?? 0;
  return [
    {
      label: 'Device-signed',
      status: 'verified',
      basis:
        'The published snapshot was signed by a key held on this device and has not changed since. ' +
        'This proves integrity, not identity, and not that the source logs were genuine.',
    },
    {
      label: 'Collector-observed',
      status: 'verified',
      basis:
        `AI activity was read from the provider's own usage accounting in local logs on this device ` +
        `(${activity.activeDays} active days; ${activity.projectsActive} project(s) seen locally). ` +
        'This is device-local observation, not independent confirmation.',
    },
    {
      label: 'Provider-attested',
      status: 'pending',
      basis:
        'No provider has independently confirmed this usage (no OAuth usage API, billing export, or ' +
        'enterprise attestation is connected yet). This is a stronger tier when available.',
    },
    {
      label: 'Benchmark-assessed',
      status: 'pending',
      basis: 'No practical, reproducible assessment has been completed and attached to this profile.',
    },
    {
      label: 'Third-party-confirmed',
      status: observed > 0 ? 'pending' : 'pending',
      basis:
        'No client, employer, repository owner, or research organization has confirmed an outcome. ' +
        `${observed} artifact(s) are collector-observed, which shows local activity but not authorship, quality, or results.`,
    },
    {
      label: 'Self-submitted',
      status: 'self_submitted',
      basis: 'Identity, headline, links, work artifacts, and any outcomes were entered by the member and are not independently verified.',
    },
  ];
}

export function buildProfile(
  identity: ProfileIdentity,
  daily: NormalizedDaily[],
  providers: Record<string, ProviderSummary>,
  referenceDate: string,
  qiraProjects: ScannedProject[],
  workConfig: WorkConfig = {},
  opportunityConfig: OpportunityConfig = {},
): ProfileBlock {
  const projectsActive = qiraProjects.filter((p) => p.found).length;
  const activity = deriveActivity(daily, providers, referenceDate, projectsActive);
  const work = deriveWorkEvidence(workConfig, qiraProjects);
  return {
    identity,
    activity,
    work,
    opportunity: buildOpportunity(opportunityConfig),
    efficiency: deriveEfficiency(daily, activity.activeDays),
    verification: deriveVerification(activity, work),
    note: PROFILE_NOTE,
  };
}
