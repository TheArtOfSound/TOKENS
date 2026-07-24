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
import { readLedgerDaily } from './lib/ledgerSource';
import { computeContentHash, publishSnapshot, type PublishedSnapshot } from './lib/publish';
import { buildCompactHistory } from './lib/history';
import { scanForProhibited } from './lib/secretScan';
import { detectAnomalies } from './lib/anomaly';
import { buildClaimAuthority } from './lib/claims';
import { renderBadge } from './lib/badge';
import { buildProfile, type ProfileIdentity, type WorkConfig, type OpportunityConfig } from './lib/profile';
import { isSourceEnabled, loadConsent } from './lib/consent';
import { loadOrCreateDeviceKey, loadRevocations, signSnapshot, verifySnapshot, recordKeySeen, buildPublicKeyHistory } from './lib/signing';
import { randomUUID } from 'node:crypto';

const OUT_DIR = path.join(process.cwd(), 'public', 'data');
const LATEST = path.join(OUT_DIR, 'latest.json');
const HISTORY = path.join(OUT_DIR, 'history.json');
const PROFILE_CONFIG = path.join(process.cwd(), 'profile', 'profile.json');
const WORK_CONFIG = path.join(process.cwd(), 'profile', 'work.json');
const REGISTRY = path.join(process.cwd(), 'public', 'data', 'profiles', 'index.json');

/**
 * Refresh this member's own registry entry from profile.json.
 *
 * Only the operator's entry is touched — other members' entries point at
 * snapshots hosted elsewhere and must never be rewritten by someone else's
 * collector run.
 */
function syncRegistryEntry(identity: ProfileIdentity, generatedAt: string): void {
  try {
    const registry = JSON.parse(readFileSync(REGISTRY, 'utf8')) as {
      members?: Array<Record<string, unknown>>;
      updatedAt?: string;
    };
    if (!Array.isArray(registry.members)) return;
    const mine = registry.members.find((m) => m.operator === true);
    if (!mine) return;
    mine.displayName = identity.displayName;
    mine.headline = identity.headline;
    mine.location = identity.location ?? null;
    mine.availability = identity.availability ?? null;
    mine.workCategories = identity.workCategories ?? [];
    if (Array.isArray(identity.links)) mine.links = identity.links;
    registry.updatedAt = generatedAt;
    writeFileSync(REGISTRY, `${JSON.stringify(registry, null, 2)}\n`);
  } catch {
    /* the registry is optional; never fail a collection over it */
  }
}

/** Read the self-submitted profile identity (profile/profile.json). Safe defaults if absent. */
function readProfileConfig(): ProfileIdentity {
  const fallback: ProfileIdentity = {
    displayName: 'Qira',
    headline: 'Local AI-agent work ledger',
    workCategories: [],
    openTo: [],
    links: [],
  };
  try {
    const parsed = JSON.parse(readFileSync(PROFILE_CONFIG, 'utf8')) as Partial<ProfileIdentity>;
    if (parsed && typeof parsed.displayName === 'string' && typeof parsed.headline === 'string') {
      return { ...fallback, ...parsed } as ProfileIdentity;
    }
  } catch {
    /* fall through to defaults */
  }
  return fallback;
}

/** Read self-submitted work artifacts and outcomes (profile/work.json). */
function readWorkConfig(): WorkConfig {
  try {
    const parsed = JSON.parse(readFileSync(WORK_CONFIG, 'utf8')) as WorkConfig;
    return {
      artifacts: Array.isArray(parsed?.artifacts) ? parsed.artifacts : [],
      outcomes: Array.isArray(parsed?.outcomes) ? parsed.outcomes : [],
    };
  } catch {
    return { artifacts: [], outcomes: [] };
  }
}

const OPPORTUNITY_CONFIG = path.join(process.cwd(), 'profile', 'opportunity.json');

