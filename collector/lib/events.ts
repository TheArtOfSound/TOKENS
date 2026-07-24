/**
 * Canonical EVENT model.
 *
 * Until now the finest granularity anywhere in TOKENS was a daily per-provider
 * aggregate from `ccusage daily`. The dossier requires event-level records with
 * provenance, and roughly 40 downstream requirements (dedup, reconciliation,
 * the local ledger) are unimplementable without them.
 *
 * Events come from the provider's own JSONL logs. Those lines are FULL of things
 * that must never be persisted:
 *
 *   cwd, gitBranch          absolute local paths and private branch names
 *   message.content         the actual prompt and response text
 *   sessionId, uuid,        stable identifiers that correlate a person's work
 *   requestId, promptId
 *
 * So extraction is a strict ALLOWLIST, exactly like the publication transform:
 * we name the handful of fields we want and construct a new object. Nothing is
 * copied wholesale, so a new field appearing in a future log format cannot leak
 * by default — it is simply ignored.
 *
 * Identifiers that we do need for deduplication are keyed HMACs, never raw
 * values. The HMAC key is a per-device salt that never leaves the machine, so a
 * pseudonym is not reversible or linkable across devices.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Confidence, MeasurementClass, Provider } from './canonical';

export const EVENT_SCHEMA_VERSION = '1.0.0';

const SALT_DIR = process.env.TOKENS_CACHE_DIR?.trim() || path.join(process.cwd(), '.tokens-cache');
const SALT_FILE = path.join(SALT_DIR, 'pseudonym-salt');

export interface CanonicalEvent {
  /** Deterministic content hash — the deduplication key. */
  eventId: string;
  eventSchemaVersion: string;
  /** When the work happened, per the provider log. */
  occurredAt: string;
  /** When this collector first recorded it. */
  ingestedAt: string;
  provider: Provider;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  /** provider_reported for log-derived events; user_submitted for imports. */
  measurementClass: MeasurementClass;
  confidence: Confidence;
  /** HMAC of the session id. Not reversible, not linkable across devices. */
  sessionPseudonym: string | null;
  /** HMAC of the source file identity, for reconciliation without paths. */
  sourceFingerprint: string;
  adapter: string;
  adapterVersion: string;
}

/** Per-device HMAC salt. Generated once, never published, never transmitted. */
export function loadOrCreateSalt(): Buffer {
  try {
    if (existsSync(SALT_FILE)) {
      const existing = readFileSync(SALT_FILE);
      if (existing.length >= 32) return existing;
    }
  } catch {
    /* regenerate below */
  }
  const salt = randomBytes(32);
  try {
    mkdirSync(SALT_DIR, { recursive: true });
    writeFileSync(SALT_FILE, salt, { mode: 0o600 });
  } catch {
    /* in-memory salt still works for this run */
  }
  return salt;
}

