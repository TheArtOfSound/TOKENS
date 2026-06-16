import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { QiraProjectScan, scanQiraProjects } from './qiraScanner';

type Provider = 'claude' | 'codex' | 'all' | 'unknown';
type Metrics = { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; cachedTokens: number; freshTokens: number; totalTokens: number; estimatedCostUsd: number | null };
type Daily = Metrics & { date: string; provider: Provider; displayName: string; models: string[] };
type ScannerMeta = { rootsChecked: number; allowlistedProjects: number; foundProjects: number; privacyMode: 'allowlist_no_paths' };
type Snapshot = { generatedAt: string; timezone: string; source: 'local_mac_sanitized_ccusage'; collectorVersion: string; isSampleData: false; totals: Metrics; providers: Record<string, Daily>; daily: Daily[]; qiraProjects: QiraProjectScan[]; scanner: ScannerMeta; warnings: string[]; verification: { schemaVersion: string; snapshotSha256: string | null; rawLogsPublished: false; gitCommit: string | null } };

const VERSION = '0.2.0';
const OUT = path.join(process.cwd(), 'public', 'data');
const LATEST = path.join(OUT, 'latest.json');
const HISTORY = path.join(OUT, 'history.json');
const COMMANDS: Array<{ provider: Provider; args: string[] }> = [
  { provider: 'all', args: ['daily', '--json'] },
  { provider: 'claude', args: ['claude', 'daily', '--json'] },
  { provider: 'codex', args: ['codex', 'daily', '--json'] },
  { provider: 'claude', args: ['claude', 'weekly', '--json'] },
  { provider: 'codex', args: ['codex', 'monthly', '--json'] },
  { provider: 'codex', args: ['codex', 'session', '--json'] },
];

const empty = (): Metrics => ({ inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cachedTokens: 0, freshTokens: 0, totalTokens: 0, estimatedCostUsd: null });
const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const hasDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
const display = (p: Provider) => (p === 'claude' ? 'Claude Code' : p === 'codex' ? 'Codex' : p === 'all' ? 'All agents' : 'Unknown');

function add(a: Metrics, b: Metrics): Metrics {
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens, cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens, cachedTokens: a.cachedTokens + b.cachedTokens, freshTokens: a.freshTokens + b.freshTokens, totalTokens: a.totalTokens + b.totalTokens, estimatedCostUsd: a.estimatedCostUsd === null && b.estimatedCostUsd === null ? null : (a.estimatedCostUsd ?? 0) + (b.estimatedCostUsd ?? 0) };
}

function num(o: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v.replace(/[$,]/g, ''));
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

function models(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
  return [...new Set(list.map(String).map((s) => s.trim()).filter((s) => /^[a-zA-Z0-9._:-]{2,80}$/.test(s)).filter((s) => !s.includes('/') && !s.includes('\\')))].slice(0, 8);
}

function metrics(o: Record<string, unknown>): Metrics {
  const inputTokens = num(o, ['inputTokens', 'input_tokens', 'input', 'tokensInput']);
  const outputTokens = num(o, ['outputTokens', 'output_tokens', 'output', 'tokensOutput']);
  const cacheCreationTokens = num(o, ['cacheCreationTokens', 'cache_creation_tokens', 'cacheWriteTokens', 'cache_write_tokens', 'cacheCreateTokens']);
  const cacheReadTokens = num(o, ['cacheReadTokens', 'cache_read_tokens', 'cachedTokens', 'cached_tokens', 'cacheTokens', 'cache_read', 'cachedInputTokens']);
  const cachedTokens = cacheCreationTokens + cacheReadTokens;
  const freshTokens = inputTokens + outputTokens;
  const totalTokens = num(o, ['totalTokens', 'total_tokens', 'tokensTotal', 'total']) || freshTokens + cachedTokens;
  const cost = num(o, ['estimatedCostUsd', 'totalCost', 'total_cost', 'cost', 'costUsd', 'cost_usd']);
  return { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, cachedTokens, freshTokens, totalTokens, estimatedCostUsd: cost || null };
}

