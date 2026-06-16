import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const COLLECTOR_VERSION = '0.1.0';
const OUT_DIR = path.join(process.cwd(), 'public', 'data');
const LATEST_PATH = path.join(OUT_DIR, 'latest.json');
const HISTORY_PATH = path.join(OUT_DIR, 'history.json');

type Provider = 'claude' | 'codex' | 'all' | 'unknown';

type Metrics = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cachedTokens: number;
  freshTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
};

type Daily = Metrics & {
  date: string;
  provider: Provider;
  displayName: string;
  models: string[];
};

type ProviderSummary = Metrics & {
  provider: Provider;
  displayName: string;
  models: string[];
};

type PublicSnapshot = {
  generatedAt: string;
  timezone: string;
  source: 'local_mac_sanitized_ccusage';
  collectorVersion: string;
  isSampleData: false;
  totals: Metrics;
  providers: Record<string, ProviderSummary>;
  daily: Daily[];
  warnings: string[];
  verification: {
    schemaVersion: string;
    snapshotSha256: string | null;
    rawLogsPublished: false;
    gitCommit: string | null;
  };
};

const commands: Array<{ provider: Provider; args: string[] }> = [
  { provider: 'all', args: ['daily', '--json'] },
  { provider: 'claude', args: ['claude', 'daily', '--json'] },
  { provider: 'codex', args: ['codex', 'daily', '--json'] },
  { provider: 'all', args: ['monthly', '--json'] },
  { provider: 'all', args: ['session', '--json'] },
];

const emptyMetrics = (): Metrics => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  cachedTokens: 0,
  freshTokens: 0,
  totalTokens: 0,
  estimatedCostUsd: null,
});

function add(a: Metrics, b: Metrics): Metrics {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    freshTokens: a.freshTokens + b.freshTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    estimatedCostUsd:
      a.estimatedCostUsd === null && b.estimatedCostUsd === null
        ? null
        : (a.estimatedCostUsd ?? 0) + (b.estimatedCostUsd ?? 0),
  };
}

function numberAt(obj: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/[$,]/g, ''));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function nullableNumberAt(obj: Record<string, unknown>, keys: string[]): number | null {
  const value = numberAt(obj, keys);
  return value === 0 ? null : value;
}

function safeModels(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return [...new Set(raw
    .map(String)
    .map((model) => model.trim())
    .filter((model) => /^[a-zA-Z0-9._:-]{2,80}$/.test(model))
    .filter((model) => !model.includes('/') && !model.includes('\\'))
  )].slice(0, 8);
}

function normalizeMetrics(obj: Record<string, unknown>): Metrics {
  const inputTokens = numberAt(obj, ['inputTokens', 'input_tokens', 'input', 'tokensInput']);
  const outputTokens = numberAt(obj, ['outputTokens', 'output_tokens', 'output', 'tokensOutput']);
  const cacheCreationTokens = numberAt(obj, ['cacheCreationTokens', 'cache_creation_tokens', 'cacheWriteTokens', 'cache_write_tokens', 'cacheCreateTokens']);
  const cacheReadTokens = numberAt(obj, ['cacheReadTokens', 'cache_read_tokens', 'cachedTokens', 'cached_tokens', 'cacheTokens', 'cache_read']);
  const publishedCached = cacheCreationTokens + cacheReadTokens;
  const totalFromRecord = numberAt(obj, ['totalTokens', 'total_tokens', 'tokensTotal', 'total']);
  const freshTokens = inputTokens + outputTokens;
  const totalTokens = totalFromRecord || freshTokens + publishedCached;

  return {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    cachedTokens: publishedCached,
    freshTokens,
    totalTokens,
    estimatedCostUsd: nullableNumberAt(obj, ['estimatedCostUsd', 'totalCost', 'total_cost', 'cost', 'costUsd', 'cost_usd']),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value);
}

function collectRecords(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, out);
    return out;
  }
  if (!isRecord(value)) return out;

  const date = value.date ?? value.day ?? value.timestamp ?? value.createdAt;
  const hasTokenShape = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'totalTokens', 'total_cost', 'totalCost'].some((key) => key in value);
  if (hasDate(date) && hasTokenShape) out.push(value);

  for (const child of Object.values(value)) collectRecords(child, out);
  return out;
}

