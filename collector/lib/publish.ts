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