/** Read self-declared availability, engagement, and compensation preferences. */
function readOpportunityConfig(): OpportunityConfig {
  try {
    const parsed = JSON.parse(readFileSync(OPPORTUNITY_CONFIG, 'utf8')) as OpportunityConfig;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * `--offline` uses ccusage's cached pricing table instead of fetching it.
 *
 * Two reasons this is the default:
 *  - Local-first. A collector that reads local logs should not make network
 *    calls; the fetch is the only egress in the whole pipeline.
 *  - Reliability. A measured run stalled for ~4 minutes at 4% CPU waiting on
 *    that fetch. Offline is ~0.9s versus ~2.2s and cannot hang.
 *
 * Cost figures are estimates either way and are labeled `estimated` in the
 * published data. Set TOKENS_CCUSAGE_ONLINE=1 to fetch live pricing instead.
 */
const OFFLINE_ARGS = process.env.TOKENS_CCUSAGE_ONLINE === '1' ? [] : ['--offline'];

const PROVIDERS: Array<{ provider: 'claude' | 'codex'; args: string[] }> = [
  { provider: 'claude', args: ['claude', 'daily', '--json', ...OFFLINE_ARGS] },
  { provider: 'codex', args: ['codex', 'daily', '--json', ...OFFLINE_ARGS] },
];

function runCcusage(args: string[]): { json: unknown } | { warning: string } {
  const bin = process.env.CCUSAGE_BIN || 'ccusage';
  // Hard timeout: a wedged provider CLI must never stall the collector. The
  // no-clobber path keeps the previous good snapshot if this trips.
  const timeoutMs = Number(process.env.TOKENS_CCUSAGE_TIMEOUT_MS ?? 60_000);
  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
  });
  if (result.error) {
    const timedOut = (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
    return {
      warning: timedOut
        ? `${bin} ${args.join(' ')} timed out after ${timeoutMs}ms`
        : `${bin} ${args.join(' ')} failed: ${result.error.message}`,
    };
  }
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

  const { config: consent, created: consentCreated } = loadConsent();
  if (consentCreated) {
    console.log('Created profile/consent.json (all sources enabled, matching existing behavior).');
    console.log('Run `npm run consent` to see exactly what each source reads, and to turn any of it off.');
  }

  // A source the user disabled is never invoked -- not read then filtered.
  const sources: RawSource[] = PROVIDERS.map(({ provider, args }) => {
    if (!isSourceEnabled(consent, provider)) {
      return { provider, json: null, failureWarning: `${provider} source disabled by consent; not read` };
    }
    const result = runCcusage(args);
    if ('warning' in result) return { provider, json: null, failureWarning: result.warning };
    return { provider, json: result.json };
  });

  const qira = isSourceEnabled(consent, 'projectScan')
    ? scanQiraProjects()
    : { projects: [], scanner: { rootsChecked: 0, allowlistedProjects: 0, foundProjects: 0, privacyMode: 'allowlist_no_paths' as const }, stats: { reusedFromCheckpoint: 0, rescanned: 0, fullDiscovery: false } };

  // Source of truth is the event ledger. ccusage remains the fallback when the
  // ledger has not been populated yet (`npm run ingest`).
  const ledgerData = process.env.TOKENS_SOURCE === 'ccusage'
    ? { rows: [], warnings: ['Forced ccusage source via TOKENS_SOURCE=ccusage.'], eventCount: 0, providerConfidence: {}, imported: [] }
    : readLedgerDaily();
  if (ledgerData.rows.length) {
    console.log(`Sourcing from event ledger: ${ledgerData.eventCount} events, ${ledgerData.rows.length} day-rows.`);
  } else {
    console.log('Event ledger unavailable or empty; falling back to ccusage.');
  }

  const { draft, daily } = assembleDraft({
    sources,
    preNormalizedRows: ledgerData.rows,
    extraWarnings: ledgerData.warnings,
    generatedAt: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
    qiraProjects: qira.projects,
    scanner: qira.scanner,
    gitCommit: process.env.GITHUB_SHA ?? null,
  });

  draft.profile = buildProfile(
    readProfileConfig(),
    daily,
    draft.providers,
    draft.generatedAt.slice(0, 10),
    qira.projects,
    readWorkConfig(),
    readOpportunityConfig(),
  );

  draft.consent = consent;
  draft.imported = ledgerData.imported;
  syncRegistryEntry(readProfileConfig(), draft.generatedAt);
  draft.sourceOfTruth = ledgerData.rows.length ? 'event_ledger' : 'ccusage_aggregate';
  draft.providerConfidence = ledgerData.providerConfidence;

  const existing = readExistingLatest();

  // Integrity checks over the measured series, compared to the previous snapshot
  // to catch large retroactive backfills. Flags, never accuses.
  draft.integrity = detectAnomalies(
    daily,
    draft.generatedAt.slice(0, 10),
    (existing?.daily as unknown as typeof daily) ?? [],
  );

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

  // Sign the snapshot with the device key. The signature covers every byte of
  // the published object except the signature block itself, over canonical JSON
  // so a non-JavaScript verifier can reproduce it.
  const key = loadOrCreateDeviceKey();
  if (key.created) {
    console.log(`Generated a new Ed25519 device key (stored in ${key.storage}). The private key never leaves this machine.`);
  }
  const signed: Record<string, unknown> = { ...published };
  signed.signature = signSnapshot(signed, key.privateKeyPem, randomUUID());

  // Verify what we are about to publish, using only the embedded public key.
  const check = verifySnapshot(signed);
  if (!check.valid) {
    console.error(`Refusing to write: self-verification failed (${check.reason}).`);
    process.exitCode = 1;
    return;
  }

  // Revocations are published as a SEPARATE file, deliberately. Embedding them
  // in the snapshot would be circular: whoever holds a compromised key could
  // sign a snapshot carrying an empty revocation list.
  writeFileSync(
    path.join(OUT_DIR, 'revoked-keys.json'),
    `${JSON.stringify({ updatedAt: signed.generatedAt, revoked: loadRevocations() }, null, 2)}\n`,
  );

  // Key history: a rotated key still verifies its own past snapshots; a revoked
  // key changes their trust interpretation without erasing them. Published so any
  // verifier can interpret a snapshot's signing key without contacting us.
  const sig = signed.signature as { keyId: string; publicKey: string };
  recordKeySeen(sig.keyId, sig.publicKey, published.generatedAt);
  writeFileSync(
    path.join(OUT_DIR, 'key-history.json'),
    `${JSON.stringify(buildPublicKeyHistory(sig.keyId, sig.publicKey, published.generatedAt), null, 2)}\n`,
  );

  // Claim-authority ladder: static reference for what every badge can and cannot
  // establish. Published so a reader (or an employer) can hold the profile to it.
  writeFileSync(
    path.join(OUT_DIR, 'claim-authority.json'),
    `${JSON.stringify(buildClaimAuthority(), null, 2)}\n`,
  );

  // Embeddable badge for a README / personal site. Reports ACTIVE DAYS, never
  // token volume — a token count on a README is the vanity metric this project
  // exists to avoid.
  writeFileSync(
    path.join(OUT_DIR, 'badge.svg'),
    renderBadge({ activeDays: published.profile?.activity.activeDays ?? 0 }),
  );

  writeFileSync(LATEST, `${JSON.stringify(signed, null, 2)}\n`);
  const history = buildCompactHistory(daily, published.generatedAt);
  writeFileSync(HISTORY, `${JSON.stringify(history, null, 2)}\n`);

  console.log(`Wrote ${LATEST}`);
  console.log(`Exact total tokens: ${published.measurement.exactTotalTokens}`);
  console.log(`History points: ${history.pointCount} (through ${history.updatedThrough ?? 'n/a'})`);
  console.log(`Qira projects found: ${published.scanner.foundProjects}/${published.scanner.allowlistedProjects}`);
  console.log(`Signed with device key ${(signed.signature as { keyId: string }).keyId} (${key.storage}); self-verification passed.`);
  if (dropped.length) console.warn(`Dropped ${dropped.length} unsafe free-form value(s) during publication.`);
  if (published.warnings.length) console.warn(`Warnings: ${published.warnings.length}`);
}

main();
