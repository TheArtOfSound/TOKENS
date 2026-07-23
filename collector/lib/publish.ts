/**
 * Allowlist publication transform for the TOKENS collector.
 *
 * The dossier is explicit (Privacy Boundary, §18): the published object must be
 * CONSTRUCTED from an allowlist of approved fields, not produced by redacting a
 * raw object. A blocklist leaks anything it did not anticipate; an allowlist can
 * only emit fields we deliberately chose. This module is that transform.
 *
 * Every free-form string that does survive (model names, project branch/commit,
 * scripts, warnings) is additionally passed through the secret scanner, and any
 * value that trips a prohibited pattern is dropped rather than published.
 *
 * The output is deterministic (stable key order) so the snapshot hash is stable.
 */

import { createHash } from 'node:crypto';
import {
  CANONICAL_SCHEMA_VERSION,
  COLLECTOR_VERSION,
  buildMeasurementBlock,
  type MeasurementBlock,
  type PrivacyBlock,
  type Provider,
  type TokenMetrics,
} from './canonical';
import { isSafeString } from './secretScan';
import type { NormalizedDaily, ProviderSummary } from './normalize';
import type { ProfileBlock, VerificationStatus } from './profile';

// ---------- Published (frozen contract + additive) shapes ----------

export interface PublishedMetrics extends TokenMetrics {}

export interface PublishedProvider extends PublishedMetrics {
  provider: Provider;
  displayName: string;
  models: string[];
}

export interface PublishedDaily extends PublishedMetrics {
  date: string;
  provider: Provider;
  displayName: string;
  models: string[];
}

export interface PublishedProject {
  name: string;
  category: string;
  status: string;
  publicUrl?: string;
  description: string;
  found: boolean;
  git?: { branch: string | null; commit: string | null; changedFiles: number | null };
  stack: string[];
  scripts: string[];
  fileCounts: Record<string, number>;
  lastModified: string | null;
  scannerWarnings: string[];
}

export interface PublishedScanner {
  rootsChecked: number;
  allowlistedProjects: number;
  foundProjects: number;
  privacyMode: 'allowlist_no_paths';
}

export interface PublishedVerification {
  schemaVersion: string;
  canonicalSchemaVersion: string;
  snapshotSha256: string | null;
  rawLogsPublished: false;
  gitCommit: string | null;
  /** What the snapshot hash actually proves — stated plainly, no overclaiming. */
  proves: string;
}

export interface PublishedProfileLink {
  label: string;
  url: string;
}
export interface PublishedProfile {
  identity: {
    displayName: string;
    headline: string;
    pronouns: string | null;
    location: string | null;
    bio: string | null;
    availability: string | null;
    workCategories: string[];
    openTo: string[];
    links: PublishedProfileLink[];
  };
  activity: {
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
  };
  work: {
    artifacts: {
      type: string;
      title: string;
      description: string;
      url: string | null;
      period: string | null;
      linkedProject: string | null;
      verification: string;
      basis: string;
    }[];
    outcomes: { title: string; description: string; metric: string | null; period: string | null; verification: string; basis: string }[];
    collectorObserved: number;
    totalArtifacts: number;
    totalOutcomes: number;
  };
  verification: { label: string; status: VerificationStatus; basis: string }[];
  note: string;
}

export interface PublishedSnapshot {
  generatedAt: string;
  timezone: string;
  source: 'sample' | 'local_mac_sanitized_ccusage';
  collectorVersion: string;
  isSampleData: boolean;
  totals: PublishedMetrics;
  providers: Record<string, PublishedProvider>;
  daily: PublishedDaily[];
  qiraProjects: PublishedProject[];
  scanner: PublishedScanner;
  warnings: string[];
  measurement: MeasurementBlock;
  privacy: PrivacyBlock;
  profile?: PublishedProfile;
  verification: PublishedVerification;
}

/** The draft the collector assembles before publication. May contain extra fields. */
export interface DraftSnapshot {
  generatedAt: string;
  timezone: string;
  source: 'sample' | 'local_mac_sanitized_ccusage';
  isSampleData: boolean;
  totals: TokenMetrics;
  providers: Record<string, ProviderSummary>;
  daily: NormalizedDaily[];
  qiraProjects: unknown[];
  scanner: { rootsChecked: number; allowlistedProjects: number; foundProjects: number; privacyMode: 'allowlist_no_paths' };
  warnings: string[];
  gitCommit: string | null;
  eligibleForAggregateSync: boolean;
  profile?: ProfileBlock;
}

