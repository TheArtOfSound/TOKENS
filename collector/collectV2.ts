/**
 * TOKENS collector CLI (authoritative entry point for `npm run collect`).
 *
 * Strangler migration: the PUBLIC JSON contract is preserved, but the snapshot is
 * now assembled through the canonical pipeline in ./lib:
 *   ccusage (I/O)  ->  normalize (pure)  ->  assembleDraft (pure)
 *                  ->  publishSnapshot (allowlist transform)  ->  fail-closed scan
 *                  ->  idempotency check  ->  write latest.json + compact history.json
 *
 * Safety properties:
 *  - Fail closed: if the constructed public object contains ANY prohibited
 *    pattern, we throw and write nothing.
 *  - Idempotent: if the usage data is unchanged, we do not rewrite files (so the
 *    launchd job does not produce a no-op commit every 30 minutes).
 *  - No clobber: a transient ccusage failure that yields zero rows never
 *    overwrites a good existing snapshot with an empty one.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { scanQiraProjects } from './qiraScanner';
import { assembleDraft, type RawSource } from './lib/snapshot';
import { computeContentHash, publishSnapshot, type PublishedSnapshot } from './lib/publish';
import { buildCompactHistory } from './lib/history';
import { scanForProhibited } from './lib/secretScan';

const OUT_DIR = path.join(process.cwd(), 'public', 'data');
const LATEST = path.join(OUT_DIR, 'latest.json');
const HISTORY = path.join(OUT_DIR, 'history.json');

const PROVIDERS: Array<{ provider: 'claude' | 'codex'; args: string[] }> = [
  { provider: 'claude', args: ['claude', 'daily', '--json'] },
  { provider: 'codex', args: ['codex', 'daily', '--json'] },
];

function runCcusage(args: string[]): { json: unknown } | { warning: string } {
  const bin = process.env.CCUSAGE_BIN || 'ccusage';
  const result = spawnSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  if (result.error) return { warning: `${bin} ${args.join(' ')} failed: ${result.error.message}` };
  if (result.status !== 0) return { warning: `${bin} ${args.join(' ')} exited ${result.status}` };
  try {
    return { json: JSON.parse(result.stdout) as unknown };
  } catch {
    return { warning: `${bin} ${args.join(' ')} did not return parseable JSON` };
  }
}

function readExistingLatest(): PublishedSnapshot | null {
  if (!existsSync(LATEST)) return null;
  try {
    return JSON.parse(readFileSync(LATEST, 'utf8')) as PublishedSnapshot;
  } catch {
    return null;
  }
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });

  const sources: RawSource[] = PROVIDERS.map(({ provider, args }) => {
    const result = runCcusage(args);
    if ('warning' in result) return { provider, json: null, failureWarning: result.warning };
    return { provider, json: result.json };
  });

  const qira = scanQiraProjects();

  const { draft, daily } = assembleDraft({
    sources,
    generatedAt: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
    qiraProjects: qira.projects,
    scanner: qira.scanner,
    gitCommit: process.env.GITHUB_SHA ?? null,
  });

  const existing = readExistingLatest();

  // No-clobber: never replace good published data with an empty snapshot caused
  // by a transient ccusage failure.
  if (daily.length === 0 && existing && Array.isArray(existing.daily) && existing.daily.length > 0) {
    console.warn('All usage sources returned no rows; keeping the existing snapshot (no clobber).');
    console.warn(`Warnings: ${draft.warnings.join(' | ') || 'none'}`);
    return;
  }

  const { published, dropped } = publishSnapshot(draft);

  // Fail closed: the constructed public object must contain no prohibited content.
  const findings = scanForProhibited(published);
  if (findings.length > 0) {
    console.error(`Refusing to write: ${findings.length} prohibited pattern(s) in the constructed snapshot:`);
    for (const finding of findings.slice(0, 10)) console.error(`  - ${finding.label} at ${finding.path} (${finding.excerpt})`);
    process.exitCode = 1;
    return;
  }

  // Idempotency: if the usage content is unchanged, do not rewrite files.
  if (existing && computeContentHash(existing) === computeContentHash(published)) {
    console.log('No usage-data change since last snapshot; nothing written.');
    return;
  }

  writeFileSync(LATEST, `${JSON.stringify(published, null, 2)}\n`);
  const history = buildCompactHistory(daily, published.generatedAt);
  writeFileSync(HISTORY, `${JSON.stringify(history, null, 2)}\n`);

  console.log(`Wrote ${LATEST}`);
  console.log(`Exact total tokens: ${published.measurement.exactTotalTokens}`);
  console.log(`History points: ${history.pointCount} (through ${history.updatedThrough ?? 'n/a'})`);
  console.log(`Qira projects found: ${published.scanner.foundProjects}/${published.scanner.allowlistedProjects}`);
  if (dropped.length) console.warn(`Dropped ${dropped.length} unsafe free-form value(s) during publication.`);
  if (published.warnings.length) console.warn(`Warnings: ${published.warnings.length}`);
}

main();
