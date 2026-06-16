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
  warnings: ['Sample data. Run npm run collect on the local Mac to publish sanitized live metrics.'],
  verification: {
    schemaVersion: '1.0.0',
    snapshotSha256: null,
    rawLogsPublished: false,
    gitCommit: null
  }
};