function records(v: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(v)) { for (const x of v) records(x, out); return out; }
  if (!isObj(v)) return out;
  const d = v.date ?? v.day ?? v.timestamp ?? v.createdAt ?? v.lastActivity;
  const shaped = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'totalTokens', 'total_cost', 'totalCost', 'cachedInputTokens'].some((k) => k in v);
  if (hasDate(d) && shaped) out.push(v);
  for (const child of Object.values(v)) records(child, out);
  return out;
}

function run(args: string[]): { ok: true; json: unknown } | { ok: false; warning: string } {
  const bin = process.env.CCUSAGE_BIN || 'ccusage';
  const r = spawnSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error) return { ok: false, warning: `${bin} ${args.join(' ')} failed: ${r.error.message}` };
  if (r.status !== 0) return { ok: false, warning: `${bin} ${args.join(' ')} exited ${r.status}` };
  try { return { ok: true, json: JSON.parse(r.stdout) }; } catch { return { ok: false, warning: `${bin} ${args.join(' ')} did not return parseable JSON` }; }
}

function buildSnapshot(): Snapshot {
  const warnings: string[] = [];
  const byDay = new Map<string, Daily>();
  for (const command of COMMANDS) {
    const result = run(command.args);
    if (!result.ok) { warnings.push(result.warning); continue; }
    const rows = records(result.json);
    if (!rows.length) warnings.push(`ccusage ${command.args.join(' ')} returned JSON but no recognized token records`);
    for (const row of rows) {
      const rawDate = row.date ?? row.day ?? row.timestamp ?? row.createdAt ?? row.lastActivity;
      if (!hasDate(rawDate)) continue;
      const provider = (typeof row.provider === 'string' ? row.provider : command.provider) as Provider;
      if (provider === 'all') continue;
      const m = metrics(row);
      if (!m.totalTokens) continue;
      const key = `${rawDate.slice(0, 10)}:${provider}`;
      const found = byDay.get(key);
      const nextModels = models(row.models ?? row.model ?? row.modelName);
      byDay.set(key, found ? { ...found, ...add(found, m), models: [...new Set([...found.models, ...nextModels])] } : { date: rawDate.slice(0, 10), provider, displayName: display(provider), models: nextModels, ...m });
    }
  }
  const daily = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  const providers: Record<string, Daily> = {};
  for (const d of daily) {
    const cur = providers[d.provider] ?? { date: 'all', provider: d.provider, displayName: d.displayName, models: [], ...empty() };
    providers[d.provider] = { ...cur, ...add(cur, d), models: [...new Set([...cur.models, ...d.models])].slice(0, 10) };
  }
  let totals = empty();
  for (const p of Object.values(providers)) totals = add(totals, p);
  const qiraScan = scanQiraProjects();
  const snapshot: Snapshot = { generatedAt: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown', source: 'local_mac_sanitized_ccusage', collectorVersion: VERSION, isSampleData: false, totals, providers, daily, qiraProjects: qiraScan.projects, scanner: qiraScan.scanner, warnings: warnings.slice(0, 12), verification: { schemaVersion: '1.1.0', snapshotSha256: null, rawLogsPublished: false, gitCommit: process.env.GITHUB_SHA ?? null } };
  const payload = JSON.stringify({ ...snapshot, verification: { ...snapshot.verification, snapshotSha256: null } });
  snapshot.verification.snapshotSha256 = createHash('sha256').update(payload).digest('hex');
  return snapshot;
}

function updateHistory(snapshot: Snapshot) {
  let history: Snapshot[] = [];
  try { const parsed = JSON.parse(readFileSync(HISTORY, 'utf8')); history = Array.isArray(parsed) ? parsed : []; } catch { history = []; }
  history.push(snapshot);
  writeFileSync(HISTORY, `${JSON.stringify(history.slice(-500), null, 2)}\n`);
}

mkdirSync(OUT, { recursive: true });
const snapshot = buildSnapshot();
writeFileSync(LATEST, `${JSON.stringify(snapshot, null, 2)}\n`);
updateHistory(snapshot);
console.log(`Wrote ${LATEST}`);
console.log(`Total tokens: ${snapshot.totals.totalTokens}`);
console.log(`Qira projects found: ${snapshot.scanner.foundProjects}/${snapshot.scanner.allowlistedProjects}`);
if (snapshot.warnings.length) console.warn(`Warnings: ${snapshot.warnings.length}`);
