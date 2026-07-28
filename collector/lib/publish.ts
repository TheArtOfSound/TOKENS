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
import { canonicalize } from './canonicalJson';
import type { NormalizedDaily, ProviderSummary } from './normalize';
import type { ProfileBlock, VerificationStatus } from './profile';
import { disabledFields, disabledSources, type ConsentConfig, type FieldKey } from './consent';
import { buildClaimAuthority, type ClaimAuthorityBlock } from './evidenceAuthority';
import type { DurabilityBlock } from './durability';
import type { TelemetryBlock } from './telemetry';

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
    identityProofs: { type: string; handle: string; gistId: string }[];
    avatarUrl: string | null;
    contact: { label: string; href: string } | null;
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
  opportunity: {
    engagementTypes: string[];
    compensation: string | null;
    typicalProjectSize: string | null;
    workArrangement: string | null;
    timezone: string | null;
    responseTime: string | null;
    computeCostRange: string | null;
    note: string;
  };
  efficiency: {
    cachedSharePct: number | null;
    freshSharePct: number | null;
    outputSharePct: number | null;
    avgTokensPerActiveDay: number | null;
    note: string;
  };
  practice?: {
    tokenEfficiencyArchitecture: string[];
    contextInjectionSystems: string[];
    problemFocus: string[];
    leveragePatterns: string[];
    operatingCostNote: string | null;
    valueDeliveredNote: string | null;
    verification: 'self_reported';
    note: string;
  };
  verification: { label: string; status: VerificationStatus; basis: string }[];
  note: string;
}

