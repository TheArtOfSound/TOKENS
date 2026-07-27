/**
 * Post-merge durability evidence — NOT a quality score.
 *
 * Reddit consensus: accepted-diff rates are a bad proficiency metric. Survival
 * of shipped work is a stronger *outcome* signal, with hard limitations:
 * churn can mean new requirements, refactors, renames, dependency bumps, or
 * unrelated contributor work — not only failure.
 *
 * This module reports underlying evidence. It never emits a "quality score".
 */

export type DurabilityWindow = '24h' | '7d' | '30d' | '90d';

export interface LineSnapshot {
  /** Lines introduced in the baseline commit set (AI-touched or linked change). */
  introducedLines: number;
  /** Lines from that set still present at the window end (best-effort git blame/content). */
  remainingLines: number;
  reverts: number;
  correctiveCommits: number;
  hotfixes: number;
  bugLinkedFollowUps: number;
  failedCiAfterMerge: number;
  filesReopened: number;
}

export interface WindowEvidence {
  window: DurabilityWindow;
  days: number;
  introducedLines: number;
  remainingLines: number;
  /** 0–100 when introducedLines > 0; null when no basis. */
  remainingPct: number | null;
  reverts: number;
  correctiveCommits: number;
  hotfixes: number;
  bugLinkedFollowUps: number;
  failedCiAfterMerge: number;
  filesReopened: number;
  /** Human evidence sentence — never a score. */
  summary: string;
}

export interface ProjectDurability {
  projectName: string;
  linkedArtifact: string | null;
  measurementClass: 'collector_observed_git' | 'unavailable';
  windows: WindowEvidence[];
  limitations: string[];
  note: string;
}

export interface DurabilityBlock {
  projects: ProjectDurability[];
  note: string;
  /** Explicit non-claims so UI cannot invent a quality score. */
  doesNotEstablish: string[];
}

export const DURABILITY_LIMITATIONS = [
  'Churn is not always failure: requirements change, refactors, renames, dependency updates, and unrelated edits also move lines.',
  'AI-touched attribution is best-effort when present; without it, evidence is scoped to linked repository activity only.',
  'Does not establish expertise, sole authorship, or product quality.',
  'Does not establish that surviving lines are correct or desired.',
] as const;

export const DURABILITY_NON_CLAIMS = [
  'expertise',
  'quality',
  'skill',
  'sole_authorship',
  'product_success',
  'that_churn_equals_failure',
] as const;

const WINDOW_DAYS: Record<DurabilityWindow, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

function pct(remaining: number, introduced: number): number | null {
  if (!(introduced > 0) || !Number.isFinite(remaining) || remaining < 0) return null;
  const raw = (remaining / introduced) * 100;
  // One decimal place, clamped to [0, 100].
  return Math.round(Math.min(100, Math.max(0, raw)) * 10) / 10;
}

function summarize(window: DurabilityWindow, snap: LineSnapshot, remainingPct: number | null): string {
  if (snap.introducedLines <= 0) {
    return `No baseline lines recorded for the ${window} window — durability not measured.`;
  }
  const parts = [
    remainingPct == null
      ? `Baseline ${snap.introducedLines} lines; remaining count unavailable for ${window}.`
      : `${remainingPct}% of ${snap.introducedLines} baseline lines remained after ${window}.`,
  ];
  if (snap.reverts) parts.push(`${snap.reverts} revert${snap.reverts === 1 ? '' : 's'}`);
  if (snap.correctiveCommits) {
    parts.push(`${snap.correctiveCommits} corrective commit${snap.correctiveCommits === 1 ? '' : 's'}`);
  }
  if (snap.hotfixes) parts.push(`${snap.hotfixes} hotfix${snap.hotfixes === 1 ? '' : 'es'}`);
  if (snap.bugLinkedFollowUps) parts.push(`${snap.bugLinkedFollowUps} bug-linked follow-up(s)`);
  if (snap.failedCiAfterMerge) parts.push(`${snap.failedCiAfterMerge} failed CI after merge`);
  if (snap.filesReopened) parts.push(`${snap.filesReopened} file(s) reopened`);
  if (
    !snap.reverts &&
    !snap.correctiveCommits &&
    !snap.hotfixes &&
    !snap.bugLinkedFollowUps &&
    !snap.failedCiAfterMerge
  ) {
    parts.push('no reverts or corrective follow-ups identified in this window');
  }
  parts.push('Churn is evidence, not a quality score.');
  return parts.join(' ');
}

