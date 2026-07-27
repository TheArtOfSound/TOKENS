export type ProviderKey = 'claude' | 'codex' | 'all' | 'unknown';

export interface TokenMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cachedTokens: number;
  freshTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
}

export interface ProviderSummary extends TokenMetrics {
  provider: ProviderKey;
  displayName: string;
  models: string[];
}

export interface DailyUsage extends TokenMetrics {
  date: string;
  provider: ProviderKey;
  displayName: string;
  models: string[];
}

export interface QiraProjectScan {
  name: string;
  category: string;
  status: string;
  publicUrl?: string;
  description: string;
  found: boolean;
  git?: {
    branch: string | null;
    commit: string | null;
    changedFiles: number | null;
  };
  stack: string[];
  scripts: string[];
  fileCounts: Record<string, number>;
  lastModified: string | null;
  scannerWarnings: string[];
}

export type MeasurementClass =
  | 'provider_reported'
  | 'application_reported'
  | 'collector_derived'
  | 'tokenizer_estimated'
  | 'user_submitted';

export interface MetricProvenance {
  measurementClass: MeasurementClass;
  confidence: 'high' | 'medium' | 'low';
  method: string;
}

export interface MeasurementBlock {
  classes: Record<string, MetricProvenance>;
  exactTotalTokens: number;
  estimatedOnly: { costUsd: number | null; costMicroUsd: number | null };
  note: string;
}

export interface PrivacyBlock {
  rawContentPersisted: boolean;
  allowlistPublication: boolean;
  eligibleForAggregateSync: boolean;
  fieldsPublished: string[];
}

export type VerificationStatus = 'verified' | 'reported' | 'self_submitted' | 'unverified' | 'pending';

export interface ProfileBlock {
  identity: {
    displayName: string;
    headline: string;
    pronouns: string | null;
    location: string | null;
    bio: string | null;
    availability: string | null;
    workCategories: string[];
    openTo: string[];
    links: { label: string; url: string }[];
    identityProofs?: { type: string; handle: string; gistId: string }[];
    avatarUrl?: string | null;
    contact?: { label: string; href: string } | null;
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
    artifacts: WorkArtifact[];
    outcomes: WorkOutcome[];
    collectorObserved: number;
    totalArtifacts: number;
    totalOutcomes: number;
  };
  opportunity?: {
    engagementTypes: string[];
    compensation: string | null;
    typicalProjectSize: string | null;
    workArrangement: string | null;
    timezone: string | null;
    responseTime: string | null;
    computeCostRange: string | null;
    note: string;
  };
  efficiency?: {
    cachedSharePct: number | null;
    freshSharePct: number | null;
    outputSharePct: number | null;
    avgTokensPerActiveDay: number | null;
    note: string;
  };
  verification: { label: string; status: VerificationStatus; basis: string }[];
  note: string;
}

export type WorkType = 'repository' | 'deployment' | 'publication' | 'case_study' | 'evaluation' | 'research';
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

export interface WorkOutcome {
  title: string;
  description: string;
  metric: string | null;
  period: string | null;
  verification: 'self_reported';
  basis: string;
}

/** Short, human-facing label for a measurement class. */
export const MEASUREMENT_LABEL: Record<MeasurementClass, string> = {
  provider_reported: 'provider-reported',
  application_reported: 'app-reported',
  collector_derived: 'derived',
  tokenizer_estimated: 'estimated',
  user_submitted: 'self-submitted',
};

export interface SnapshotVerification {
  schemaVersion: string;
  canonicalSchemaVersion?: string;
  snapshotSha256: string | null;
  rawLogsPublished: false;
  gitCommit: string | null;
  proves?: string;
}

/** Claim-bounded signal from the published claimAuthority block. */
export interface ClaimAuthoritySignal {
  signalType: string;
  provenance: string;
  tier: string;
  allowedClaims: string[];
  excludedClaims: string[];
  confidence: 'high' | 'medium' | 'low' | string;
  limitations: string[];
  badgeLabel: string;
  present: boolean;
  explains: string;
}

export interface ClaimAuthorityBlock {
  model: string;
  combinedAuthorityRule: string;
  universalNonClaims: string[];
  tierOrder: string[];
  signals: ClaimAuthoritySignal[];
  note: string;
}