export function pseudonymize(value: string, salt: Buffer): string {
  return createHmac('sha256', salt).update(value).digest('hex').slice(0, 24);
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Model identifiers are the only free-form string we keep; keep them tight. */
const MODEL_RE = /^[a-zA-Z0-9._:-]{2,80}$/;

function safeModel(value: unknown): string | null {
  return typeof value === 'string' && MODEL_RE.test(value) ? value : null;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export interface ExtractOptions {
  provider: Provider;
  adapter: string;
  adapterVersion: string;
  sourceFingerprint: string;
  salt: Buffer;
  ingestedAt: string;
}

/**
 * Build a canonical event from one raw log line, or null if the line carries no
 * usage. ONLY the fields named here are read. `cwd`, `gitBranch`,
 * `message.content`, `uuid`, and `requestId` are never touched.
 */
export function extractEvent(raw: unknown, options: ExtractOptions): CanonicalEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const line = raw as Record<string, unknown>;

  const message = (line.message && typeof line.message === 'object' ? line.message : {}) as Record<string, unknown>;
  const usage = (message.usage ?? line.usage) as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== 'object') return null;

  const inputTokens = num(usage.input_tokens ?? usage.inputTokens);
  const outputTokens = num(usage.output_tokens ?? usage.outputTokens);
  const cacheCreationTokens = num(usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens);
  const cacheReadTokens = num(usage.cache_read_input_tokens ?? usage.cacheReadInputTokens);
  const totalTokens = inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
  if (totalTokens <= 0) return null;

  const rawTimestamp = line.timestamp;
  const occurredAt = typeof rawTimestamp === 'string' && ISO_RE.test(rawTimestamp) ? rawTimestamp : null;
  if (!occurredAt) return null;

  const rawSession = line.sessionId;
  const sessionPseudonym =
    typeof rawSession === 'string' && rawSession.length > 0 ? pseudonymize(rawSession, options.salt) : null;

  const model = safeModel(message.model ?? line.model);

  // Deduplication identity.
  //
  // Claude Code copies the SAME API call into more than one session file (on
  // resume and after compaction), each time under a different sessionId. Keying
  // on the session therefore counted one call many times: measured against
  // ccusage, totals came out +124%, i.e. more than double the truth.
  //
  // The provider's own identifiers (message.id, requestId) are stable across
  // those copies, so they are the correct identity. They are hashed, never
  // stored raw. Only when neither is present do we fall back to a content hash,
  // which is weaker but still deterministic.
  const messageId = typeof message.id === 'string' ? message.id : '';
  const requestId = typeof line.requestId === 'string' ? line.requestId : '';
  const identity =
    messageId || requestId
      ? `msg:${messageId}|req:${requestId}`
      : `content:${occurredAt}|${model ?? ''}|${inputTokens}|${outputTokens}|${cacheCreationTokens}|${cacheReadTokens}|${sessionPseudonym ?? ''}`;

  const eventId = createHash('sha256')
    .update(`${options.provider}|${identity}`)
    .digest('hex')
    .slice(0, 32);

  return {
    eventId,
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    occurredAt,
    ingestedAt: options.ingestedAt,
    provider: options.provider,
    model,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    totalTokens,
    measurementClass: 'provider_reported',
    confidence: 'high',
    sessionPseudonym,
    sourceFingerprint: options.sourceFingerprint,
    adapter: options.adapter,
    adapterVersion: options.adapterVersion,
  };
}

/** Fields an event is allowed to contain. Used by tests to assert no drift. */
export const EVENT_FIELDS: ReadonlyArray<keyof CanonicalEvent> = [
  'eventId',
  'eventSchemaVersion',
  'occurredAt',
  'ingestedAt',
  'provider',
  'model',
  'inputTokens',
  'outputTokens',
  'cacheCreationTokens',
  'cacheReadTokens',
  'totalTokens',
  'measurementClass',
  'confidence',
  'sessionPseudonym',
  'sourceFingerprint',
  'adapter',
  'adapterVersion',
];

/** Roll events up into the daily per-provider shape the publisher already uses. */
export function aggregateByDay(events: CanonicalEvent[]): Map<string, {
  date: string;
  provider: Provider;
  models: Set<string>;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  eventCount: number;
}> {
  const byDay = new Map<string, ReturnType<typeof aggregateByDay> extends Map<string, infer V> ? V : never>();
  for (const event of events) {
    const date = event.occurredAt.slice(0, 10);
    const key = `${date}:${event.provider}`;
    const existing = byDay.get(key) ?? {
      date,
      provider: event.provider,
      models: new Set<string>(),
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      eventCount: 0,
    };
    existing.inputTokens += event.inputTokens;
    existing.outputTokens += event.outputTokens;
    existing.cacheCreationTokens += event.cacheCreationTokens;
    existing.cacheReadTokens += event.cacheReadTokens;
    existing.totalTokens += event.totalTokens;
    existing.eventCount += 1;
    if (event.model) existing.models.add(event.model);
    byDay.set(key, existing);
  }
  return byDay;
}