/** Pure: turn raw line snapshots into window evidence with honest summaries. */
export function buildWindowEvidence(window: DurabilityWindow, snap: LineSnapshot): WindowEvidence {
  const remainingPct = pct(snap.remainingLines, snap.introducedLines);
  return {
    window,
    days: WINDOW_DAYS[window],
    introducedLines: Math.max(0, Math.floor(snap.introducedLines)),
    remainingLines: Math.max(0, Math.floor(snap.remainingLines)),
    remainingPct,
    reverts: Math.max(0, Math.floor(snap.reverts)),
    correctiveCommits: Math.max(0, Math.floor(snap.correctiveCommits)),
    hotfixes: Math.max(0, Math.floor(snap.hotfixes)),
    bugLinkedFollowUps: Math.max(0, Math.floor(snap.bugLinkedFollowUps)),
    failedCiAfterMerge: Math.max(0, Math.floor(snap.failedCiAfterMerge)),
    filesReopened: Math.max(0, Math.floor(snap.filesReopened)),
    summary: summarize(window, snap, remainingPct),
  };
}

export function buildProjectDurability(input: {
  projectName: string;
  linkedArtifact?: string | null;
  windows: Partial<Record<DurabilityWindow, LineSnapshot>>;
  measured: boolean;
}): ProjectDurability {
  const order: DurabilityWindow[] = ['24h', '7d', '30d', '90d'];
  const windows = order
    .filter((w) => input.windows[w])
    .map((w) => buildWindowEvidence(w, input.windows[w]!));
  return {
    projectName: input.projectName.slice(0, 60),
    linkedArtifact: input.linkedArtifact?.slice(0, 100) ?? null,
    measurementClass: input.measured ? 'collector_observed_git' : 'unavailable',
    windows,
    limitations: [...DURABILITY_LIMITATIONS],
    note:
      input.measured
        ? 'Durability evidence from local git observation of a linked project. Not a quality score.'
        : 'Durability not measured for this project (no local git basis or no AI-touch attribution).',
  };
}

export function buildDurabilityBlock(projects: ProjectDurability[]): DurabilityBlock {
  return {
    projects: projects.slice(0, 20),
    note:
      'Post-merge durability is contextual evidence about how shipped work changed over time. ' +
      'It is not proficiency, not a ranking, and not a claim that surviving code is correct.',
    doesNotEstablish: [...DURABILITY_NON_CLAIMS],
  };
}

/**
 * Classify a git subject line as corrective / revert / hotfix for evidence counts.
 * Conservative: only clear markers. Everything else is ignored (not counted as failure).
 */
export function classifyFollowUpSubject(subject: string): {
  revert: boolean;
  corrective: boolean;
  hotfix: boolean;
  bugLinked: boolean;
} {
  const s = subject.toLowerCase();
  return {
    revert: /\brevert\b/.test(s),
    corrective: /\b(fix|bugfix|patch|correct)\b/.test(s) && !/\brevert\b/.test(s),
    hotfix: /\bhot[\s-]?fix\b/.test(s),
    bugLinked: /\b(fixes|closes|resolves)\s+#?\d+/i.test(subject) || /\bBUG-\d+\b/i.test(subject),
  };
}

/** Aggregate follow-up commit subjects into a LineSnapshot shell (lines filled by caller). */
export function countFollowUps(
  subjects: string[],
  lines: { introduced: number; remaining: number; filesReopened?: number; failedCi?: number },
): LineSnapshot {
  let reverts = 0;
  let correctiveCommits = 0;
  let hotfixes = 0;
  let bugLinkedFollowUps = 0;
  for (const subject of subjects) {
    const c = classifyFollowUpSubject(subject);
    if (c.revert) reverts += 1;
    if (c.corrective) correctiveCommits += 1;
    if (c.hotfix) hotfixes += 1;
    if (c.bugLinked) bugLinkedFollowUps += 1;
  }
  return {
    introducedLines: lines.introduced,
    remainingLines: lines.remaining,
    reverts,
    correctiveCommits,
    hotfixes,
    bugLinkedFollowUps,
    failedCiAfterMerge: lines.failedCi ?? 0,
    filesReopened: lines.filesReopened ?? 0,
  };
}
