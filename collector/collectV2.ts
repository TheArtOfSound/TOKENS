import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { scanQiraProjects } from './qiraScanner';

type Provider = 'claude' | 'codex' | 'all' | 'unknown';
type Metrics = { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; cachedTokens: number; freshTokens: number; totalTokens: number; estimatedCostUsd: number | null };
type UsageRow = Metrics & { date: string; provider: Provider; displayName: string; models: string[] };

const OUT_DIR = path.join(process.cwd(), 'public', 'data');
const LATEST = path.join(OUT_DIR, 'latest.json');
const HISTORY = path.join(OUT_DIR, 'history.json');
const VERSION = '0.3.0';

const empty = (): Metrics => ({ inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cachedTokens: 0, freshTokens: 0, totalTokens: 0, estimatedCostUsd: null });
const isObj = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const hasDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value);
const providerLabel = (provider: Provider) => provider === 'claude' ? 'Claude Code' : provider === 'codex' ? 'Codex' : 'Unknown';

function add(a: Metrics, b: Metrics): Metrics {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    freshTokens: a.freshTokens + b.freshTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    estimatedCostUsd: a.estimatedCostUsd === null && b.estimatedCostUsd === null ? null : (a.estimatedCostUsd ?? 0) + (b.estimatedCostUsd ?? 0),
  };
}

function numeric(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/[$,]/g, ''));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function normalizeMetrics(record: Record<string, unknown>): Metrics {
  const inputTokens = numeric(record, ['inputTokens', 'input_tokens', 'input', 'tokensInput']);
  const outputTokens = numeric(record, ['outputTokens', 'output_tokens', 'output', 'tokensOutput']);
  const cacheCreationTokens = numeric(record, ['cacheCreationTokens', 'cache_creation_tokens', 'cacheWriteTokens', 'cache_write_tokens']);
  const cacheReadTokens = numeric(record, ['cacheReadTokens', 'cache_read_tokens', 'cachedTokens', 'cached_tokens', 'cachedInputTokens']);
  const cachedTokens = cacheCreationTokens + cacheReadTokens;
  const freshTokens = inputTokens + outputTokens;
  const totalTokens = numeric(record, ['totalTokens', 'total_tokens', 'tokensTotal', 'total']) || cachedTokens + freshTokens;
  const cost = numeric(record, ['estimatedCostUsd', 'totalCost', 'total_cost', 'cost', 'costUsd']);
  return { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, cachedTokens, freshTokens, totalTokens, estimatedCostUsd: cost || null };
}

function modelNames(value: unknown) {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return [...new Set(raw.map(String).map((item) => item.trim()).filter((item) => /^[a-zA-Z0-9._:-]{2,80}$/.test(item)))].slice(0, 8);
}

function collectCandidateRecords(value: unknown, out: Record<string, unknown>[] = []) {
  if (Array.isArray(value)) {
    for (const child of value) collectCandidateRecords(child, out);
    return out;
  }
  if (!isObj(value)) return out;
  const date = value.date ?? value.day ?? value.timestamp ?? value.createdAt ?? value.lastActivity;
  const hasUsageShape = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'totalTokens', 'totalCost', 'cachedInputTokens'].some((key) => key in value);
  if (hasDate(date) && hasUsageShape) out.push(value);
  for (const child of Object.values(value)) collectCandidateRecords(child, out);
  return out;
}

function runCcusage(args: string[]) {
  const bin = process.env.CCUSAGE_BIN || 'ccusage';
  const result = spawnSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) return { warning: `${bin} ${args.join(' ')} failed: ${result.error.message}` };
  if (result.status !== 0) return { warning: `${bin} ${args.join(' ')} exited ${result.status}` };
  try { return { json: JSON.parse(result.stdout) as unknown }; } catch { return { warning: `${bin} ${args.join(' ')} did not return JSON` }; }
}

function readRows(provider: Provider, args: string[]) {
  const result = runCcusage(args);
  if ('warning' in result) return { rows: [] as UsageRow[], warning: result.warning };
  const rows = collectCandidateRecords(result.json).map((record) => {
    const rawDate = record.date ?? record.day ?? record.timestamp ?? record.createdAt ?? record.lastActivity;
    if (!hasDate(rawDate)) return null;
    const actualProvider = provider === 'all' && typeof record.provider === 'string' ? record.provider as Provider : provider;
    if (actualProvider !== 'claude' && actualProvider !== 'codex') return null;
    const metrics = normalizeMetrics(record);
    if (!metrics.totalTokens) return null;
    return { date: rawDate.slice(0, 10), provider: actualProvider, displayName: providerLabel(actualProvider), models: modelNames(record.models ?? record.model ?? record.modelName), ...metrics };
  }).filter(Boolean) as UsageRow[];
  return { rows };
}

function mergeRows(rows: UsageRow[]) {
  const byDay = new Map<string, UsageRow>();
  for (const row of rows) {
    const key = `${row.date}:${row.provider}`;
    const existing = byDay.get(key);
    byDay.set(key, existing ? { ...existing, ...add(existing, row), models: [...new Set([...existing.models, ...row.models])] } : row);
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function buildSnapshot() {
  const warnings: string[] = [];
  const claude = readRows('claude', ['claude', 'daily', '--json']);
  const codex = readRows('codex', ['codex', 'daily', '--json']);
  if (claude.warning) warnings.push(claude.warning);
  if (codex.warning) warnings.push(codex.warning);
  let daily = mergeRows([...claude.rows, ...codex.rows]);
  if (!daily.length) {
    const fallback = readRows('all', ['daily', '--json']);
    if (fallback.warning) warnings.push(fallback.warning);
    daily = mergeRows(fallback.rows);
  }
  const providers: Record<string, UsageRow> = {};
  for (const row of daily) {
    const current = providers[row.provider] ?? { date: 'all', provider: row.provider, displayName: row.displayName, models: [], ...empty() };
    providers[row.provider] = { ...current, ...add(current, row), models: [...new Set([...current.models, ...row.models])] };
  }
  let totals = empty();
  for (const row of Object.values(providers)) totals = add(totals, row);
  const qira = scanQiraProjects();
  const snapshot = {
    generatedAt: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
    source: 'local_mac_sanitized_ccusage' as const,
    collectorVersion: VERSION,
    isSampleData: false,
    totals,
    providers,
    daily,
    qiraProjects: qira.projects,
    scanner: qira.scanner,
    warnings: warnings.slice(0, 12),
    verification: { schemaVersion: '1.1.0', snapshotSha256: null as string | null, rawLogsPublished: false as const, gitCommit: process.env.GITHUB_SHA ?? null },
  };
  snapshot.verification.snapshotSha256 = createHash('sha256').update(JSON.stringify({ ...snapshot, verification: { ...snapshot.verification, snapshotSha256: null } })).digest('hex');
  return snapshot;
}

mkdirSync(OUT_DIR, { recursive: true });
const snapshot = buildSnapshot();
writeFileSync(LATEST, `${JSON.stringify(snapshot, null, 2)}\n`);
let history: unknown[] = [];
try { const parsed = JSON.parse(readFileSync(HISTORY, 'utf8')); history = Array.isArray(parsed) ? parsed : []; } catch { history = []; }
history.push(snapshot);
writeFileSync(HISTORY, `${JSON.stringify(history.slice(-500), null, 2)}\n`);
console.log(`Wrote ${LATEST}`);
console.log(`Total tokens: ${snapshot.totals.totalTokens}`);
console.log(`Qira projects found: ${snapshot.scanner.foundProjects}/${snapshot.scanner.allowlistedProjects}`);