export interface PublishResult {
  published: PublishedSnapshot;
  /** Free-form values dropped because they tripped the secret scanner. */
  dropped: string[];
}

const HASH_PLACEHOLDER = null;

const isRec = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Coerce to a finite, non-negative number (fabricated data becomes 0, never NaN). */
function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Cost is null-with-reason rather than a fabricated 0 when unavailable. */
function safeCost(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Pick ONLY the eight metric fields, coerced, in fixed order. */
function pickMetrics(m: TokenMetrics): PublishedMetrics {
  return {
    inputTokens: safeCount(m.inputTokens),
    outputTokens: safeCount(m.outputTokens),
    cacheCreationTokens: safeCount(m.cacheCreationTokens),
    cacheReadTokens: safeCount(m.cacheReadTokens),
    cachedTokens: safeCount(m.cachedTokens),
    freshTokens: safeCount(m.freshTokens),
    totalTokens: safeCount(m.totalTokens),
    estimatedCostUsd: safeCost(m.estimatedCostUsd),
  };
}

/** Keep only safe strings; truncate each to the schema bound; record drops. */
function safeStrings(values: unknown, dropped: string[], max = 12, maxLen = 200): string[] {
  const list = Array.isArray(values) ? values : [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    if (isSafeString(item)) out.push(item.length > maxLen ? item.slice(0, maxLen) : item);
    else dropped.push(item.slice(0, 4));
    if (out.length >= max) break;
  }
  return out;
}

function safeStringOrNull(value: unknown, dropped: string[], maxLen = 400): string | null {
  if (typeof value !== 'string') return null;
  if (isSafeString(value)) return value.length > maxLen ? value.slice(0, maxLen) : value;
  dropped.push(value.slice(0, 4));
  return null;
}

function publishProject(raw: unknown, dropped: string[]): PublishedProject | null {
  if (!isRec(raw)) return null;
  const name = safeStringOrNull(raw.name, dropped);
  if (!name) return null;
  const fileCounts: Record<string, number> = {};
  if (isRec(raw.fileCounts)) {
    for (const [kind, count] of Object.entries(raw.fileCounts)) {
      if (/^[a-z]{1,8}$/.test(kind)) fileCounts[kind] = safeCount(count);
    }
  }
  const gitRaw = isRec(raw.git) ? raw.git : null;
  const project: PublishedProject = {
    name: name.slice(0, 60),
    category: (safeStringOrNull(raw.category, dropped, 40) ?? 'Unknown'),
    status: (safeStringOrNull(raw.status, dropped, 40) ?? 'unknown'),
    description: safeStringOrNull(raw.description, dropped, 400) ?? '',
    found: raw.found === true,
    git: gitRaw
      ? {
          branch: safeStringOrNull(gitRaw.branch, dropped, 80),
          commit: safeStringOrNull(gitRaw.commit, dropped, 60),
          changedFiles:
            typeof gitRaw.changedFiles === 'number' && Number.isFinite(gitRaw.changedFiles)
              ? gitRaw.changedFiles
              : null,
        }
      : undefined,
    stack: safeStrings(raw.stack, dropped, 10, 40),
    scripts: safeStrings(raw.scripts, dropped, 14, 60),
    fileCounts,
    lastModified: safeStringOrNull(raw.lastModified, dropped, 40),
    scannerWarnings: safeStrings(raw.scannerWarnings, dropped, 6, 200),
  };
  const publicUrl = safeStringOrNull(raw.publicUrl, dropped);
  if (publicUrl && /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?$/i.test(publicUrl)) {
    project.publicUrl = publicUrl;
  }
  return project;
}

const HTTPS_URL_RE = /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?$/i;
const VERIFICATION_STATUSES: VerificationStatus[] = ['verified', 'reported', 'self_submitted', 'unverified', 'pending'];
const WORK_TYPES = ['repository', 'deployment', 'publication', 'case_study', 'evaluation', 'research'];
const WORK_VERIFICATIONS = ['collector_observed', 'link_provided', 'self_reported'];

/** Publish the profile block: identity strings sanitized, activity coerced, links https-only. */
function publishProfile(profile: ProfileBlock, dropped: string[]): PublishedProfile {
  const id = profile.identity;
  const links: PublishedProfileLink[] = (Array.isArray(id.links) ? id.links : [])
    .map((link) => {
      const url = safeStringOrNull(link?.url, dropped, 200);
      const label = safeStringOrNull(link?.label, dropped, 40);
      return url && label && HTTPS_URL_RE.test(url) ? { label, url } : null;
    })
    .filter((link): link is PublishedProfileLink => link !== null)
    .slice(0, 6);

  const a = profile.activity;
  const validDate = (value: string | null): string | null =>
    typeof value === 'string' && DATE_RE.test(value) ? value : null;

  return {
    identity: {
      displayName: (safeStringOrNull(id.displayName, dropped, 60) ?? 'Anonymous').slice(0, 60),
      headline: safeStringOrNull(id.headline, dropped, 120) ?? '',
      pronouns: safeStringOrNull(id.pronouns, dropped, 24),
      location: safeStringOrNull(id.location, dropped, 60),
      bio: safeStringOrNull(id.bio, dropped, 600),
      availability: safeStringOrNull(id.availability, dropped, 160),
      workCategories: safeStrings(id.workCategories, dropped, 10, 40),
      openTo: safeStrings(id.openTo, dropped, 10, 40),
      links,
    },
    activity: {
      referenceDate: validDate(a.referenceDate) ?? new Date(0).toISOString().slice(0, 10),
      activeDays: safeCount(a.activeDays),
      firstActiveDate: validDate(a.firstActiveDate),
      lastActiveDate: validDate(a.lastActiveDate),
      spanDays: safeCount(a.spanDays),
      activeDaysLast30: safeCount(a.activeDaysLast30),
      activeDaysLast90: safeCount(a.activeDaysLast90),
      currentStreakDays: safeCount(a.currentStreakDays),
      longestStreakDays: safeCount(a.longestStreakDays),
      toolsUsed: safeStrings(a.toolsUsed, dropped, 8, 40),
      modelsUsed: safeStrings(a.modelsUsed, dropped, 24, 80),
      projectsActive: safeCount(a.projectsActive),
    },
    work: publishWork(profile.work, dropped),
    verification: (Array.isArray(profile.verification) ? profile.verification : [])
      .map((entry) => ({
        label: safeStringOrNull(entry?.label, dropped, 60) ?? '',
        status: VERIFICATION_STATUSES.includes(entry?.status) ? entry.status : 'unverified',
        basis: safeStringOrNull(entry?.basis, dropped, 300) ?? '',
      }))
      .filter((entry) => entry.label)
      .slice(0, 12),
    note: safeStringOrNull(profile.note, dropped, 400) ?? '',
  };
}

/**
 * Publish connected work artifacts and outcomes.
 * Every free-form string passes the secret scanner; URLs must be https.
 * An artifact only keeps `collector_observed` if the collector really linked it
 * to a scanned project — otherwise it is downgraded, so a hand-edited config
 * cannot mint a verification badge.
 */
function publishWork(work: ProfileBlock['work'], dropped: string[]): PublishedProfile['work'] {
  const source = work ?? { artifacts: [], outcomes: [], collectorObserved: 0, totalArtifacts: 0, totalOutcomes: 0 };

  const artifacts = (Array.isArray(source.artifacts) ? source.artifacts : [])
    .map((item) => {
      const title = safeStringOrNull(item?.title, dropped, 100);
      if (!title) return null;
      const url = safeStringOrNull(item?.url, dropped, 200);
      const linkedProject = safeStringOrNull(item?.linkedProject, dropped, 60);
      const verification = WORK_VERIFICATIONS.includes(item?.verification) ? item.verification : 'self_reported';
      return {
        type: WORK_TYPES.includes(item?.type) ? item.type : 'repository',
        title,
        description: safeStringOrNull(item?.description, dropped, 300) ?? '',
        url: url && HTTPS_URL_RE.test(url) ? url : null,
        period: safeStringOrNull(item?.period, dropped, 40),
        linkedProject,
        // A collector_observed badge requires a real linked project.
        verification: verification === 'collector_observed' && !linkedProject ? 'self_reported' : verification,
        basis: safeStringOrNull(item?.basis, dropped, 300) ?? '',
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 40);

  const outcomes = (Array.isArray(source.outcomes) ? source.outcomes : [])
    .map((item) => {
      const title = safeStringOrNull(item?.title, dropped, 100);
      if (!title) return null;
      return {
        title,
        description: safeStringOrNull(item?.description, dropped, 300) ?? '',
        metric: safeStringOrNull(item?.metric, dropped, 80),
        period: safeStringOrNull(item?.period, dropped, 40),
        // Outcomes are never verified by the collector.
        verification: 'self_reported',
        basis: safeStringOrNull(item?.basis, dropped, 300) ?? '',
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 40);

  return {
    artifacts,
    outcomes,
    collectorObserved: artifacts.filter((item) => item.verification === 'collector_observed').length,
    totalArtifacts: artifacts.length,
    totalOutcomes: outcomes.length,
  };
}

const TIMEZONE_RE = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){0,2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Construct the published snapshot from the draft using an allowlist, sanitize
 * free-form strings, build the measurement + privacy blocks, and compute the
 * content hash. Unknown draft fields cannot reach the output.
 */
export function publishSnapshot(draft: DraftSnapshot): PublishResult {
  const dropped: string[] = [];

  const totals = pickMetrics(draft.totals);

  const providers: Record<string, PublishedProvider> = {};
  for (const [key, summary] of Object.entries(draft.providers)) {
    if (key !== 'claude' && key !== 'codex') continue;
    providers[key] = {
      provider: summary.provider,
      displayName: summary.displayName.slice(0, 40),
      models: safeStrings(summary.models, dropped, 10, 80),
      ...pickMetrics(summary),
    };
  }

  const daily: PublishedDaily[] = draft.daily
    .filter((row) => DATE_RE.test(row.date) && (row.provider === 'claude' || row.provider === 'codex'))
    .map((row) => ({
      date: row.date,
      provider: row.provider,
      displayName: row.displayName.slice(0, 40),
      models: safeStrings(row.models, dropped, 8, 80),
      ...pickMetrics(row),
    }));

  const qiraProjects = draft.qiraProjects
    .map((project) => publishProject(project, dropped))
    .filter((project): project is PublishedProject => project !== null);

  const warnings = safeStrings(draft.warnings, dropped, 12, 200);

  const measurement = buildMeasurementBlock(totals.totalTokens, totals.estimatedCostUsd);
  const profile = draft.profile ? publishProfile(draft.profile, dropped) : undefined;

  const privacy: PrivacyBlock = {
    rawContentPersisted: false,
    allowlistPublication: true,
    eligibleForAggregateSync: draft.eligibleForAggregateSync,
    fieldsPublished: [
      'totals',
      'providers',
      'daily',
      'qiraProjects',
      'scanner',
      'warnings',
      'measurement',
      ...(profile ? ['profile'] : []),
      'verification',
    ],
  };

  const published: PublishedSnapshot = {
    generatedAt: ISO_RE.test(draft.generatedAt) ? draft.generatedAt : new Date(0).toISOString(),
    timezone: TIMEZONE_RE.test(draft.timezone) ? draft.timezone : 'unknown',
    source: draft.source,
    collectorVersion: COLLECTOR_VERSION,
    isSampleData: draft.isSampleData === true,
    totals,
    providers,
    daily,
    qiraProjects,
    scanner: {
      rootsChecked: safeCount(draft.scanner.rootsChecked),
      allowlistedProjects: safeCount(draft.scanner.allowlistedProjects),
      foundProjects: safeCount(draft.scanner.foundProjects),
      privacyMode: 'allowlist_no_paths',
    },
    warnings,
    measurement,
    privacy,
    ...(profile ? { profile } : {}),
    verification: {
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      canonicalSchemaVersion: CANONICAL_SCHEMA_VERSION,
      snapshotSha256: HASH_PLACEHOLDER,
      rawLogsPublished: false,
      gitCommit: safeStringOrNull(draft.gitCommit, dropped, 60),
      proves:
        'The hash proves the published snapshot was not altered after generation. ' +
        'It does not prove the private source logs were immutable, only that this public file is intact.',
    },
  };

  published.verification.snapshotSha256 = computeSnapshotHash(published);
  return { published, dropped };
}

/** Deterministic content hash over the published object with the hash field nulled. */
export function computeSnapshotHash(snapshot: PublishedSnapshot): string {
  const withoutHash = {
    ...snapshot,
    verification: { ...snapshot.verification, snapshotSha256: HASH_PLACEHOLDER },
  };
  return createHash('sha256').update(JSON.stringify(withoutHash)).digest('hex');
}

/** Verify a published snapshot's embedded hash matches its content. */
export function verifySnapshotHash(snapshot: PublishedSnapshot): boolean {
  return snapshot.verification.snapshotSha256 === computeSnapshotHash(snapshot);
}

/**
 * Content hash that EXCLUDES the wall-clock `generatedAt` and the snapshot hash.
 * Two runs over identical usage data produce an identical content hash, which
 * lets the collector skip rewriting files (and therefore skip committing) when
 * nothing meaningful changed. This is what makes repeated scans idempotent at
 * the commit level and stops the every-30-minutes no-op commit storm.
 */
export function computeContentHash(snapshot: PublishedSnapshot): string {
  const stable = {
    ...snapshot,
    generatedAt: '',
    verification: { ...snapshot.verification, snapshotSha256: HASH_PLACEHOLDER },
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}