export interface PublishedImportedSource {
  label: string;
  format: string;
  measurementClass: string;
  confidence: string;
  events: number;
  totalTokens: number;
  firstDate: string | null;
  lastDate: string | null;
  models: string[];
}
export interface PublishedImported {
  note: string;
  totalTokens: number;
  sources: PublishedImportedSource[];
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
  imported?: PublishedImported;
  integrity?: { checks: { name: string; status: string; detail: string }[]; flags: number; note: string };
  sourceOfTruth: 'event_ledger' | 'ccusage_aggregate';
  providerConfidence: Record<string, { confidence: string; note: string }>;
  verification: PublishedVerification;
  /** Claim-bounded evidence ladder for every badge on this snapshot. */
  claimAuthority: ClaimAuthorityBlock;
  /** Post-merge durability evidence when measured — never a quality score. */
  durability?: DurabilityBlock;
  /**
   * Sanitized agent-operation telemetry hierarchy (counts + timing only).
   * No prompts, tool payloads, paths, or raw session ids.
   */
  telemetry?: TelemetryBlock;
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
  consent?: ConsentConfig;
  /** Which pipeline produced the daily rows. */
  sourceOfTruth?: 'event_ledger' | 'ccusage_aggregate';
  /** Per-provider measurement confidence and its justification. */
  providerConfidence?: Record<string, { confidence: 'high' | 'medium'; note: string }>;
  /** Automated integrity checks over the measured series. */
  integrity?: { checks: { name: string; status: string; detail: string }[]; flags: number; note: string };
  /** Self-imported sources from the ledger (origin='imported'). */
  imported?: {
    sourceLabel: string;
    adapter: string;
    measurementClass: string;
    confidence: string;
    events: number;
    totalTokens: number;
    firstDate: string | null;
    lastDate: string | null;
    models: string[];
  }[];
  /** Optional durability evidence assembled by the collector from local git. */
  durability?: DurabilityBlock;
  /** Optional sanitized agent-operation telemetry from the event ledger. */
  telemetry?: TelemetryBlock;
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

/** A percentage 0–100, or null when there is no basis to compute one. */
function safePct(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
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
/** Avatar: https images only. A data: URI would bloat the signed payload; a
 *  non-https URL is dropped rather than published. */
function publishAvatar(value: unknown, dropped: string[]): string | null {
  const url = safeStringOrNull(value, dropped, 300);
  return url && HTTPS_URL_RE.test(url) ? url : null;
}

/**
 * Contact action: a label plus a `mailto:` or `https:` target.
 *
 * The href is validated STRUCTURALLY, not run through the secret scanner:
 * publishing the member's own contact channel is the explicit purpose, and the
 * scanner strips email addresses (it exists to keep emails out of LOG-derived
 * data). We still forbid anything but a well-formed mailto or https URL, so a
 * `javascript:` or path can never slip through. The label still goes through the
 * scanner — it should never carry a secret.
 */
function publishContact(value: unknown, dropped: string[]): { label: string; href: string } | null {
  if (!value || typeof value !== 'object') return null;
  const contact = value as { label?: unknown; href?: unknown };
  const label = safeStringOrNull(contact.label, dropped, 40);
  const href = typeof contact.href === 'string' ? contact.href.trim().slice(0, 200) : '';
  if (!label || !href) return null;
  const okMailto = /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+(\?[^\s]*)?$/.test(href);
  const okHttps = HTTPS_URL_RE.test(href) && !/[\s<>"']/.test(href);
  return okMailto || okHttps ? { label, href } : null;
}

const GH_HANDLE_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
const GIST_ID_RE = /^[a-f0-9]{6,64}$/i;

/** Publish identity proofs: only well-formed GitHub handle + gist id survive. */
function publishIdentityProofs(
  proofs: unknown,
  dropped: string[],
): { type: string; handle: string; gistId: string }[] {
  if (!Array.isArray(proofs)) return [];
  return proofs
    .map((p) => {
      const proof = p as { type?: unknown; handle?: unknown; gistId?: unknown };
      const handle = safeStringOrNull(proof.handle, dropped, 40);
      const gistId = safeStringOrNull(proof.gistId, dropped, 64);
      if (proof.type !== 'github' || !handle || !gistId) return null;
      if (!GH_HANDLE_RE.test(handle) || !GIST_ID_RE.test(gistId)) return null;
      return { type: 'github', handle, gistId };
    })
    .filter((p): p is { type: string; handle: string; gistId: string } => p !== null)
    .slice(0, 6);
}

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
      identityProofs: publishIdentityProofs(id.identityProofs, dropped),
      avatarUrl: publishAvatar(id.avatarUrl, dropped),
      contact: publishContact(id.contact, dropped),
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
    opportunity: {
      engagementTypes: safeStrings(profile.opportunity?.engagementTypes, dropped, 12, 40),
      compensation: safeStringOrNull(profile.opportunity?.compensation, dropped, 80),
      typicalProjectSize: safeStringOrNull(profile.opportunity?.typicalProjectSize, dropped, 60),
      workArrangement: safeStringOrNull(profile.opportunity?.workArrangement, dropped, 60),
      timezone: safeStringOrNull(profile.opportunity?.timezone, dropped, 60),
      responseTime: safeStringOrNull(profile.opportunity?.responseTime, dropped, 60),
      computeCostRange: safeStringOrNull(profile.opportunity?.computeCostRange, dropped, 80),
      note: safeStringOrNull(profile.opportunity?.note, dropped, 300) ?? '',
    },
    efficiency: {
      cachedSharePct: safePct(profile.efficiency?.cachedSharePct),
      freshSharePct: safePct(profile.efficiency?.freshSharePct),
      outputSharePct: safePct(profile.efficiency?.outputSharePct),
      avgTokensPerActiveDay: profile.efficiency?.avgTokensPerActiveDay == null ? null : safeCount(profile.efficiency.avgTokensPerActiveDay),
      note: safeStringOrNull(profile.efficiency?.note, dropped, 300) ?? '',
    },
    ...(profile.practice ? { practice: publishPractice(profile.practice, dropped) } : {}),
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

function publishPractice(
  practice: NonNullable<ProfileBlock['practice']>,
  dropped: string[],
): NonNullable<PublishedProfile['practice']> {
  return {
    tokenEfficiencyArchitecture: safeStrings(practice.tokenEfficiencyArchitecture, dropped, 12, 160),
    contextInjectionSystems: safeStrings(practice.contextInjectionSystems, dropped, 12, 160),
    problemFocus: safeStrings(practice.problemFocus, dropped, 12, 160),
    leveragePatterns: safeStrings(practice.leveragePatterns, dropped, 12, 160),
    operatingCostNote: safeStringOrNull(practice.operatingCostNote, dropped, 300),
    valueDeliveredNote: safeStringOrNull(practice.valueDeliveredNote, dropped, 400),
    verification: 'self_reported',
    note: safeStringOrNull(practice.note, dropped, 400) ?? '',
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

  const profile = draft.profile ? publishProfile(draft.profile, dropped) : undefined;

  // Apply the user's per-field publication toggles. A field switched off is
  // removed from the payload entirely -- not blanked, not zeroed -- so it cannot
  // be recovered from the published file.
  //
  // ORDER MATTERS: this runs BEFORE buildMeasurementBlock. When it ran after,
  // a withheld cost was still recoverable from measurement.estimatedOnly.costUsd
  // (caught by consent.test.ts).
  const consent = draft.consent;
  const allow = (key: FieldKey): boolean => !consent || consent.fields[key] !== false;

  if (!allow('estimatedCost')) {
    totals.estimatedCostUsd = null;
    for (const summary of Object.values(providers)) summary.estimatedCostUsd = null;
    for (const row of daily) row.estimatedCostUsd = null;
  }
  if (!allow('models')) {
    for (const summary of Object.values(providers)) summary.models = [];
    for (const row of daily) row.models = [];
  }
  if (profile && !allow('profileWork')) {
    profile.work = { artifacts: [], outcomes: [], collectorObserved: 0, totalArtifacts: 0, totalOutcomes: 0 };
  }

  // Built only after consent has been applied, so a withheld cost never reaches
  // the estimatedOnly block.
  const measurement = buildMeasurementBlock(totals.totalTokens, totals.estimatedCostUsd);

  const importedBlock = publishImported(draft.imported, dropped);
  const integrityBlock = publishIntegrity(draft.integrity, dropped);

  const privacy: PrivacyBlock = {
    rawContentPersisted: false,
    allowlistPublication: true,
    eligibleForAggregateSync: draft.eligibleForAggregateSync,
    fieldsPublished: [
      'totals',
      ...(allow('providers') ? ['providers'] : []),
      ...(allow('daily') ? ['daily'] : []),
      ...(allow('qiraProjects') ? ['qiraProjects'] : []),
      'scanner',
      'warnings',
      'measurement',
      ...(profile ? ['profile'] : []),
      ...(integrityBlock ? ['integrity'] : []),
      ...(importedBlock ? ['imported'] : []),
      'sourceOfTruth',
      'providerConfidence',
      'verification',
      'claimAuthority',
      ...(draft.durability?.projects?.length ? ['durability'] : []),
      ...(draft.telemetry && draft.telemetry.totalEvents > 0 ? ['telemetry'] : []),
    ],
    // Stated in the published file so a viewer can see the user withheld
    // something, without revealing what the withheld values were.
    fieldsWithheld: consent ? disabledFields(consent) : [],
    sourcesDisabled: consent ? disabledSources(consent) : [],
  };

  const published: PublishedSnapshot = {
    generatedAt: ISO_RE.test(draft.generatedAt) ? draft.generatedAt : new Date(0).toISOString(),
    timezone: TIMEZONE_RE.test(draft.timezone) ? draft.timezone : 'unknown',
    source: draft.source,
    collectorVersion: COLLECTOR_VERSION,
    isSampleData: draft.isSampleData === true,
    totals,
    providers: allow('providers') ? providers : {},
    daily: allow('daily') ? daily : [],
    qiraProjects: allow('qiraProjects') ? qiraProjects : [],
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
    ...(integrityBlock ? { integrity: integrityBlock } : {}),
    ...(importedBlock ? { imported: importedBlock } : {}),
    sourceOfTruth: draft.sourceOfTruth === 'event_ledger' ? 'event_ledger' : 'ccusage_aggregate',
    providerConfidence: Object.fromEntries(
      Object.entries(draft.providerConfidence ?? {})
        .filter(([key]) => key === 'claude' || key === 'codex')
        .map(([key, value]) => [
          key,
          {
            confidence: value?.confidence === 'high' ? 'high' : 'medium',
            note: safeStringOrNull(value?.note, dropped, 400) ?? '',
          },
        ]),
    ),
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
    claimAuthority: buildClaimAuthority({
      hasActivity: Boolean(profile?.activity?.activeDays && profile.activity.activeDays > 0) || daily.length > 0,
      hasTokenTotals: totals.totalTokens > 0,
      // Signature is layered on after publish; claim is that a device-signed
      // record is the intended publication mode. present flips true once signed.
      hasSignature: false,
      hasCollectorObservedWork: Boolean(profile?.work?.collectorObserved && profile.work.collectorObserved > 0),
      hasLinkProvidedWork: Boolean(
        profile?.work?.artifacts?.some((a) => a.verification === 'link_provided'),
      ),
      hasSelfReportedOutcomes: Boolean(profile?.work?.totalOutcomes && profile.work.totalOutcomes > 0),
      hasSelfSubmittedIdentity: Boolean(profile?.identity?.displayName),
      hasIdentityProofs: Boolean(profile?.identity?.identityProofs?.length),
    }),
    ...(draft.durability && Array.isArray(draft.durability.projects) && draft.durability.projects.length
      ? { durability: publishDurability(draft.durability, dropped) }
      : {}),
    ...(draft.telemetry && draft.telemetry.totalEvents > 0
      ? { telemetry: publishTelemetry(draft.telemetry, dropped) }
      : {}),
  };

  // After assembly, mark device-signed signal as intended (collector always signs
  // before write). The browser re-checks the actual signature independently.
  published.claimAuthority = {
    ...published.claimAuthority,
    signals: published.claimAuthority.signals.map((s) =>
      s.signalType === 'device_signed_snapshot' ? { ...s, present: true } : s,
    ),
  };

  published.verification.snapshotSha256 = computeSnapshotHash(published);
  return { published, dropped };
}

/** Publish telemetry: counts + model names only; never session pseudonyms. */
function publishTelemetry(block: TelemetryBlock, dropped: string[]): TelemetryBlock {
  return {
    measurementClass: 'collector_derived',
    confidence: block.confidence === 'low' ? 'low' : 'medium',
    totalEvents: safeCount(block.totalEvents),
    hierarchy: (Array.isArray(block.hierarchy) ? block.hierarchy : [])
      .map((node) => ({
        provider: safeStringOrNull(node.provider, dropped, 40) ?? 'unknown',
        events: safeCount(node.events),
        sessions: safeCount(node.sessions),
        totalTokens: safeCount(node.totalTokens),
        models: (Array.isArray(node.models) ? node.models : [])
          .map((m) => ({
            model: safeStringOrNull(m.model, dropped, 80) ?? '(unattributed)',
            events: safeCount(m.events),
            sessions: safeCount(m.sessions),
            totalTokens: safeCount(m.totalTokens),
          }))
          .slice(0, 24),
      }))
      .slice(0, 8),
    sessions: {
      distinctSessions: safeCount(block.sessions?.distinctSessions),
      eventsWithoutSession: safeCount(block.sessions?.eventsWithoutSession),
      medianEventsPerSession:
        block.sessions?.medianEventsPerSession == null
          ? null
          : safeCount(block.sessions.medianEventsPerSession),
      p95EventsPerSession:
        block.sessions?.p95EventsPerSession == null
          ? null
          : safeCount(block.sessions.p95EventsPerSession),
      maxEventsPerSession:
        block.sessions?.maxEventsPerSession == null
          ? null
          : safeCount(block.sessions.maxEventsPerSession),
      medianInterEventSeconds:
        block.sessions?.medianInterEventSeconds == null
          ? null
          : safeCount(block.sessions.medianInterEventSeconds),
    },
    note: safeStringOrNull(block.note, dropped, 500) ?? '',
    limitations: safeStrings(block.limitations, dropped, 8, 240),
    doesNotEstablish: safeStrings(block.doesNotEstablish, dropped, 12, 60),
  };
}

/** Publish durability evidence: fixed keys only, free-form through secret scanner. */
function publishDurability(block: DurabilityBlock, dropped: string[]): DurabilityBlock {
  return {
    note: safeStringOrNull(block.note, dropped, 500) ?? '',
    doesNotEstablish: safeStrings(block.doesNotEstablish, dropped, 12, 40),
    projects: (Array.isArray(block.projects) ? block.projects : [])
      .map((p) => {
        const name = safeStringOrNull(p?.projectName, dropped, 60);
        if (!name) return null;
        const measurementClass =
          p.measurementClass === 'collector_observed_git' ? ('collector_observed_git' as const) : ('unavailable' as const);
        return {
          projectName: name,
          linkedArtifact: safeStringOrNull(p.linkedArtifact, dropped, 100),
          measurementClass,
          limitations: safeStrings(p.limitations, dropped, 8, 200),
          note: safeStringOrNull(p.note, dropped, 300) ?? '',
          windows: (Array.isArray(p.windows) ? p.windows : [])
            .map((w) => {
              const window = (['24h', '7d', '30d', '90d'] as const).includes(w.window as '24h')
                ? (w.window as '24h' | '7d' | '30d' | '90d')
                : ('30d' as const);
              return {
                window,
                days: safeCount(w.days),
                introducedLines: safeCount(w.introducedLines),
                remainingLines: safeCount(w.remainingLines),
                remainingPct:
                  typeof w.remainingPct === 'number' && Number.isFinite(w.remainingPct)
                    ? Math.max(0, Math.min(100, w.remainingPct))
                    : null,
                reverts: safeCount(w.reverts),
                correctiveCommits: safeCount(w.correctiveCommits),
                hotfixes: safeCount(w.hotfixes),
                bugLinkedFollowUps: safeCount(w.bugLinkedFollowUps),
                failedCiAfterMerge: safeCount(w.failedCiAfterMerge),
                filesReopened: safeCount(w.filesReopened),
                summary: safeStringOrNull(w.summary, dropped, 400) ?? '',
              };
            })
            .slice(0, 4),
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .slice(0, 20),
  };
}

/**
 * Publish self-imported sources as their own block, sanitized and clearly
 * labeled. Every label/model passes the secret scanner. This block is
 * deliberately SEPARATE from `totals`/`providers` (which are measured only) so a
 * viewer — and the schema — can never confuse self-imported figures with
 * collector-measured ones. Returns undefined when there is nothing imported.
 */
/** Publish the integrity report, sanitized and status-clamped. */
function publishIntegrity(report: DraftSnapshot['integrity'], dropped: string[]): PublishedSnapshot['integrity'] | undefined {
  if (!report || !Array.isArray(report.checks) || report.checks.length === 0) return undefined;
  const checks = report.checks
    .map((check) => ({
      name: safeStringOrNull(check?.name, dropped, 60) ?? '',
      status: check?.status === 'flag' ? 'flag' : 'ok',
      detail: safeStringOrNull(check?.detail, dropped, 200) ?? '',
    }))
    .filter((check) => check.name)
    .slice(0, 20);
  if (!checks.length) return undefined;
  return {
    checks,
    flags: checks.filter((check) => check.status === 'flag').length,
    note: safeStringOrNull(report.note, dropped, 300) ?? '',
  };
}

function publishImported(sources: DraftSnapshot['imported'], dropped: string[]): PublishedImported | undefined {
  if (!Array.isArray(sources) || sources.length === 0) return undefined;
  const published: PublishedImportedSource[] = sources
    .map((s) => {
      const label = safeStringOrNull(s?.sourceLabel, dropped, 60);
      if (!label) return null;
      const validDate = (value: string | null | undefined) =>
        typeof value === 'string' && DATE_RE.test(value) ? value : null;
      return {
        label,
        format: safeStringOrNull(s?.adapter, dropped, 40) ?? 'import',
        // Imports are always user_submitted; never let a bad value read stronger.
        measurementClass: s?.measurementClass === 'user_submitted' ? 'user_submitted' : 'user_submitted',
        confidence: ['low', 'medium', 'high'].includes(s?.confidence) ? String(s.confidence) : 'low',
        events: safeCount(s?.events),
        totalTokens: safeCount(s?.totalTokens),
        firstDate: validDate(s?.firstDate),
        lastDate: validDate(s?.lastDate),
        models: safeStrings(s?.models, dropped, 24, 80),
      };
    })
    .filter((s): s is PublishedImportedSource => s !== null)
    .slice(0, 30);

  if (!published.length) return undefined;
  return {
    note:
      'Self-imported from other AI sources. This data is user-submitted, not measured by the collector, ' +
      'and not independently verifiable. It is excluded from the measured token totals above.',
    totalTokens: published.reduce((sum, s) => sum + s.totalTokens, 0),
    sources: published,
  };
}

/**
 * Deterministic content hash over the published object with the hash field
 * nulled and the signature block excluded.
 *
 * Uses canonical JSON, not JSON.stringify: stringify's output depends on
 * property insertion order, so the digest could not be reproduced by a verifier
 * in another language. The signature block is excluded because it is layered on
 * top of an already-hashed snapshot (and carries a fresh nonce each run).
 */
export function computeSnapshotHash(snapshot: PublishedSnapshot): string {
  const { signature: _signature, ...rest } = snapshot as PublishedSnapshot & { signature?: unknown };
  const withoutHash = {
    ...rest,
    verification: { ...snapshot.verification, snapshotSha256: HASH_PLACEHOLDER },
  };
  return createHash('sha256').update(canonicalize(withoutHash)).digest('hex');
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
  // The signature must be excluded too: it carries a fresh nonce and issuedAt on
  // every run, so including it would make each run look changed and defeat the
  // idempotency check entirely.
  const { signature: _signature, ...rest } = snapshot as PublishedSnapshot & { signature?: unknown };
  const stable = {
    ...rest,
    generatedAt: '',
    verification: { ...snapshot.verification, snapshotSha256: HASH_PLACEHOLDER },
  };
  return createHash('sha256').update(canonicalize(stable)).digest('hex');
}