function providerName(provider: Provider): string {
  if (provider === 'claude') return 'Claude Code';
  if (provider === 'codex') return 'Codex';
  if (provider === 'all') return 'All agents';
  return 'Unknown';
}

function runCcusage(args: string[]): { ok: true; json: unknown } | { ok: false; error: string } {
  const bin = process.env.CCUSAGE_BIN || 'ccusage';
  const result = spawnSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) return { ok: false, error: `${bin} ${args.join(' ')} failed: ${result.error.message}` };
  if (result.status !== 0) return { ok: false, error: `${bin} ${args.join(' ')} exited ${result.status}` };
  try {
    return { ok: true, json: JSON.parse(result.stdout) };
  } catch {
    return { ok: false, error: `${bin} ${args.join(' ')} did not return parseable JSON` };
  }
}

function makeSnapshot(): PublicSnapshot {
  const warnings: string[] = [];
  const byKey = new Map<string, Daily>();

  for (const command of commands) {
    const result = runCcusage(command.args);
    if (!result.ok) {
      warnings.push(result.error);
      continue;
    }

    const records = collectRecords(result.json);
    if (!records.length) {
      warnings.push(`ccusage ${command.args.join(' ')} returned JSON but no daily token records were recognized`);
      continue;
    }

    for (const record of records) {
      const rawDate = record.date ?? record.day ?? record.timestamp ?? record.createdAt;
      if (!hasDate(rawDate)) continue;
      const date = rawDate.slice(0, 10);
      const provider = (typeof record.provider === 'string' ? record.provider : command.provider) as Provider;
      if (provider === 'all') continue;
      const metrics = normalizeMetrics(record);
      if (!metrics.totalTokens) continue;
      const key = `${date}:${provider}`;
      const models = safeModels(record.models ?? record.model ?? record.modelName);
      const existing = byKey.get(key);
      byKey.set(key, existing ? { ...existing, ...add(existing, metrics), models: [...new Set([...existing.models, ...models])] } : {
        date,
        provider,
        displayName: providerName(provider),
        models,
        ...metrics,
      });
    }
  }

  const daily = [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date));
  const providers: Record<string, ProviderSummary> = {};
  for (const day of daily) {
    const current = providers[day.provider] ?? { provider: day.provider, displayName: day.displayName, models: [], ...emptyMetrics() };
    providers[day.provider] = {
      ...current,
      ...add(current, day),
      models: [...new Set([...current.models, ...day.models])].slice(0, 10),
    };
  }

  let totals = emptyMetrics();
  for (const provider of Object.values(providers)) totals = add(totals, provider);

  const snapshot: PublicSnapshot = {
    generatedAt: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
    source: 'local_mac_sanitized_ccusage',
    collectorVersion: COLLECTOR_VERSION,
    isSampleData: false,
    totals,
    providers,
    daily,
    warnings: warnings.slice(0, 12),
    verification: {
      schemaVersion: '1.0.0',
      snapshotSha256: null,
      rawLogsPublished: false,
      gitCommit: process.env.GITHUB_SHA ?? null,
    },
  };

  const hashInput = JSON.stringify({ ...snapshot, verification: { ...snapshot.verification, snapshotSha256: null } });
  snapshot.verification.snapshotSha256 = createHash('sha256').update(hashInput).digest('hex');
  return snapshot;
}

function updateHistory(snapshot: PublicSnapshot): void {
  let history: PublicSnapshot[] = [];
  try {
    history = JSON.parse(readFileSync(HISTORY_PATH, 'utf8')) as PublicSnapshot[];
    if (!Array.isArray(history)) history = [];
  } catch {
    history = [];
  }
  history.push(snapshot);
  history = history.slice(-500);
  writeFileSync(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`);
}

mkdirSync(OUT_DIR, { recursive: true });
const snapshot = makeSnapshot();
writeFileSync(LATEST_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
updateHistory(snapshot);
console.log(`Wrote ${LATEST_PATH}`);
console.log(`Total tokens: ${snapshot.totals.totalTokens}`);
if (snapshot.warnings.length) console.warn(`Warnings: ${snapshot.warnings.length}`);