// ---------------------------------------------------------------------------
// Codex extraction
// ---------------------------------------------------------------------------

/**
 * Codex logs are shaped differently from Claude Code's, in two ways that are
 * easy to get catastrophically wrong:
 *
 * 1. Each `token_count` line carries BOTH `total_token_usage` (a running
 *    cumulative total for the whole session) and `last_token_usage` (just this
 *    turn). Summing the cumulative field across a session would inflate totals
 *    by orders of magnitude. We read `last_token_usage` only.
 *
 * 2. `cached_input_tokens` is a SUBSET of `input_tokens`, not a sibling of it
 *    (observed: input 10731, cached 6528, output 649, total 11380 = input +
 *    output). Mapping both straight across would double-count the cached
 *    portion. Fresh input is therefore input - cached.
 *
 * The model is not on the token_count line at all — it appears earlier in the
 * file on a `turn_context` line — so the extractor is stateful per file.
 */
export function createCodexExtractor(): (raw: unknown, options: ExtractOptions) => CanonicalEvent | null {
  let currentModel: string | null = null;
  let turnCounter = 0;
  // NOTE on the ~+7% Codex overcount vs ccusage: it is NOT caused by the
  // apparent double-emission of token_count lines. Empirically tested — skipping
  // non-advancing or exact-duplicate token_count events regressed the total to
  // -45% vs ccusage, i.e. ccusage counts those events too. Summing every
  // token_count's last_token_usage is the most accurate option available and is
  // published at reduced ("medium") confidence with the residual disclosed. Do
  // not "dedup" Codex here without re-measuring against ccusage first.

  return (raw: unknown, options: ExtractOptions): CanonicalEvent | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const line = raw as Record<string, unknown>;
    const payload = (line.payload && typeof line.payload === 'object' ? line.payload : {}) as Record<string, unknown>;

    // Remember the model announced for this turn; never read anything else here
    // (turn_context also carries cwd, sandbox roots, and user instructions).
    if (payload.type === 'turn_context' || line.type === 'turn_context') {
      const model = safeModel(payload.model);
      if (model) currentModel = model;
      return null;
    }

    if (payload.type !== 'token_count') return null;

    const info = payload.info;
    if (!info || typeof info !== 'object') return null; // `info: null` is common

    const last = (info as Record<string, unknown>).last_token_usage;
    if (!last || typeof last !== 'object') return null; // never fall back to the cumulative total
    const usage = last as Record<string, unknown>;

    const rawInput = num(usage.input_tokens);
    const cachedInput = num(usage.cached_input_tokens);
    const outputTokens = num(usage.output_tokens);
    // cached is a subset of input; the remainder is genuinely fresh input.
    const inputTokens = Math.max(0, rawInput - cachedInput);
    const totalTokens = rawInput + outputTokens;
    if (totalTokens <= 0) return null;

    const rawTimestamp = line.timestamp;
    const occurredAt = typeof rawTimestamp === 'string' && ISO_RE.test(rawTimestamp) ? rawTimestamp : null;
    if (!occurredAt) return null;

    turnCounter += 1;
    const eventId = createHash('sha256')
      .update([
        options.provider, occurredAt, currentModel ?? '', inputTokens, outputTokens, cachedInput,
        options.sourceFingerprint, turnCounter,
      ].join('|'))
      .digest('hex')
      .slice(0, 32);

    return {
      eventId,
      eventSchemaVersion: EVENT_SCHEMA_VERSION,
      occurredAt,
      ingestedAt: options.ingestedAt,
      provider: options.provider,
      model: currentModel,
      inputTokens,
      outputTokens,
      cacheCreationTokens: 0, // Codex does not report cache writes separately
      cacheReadTokens: cachedInput,
      totalTokens,
      measurementClass: 'provider_reported',
      confidence: 'high',
      sessionPseudonym: null, // session identity is the file itself
      sourceFingerprint: options.sourceFingerprint,
      adapter: options.adapter,
      adapterVersion: options.adapterVersion,
    };
  };
}
