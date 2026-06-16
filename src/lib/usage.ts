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

export interface SnapshotVerification {
  schemaVersion: string;
  snapshotSha256: string | null;
  rawLogsPublished: false;
  gitCommit: string | null;
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
  verification: SnapshotVerification;
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