export interface PublicUsageSnapshot {
  generatedAt: string;
  timezone: string;
  source: 'sample' | 'local_mac_sanitized_ccusage';
  collectorVersion: string;
  isSampleData: boolean;
  totals: TokenMetrics;
  providers: Record<string, ProviderSummary>;
  daily: DailyUsage[];
  qiraProjects?: QiraProjectScan[];
  scanner?: {
    rootsChecked: number;
    allowlistedProjects: number;
    foundProjects: number;
    privacyMode: 'allowlist_no_paths';
  };
  warnings: string[];
  measurement?: MeasurementBlock;
  privacy?: PrivacyBlock;
  profile?: ProfileBlock;
  integrity?: { checks: { name: string; status: 'ok' | 'flag'; detail: string }[]; flags: number; note: string };
  verification: SnapshotVerification;
  /** Present on collector ≥0.4 publications. */
  claimAuthority?: ClaimAuthorityBlock;
}

export const sampleSnapshot: PublicUsageSnapshot = {
  generatedAt: '2026-06-16T00:00:00.000Z',
  timezone: 'America/Phoenix',
  source: 'sample',
  collectorVersion: '0.1.0',
  isSampleData: true,
  totals: {
    inputTokens: 2_150_000,
    outputTokens: 74_250_000,
    cacheCreationTokens: 16_000_000,
    cacheReadTokens: 27_860_731_000,
    cachedTokens: 27_876_731_000,
    freshTokens: 76_400_000,
    totalTokens: 27_953_131_000,
    estimatedCostUsd: 25345.26
  },
  providers: {},
  daily: [],
  qiraProjects: [
    { name: 'Qira Main', category: 'Company Surface', status: 'public', publicUrl: 'https://imagineqira.com', description: 'Primary Qira research and product site.', found: false, stack: [], scripts: [], fileCounts: {}, lastModified: null, scannerWarnings: [] },
    { name: 'LOLM', category: 'Research', status: 'research', description: 'Latent Order Language Model architecture and validation work.', found: false, stack: [], scripts: [], fileCounts: {}, lastModified: null, scannerWarnings: [] },
    { name: 'NFET / QEV', category: 'Research', status: 'research', description: 'Verification, encryption, and proof-layer experiments.', found: false, stack: [], scripts: [], fileCounts: {}, lastModified: null, scannerWarnings: [] },
    { name: 'My Digital', category: 'Product', status: 'shipping', publicUrl: 'https://mydigital.imagineqira.com', description: 'QEV-backed digital goods and licensing surface.', found: false, stack: [], scripts: [], fileCounts: {}, lastModified: null, scannerWarnings: [] },
    { name: 'Codey', category: 'Product', status: 'shipping', publicUrl: 'https://codey.imagineqira.com', description: 'Qira builder and agent-product workspace.', found: false, stack: [], scripts: [], fileCounts: {}, lastModified: null, scannerWarnings: [] },
    { name: 'PTI', category: 'Intelligence', status: 'active', publicUrl: 'https://pti.imagineqira.com', description: 'Phoenix traffic intelligence surface.', found: false, stack: [], scripts: [], fileCounts: {}, lastModified: null, scannerWarnings: [] },
    { name: 'Question', category: 'Public Experiment', status: 'active', publicUrl: 'https://question.imagineqira.com', description: 'Qira question and cognition experiment.', found: false, stack: [], scripts: [], fileCounts: {}, lastModified: null, scannerWarnings: [] },
    { name: 'TOKENS', category: 'Proof Infrastructure', status: 'instrumented', description: 'This public AI-agent usage observatory.', found: false, stack: [], scripts: [], fileCounts: {}, lastModified: null, scannerWarnings: [] }
  ],
  scanner: { rootsChecked: 0, allowlistedProjects: 8, foundProjects: 0, privacyMode: 'allowlist_no_paths' },
  warnings: ['Sample data. Run npm run collect on the local Mac to publish sanitized live metrics.'],
  verification: {
    schemaVersion: '1.0.0',
    snapshotSha256: null,
    rawLogsPublished: false,
    gitCommit: null
  }
};
